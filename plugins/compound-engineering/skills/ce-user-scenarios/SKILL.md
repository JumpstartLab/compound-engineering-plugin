---
name: ce:user-scenarios
description: "Spawn user personas to evaluate a feature from distinct user perspectives. Use when exploring how real users would interact with a feature — at concept, planning, implementation, or presentation stages."
---

# User Scenario Evaluation

Spawns user personas in parallel to evaluate a feature from distinct user perspectives. Each persona produces a narrative walkthrough grounded in their unique habits, frustrations, and expectations. A synthesis pass distills the narratives into actionable items.

## Interaction Method

Use the platform's question tool when available (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). Otherwise, present numbered options in chat and wait for the user's reply before proceeding.

## Step 1: Parse arguments

Parse the input for:
- **Stage** — one of `concept`, `plan`, `implementation`, `presentation`. Look for `stage:<value>` in the args. If not provided, infer from context or ask.
- **Plan path** — look for `plan:<path>` in the args. Used for `plan` and `implementation` stages.
- **URL** — look for `url:<value>` in the args. Required for `implementation` and `presentation` stages to enable live-app evaluation. If absent at those stages, the skill falls back to narrative-only mode (see Step 3.5).
- **Auth config path** — look for `auth-config:<file-path>` in the args. Required alongside `url:` for live-app mode. Must point to a YAML file on disk; inline credentials are rejected (see Step 3.6, added in Unit 3). The path is relative to the current working directory or absolute.
- **Feature description** — any remaining text after extracting the four named args above.

If no stage is specified, use these heuristics:
- If a plan path is provided and the plan has unchecked implementation units, use `plan`
- If a plan path is provided and all units are checked, use `implementation`
- Otherwise, use `concept`

`url:` and `auth-config:` are NEVER required at `concept` or `plan` stages (no live app to observe). At `implementation` and `presentation` stages they are required together for live-app evaluation; presence of only one is treated as absent (both-or-neither).

Cleanup of the per-run scratch directory is controlled by the environment variable `CE_USER_SCENARIOS_CLEANUP=1`, not by a skill argument. The env var is read in Step 7 (added in Unit 5). Default behavior is retain so synthesis citations stay resolvable.

## Step 2: Locate plugin and discover personas

Find the plugin's install location:

```bash
# Prefer the active Claude profile ($CLAUDE_CONFIG_DIR) over a global search
if [ -n "$CLAUDE_CONFIG_DIR" ]; then
  PLUGIN_DIR=$(find "$CLAUDE_CONFIG_DIR" -path "*/compound-engineering/*/agents/user" -type d 2>/dev/null | head -1 | sed 's|/agents/user$||')
fi
# Fall back to searching all Claude profiles if not found via CLAUDE_CONFIG_DIR
if [ -z "$PLUGIN_DIR" ]; then
  PLUGIN_DIR=$(find "$HOME/.claude" "$HOME/.claude-"* -path "*/compound-engineering/*/agents/user" -type d 2>/dev/null | head -1 | sed 's|/agents/user$||')
fi
```

Fall back to relative path if not found:

```bash
PLUGIN_DIR="${PLUGIN_DIR:-plugins/compound-engineering}"
```

Read all `.md` files from `$PLUGIN_DIR/agents/user/` using the native file-search/glob tool (e.g., Glob in Claude Code). Skip files starting with underscore.

If no persona files are found:
- Report: "No user personas found in agents/user/. Run /ce:refresh to sync personas from configured sources."
- Exit.

## Step 3: Build feature context

Assemble the feature context based on the stage:

**concept stage:**
- Use the feature description from args
- If a brainstorm/requirements document exists in `docs/brainstorms/`, read the most recent relevant one and include it

**plan stage:**
- Read the plan file at the provided path
- Include the plan's overview, problem frame, requirements, and implementation units

**implementation stage:**
- Read the plan file at the provided path
- Include the plan content plus a summary of what was built
- If there is a recent git diff or commit log showing the implementation, summarize the changes at a user-facing level (not code-level)

**presentation stage:**
- Read the plan file at the provided path
- Include everything from the implementation stage
- Frame as a final review before rollout

## Step 3.5: Decide execution mode

Determine whether to run in **live-app mode** (personas drive the actual running application via `agent-browser`) or **narrative mode** (personas reason from the feature description only).

Live-app mode applies when ALL of the following are true:
- Stage is `implementation` or `presentation`
- Both `url:<value>` and `auth-config:<file-path>` were supplied as args

Narrative mode applies otherwise — including the `concept` and `plan` stages, which never observe a live app, and `implementation`/`presentation` stages invoked without the live-app args.

### Fallback warning when live-app args are absent at implementation/presentation

If the stage is `implementation` or `presentation` and either `url:` or `auth-config:` is missing (or both are missing), emit this warning as part of the primary output (not buried in logs) and proceed in narrative mode:

```
<degraded-mode>fallback-to-narrative</degraded-mode>
⚠️  Live-app evaluation requires `url:` and `auth-config:` — falling back to narrative-only mode for this run. To observe the live app, re-run with `url:http://localhost:3000 auth-config:./auth.yaml` (see `references/auth-config-schema.md` for the auth.yaml format).
```

The `<degraded-mode>` tag is the machine-readable signal — orchestrators (Erin, downstream skills) detect it via plain substring match and can branch on it without parsing the prose warning. The prose warning is the human-readable signal. Both are emitted together.

This warning serves a second purpose: when ce:user-scenarios is invoked via the Erin orchestrator's `everyday-usability` phase and Erin's args-forwarding has regressed (a cross-repo drift in `ce-reviewers-jsl`), the user sees this exact warning even when they did supply `url:` and `auth-config:` to `/ce:run erin`. The tag + prose pair is therefore the observable failure mode for both skill-internal misuse AND cross-repo orchestrator drift.

### Generate run identifiers (live-app mode only)

Generate the run identifiers used by Step 4 and downstream steps:

```bash
RUN_ID=$(date +%s)
```

Substitute the resolved value as a literal into template variables and command lines for the persona subagents. Shell variables do not persist across separate Bash invocations — use the literal value, not the variable expansion — same convention as `feature-video/SKILL.md` and consistent with AGENTS.md guidance on scratch directories.

Create the scratch directory:

```bash
mkdir -p ".context/compound-engineering/ce-user-scenarios/$RUN_ID/"
```

Per-persona subdirectories are created in Step 4 as personas are spawned.

## Step 3.6: Validate URL and auth-config

This step runs only in live-app mode. If narrative mode was selected in Step 3.5, skip directly to Step 4.

Abort the run with a clear, actionable error message if any check below fails. Do not proceed to Step 4 with partially-valid inputs.

### URL validation

The `url:<value>` argument must satisfy:

1. **Scheme is `http` or `https` only.** Other schemes (`file:`, `gopher:`, `data:`, custom protocols) are rejected.
2. **Hostname resolves to a non-private, non-loopback, non-link-local IP.** Reject if the resolved IP falls in any of:
   - RFC-1918 private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - Loopback: `127.0.0.0/8`, `::1`
   - Link-local: `169.254.0.0/16`, `fe80::/10`
   - **IPv6 Unique Local Addresses: `fc00::/7`**

   **Exception:** `localhost`, `127.0.0.1`, and IPv6 loopback `::1` are permitted for local development. Document this exemption in the user-facing error message so callers understand why local URLs work but other private addresses don't.

   **IPv6 canonicalization.** When the resolved address is IPv6, canonicalize it before range-matching — specifically, IPv4-mapped IPv6 literals like `::ffff:127.0.0.1` and `::ffff:192.168.1.1` must be normalized to their embedded IPv4 form so the RFC-1918 and loopback rejects fire. Use a standard library (Ruby's `IPAddr`, Python's `ipaddress.ip_address(...).ipv4_mapped`, Node's `net.isIPv4`/`net.isIPv6`) — naive string-prefix checks against `127.0.` or `192.168.` will miss the mapped form.

   **Residual risk (documented, out of scope for this skill):** DNS rebinding attacks where a hostname resolves to a public IP at validation time but returns a private IP at navigation time. Full mitigation requires OS-level controls (firewall, DNS pinning) outside the skill's reach. Documented in `references/auth-config-schema.md`.

3. **Liveness check.** Confirm the URL is reachable before spawning personas:

   ```bash
   curl -sSf --max-redirs 0 --max-time 5 -o /dev/null "$URL"
   ```

   The `--max-redirs 0` flag prevents redirect-to-internal exfiltration where an attacker-controlled public URL redirects to a private resource. `-sSf` exits non-zero on any HTTP error. The 5-second timeout caps the probe.

### auth-config validation

The `auth-config:<file-path>` argument must satisfy:

1. **It is a file path, not inline YAML.** Reject inline credentials in the arg string outright. The path is resolved relative to the current working directory or treated as absolute.
2. **The file exists and is parseable YAML.**
3. **The top-level `type:` field is one of `password` or `magic_link`.** Other variants (including `oauth_dev`) are rejected in v1.
4. **Field-type-aware validation per the type.** See `references/auth-config-schema.md` for the full schema. The rules:

   **URL fields** — `sign_in_url`, `post_login_url`, and `mail_capture_url`:
   - Scheme is `http` or `https`
   - Parseable hostname
   - Reject if the resolved IP is in the reject list above
   - **Exception:** `mail_capture_url` is exempt from the loopback reject. Dev-mail capture services (letter_opener_web, mailcatcher) are conventionally on `localhost`. The exemption is field-specific: only `mail_capture_url` may resolve to a loopback or RFC-1918 address. `sign_in_url`, `post_login_url`, and the primary `url:` argument retain the full reject list.

   **Env-var-name fields** — `email_env`, `password_env`:
   - Each is a **template name** that must contain the literal token `PERSONA` (uppercase). The skill substitutes the uppercased persona filename (e.g., `chuck`, `dorry`) to derive per-persona env-var names. `KS_PERSONA_EMAIL` → `KS_BETTY_EMAIL`, `KS_CHUCK_EMAIL`, etc.
   - Reject the auth-config if the template lacks the `PERSONA` token — without it the skill cannot produce distinct names per persona, and the magic-link flow loses inbox isolation.
   - Each derived name must match `^[A-Z][A-Z0-9_]*$`.
   - **AND** every derived env var must be set and non-empty at validation time, checked once per persona discovered in Step 2. Abort with a named error identifying both the persona and the missing variable (e.g., `KS_CHUCK_EMAIL is not set; required for persona chuck`).
   - See `references/auth-config-schema.md` § "Per-persona env-var derivation" for the worked table.

   **Selector fields** — `mail_link_recipient_selector`:
   - Non-empty string

   These rules are field-type-aware on purpose. An earlier heuristic ("reject any value with two or more consecutive non-alphanumerics") would have rejected the URLs in this skill's own example configurations because `://` matches. Field-type-aware validation reflects what each value actually represents.

If all checks pass, proceed to Step 4.

## Step 4: Spawn persona agents

Read `references/user-subagent-template.md` for the prompt template and stage framing blocks.

### Model selection

- **Narrative mode** (concept, plan, or fallback at implementation/presentation): `model: sonnet` — persona evaluation is judgment work. Each persona embodies a distinct viewpoint (Betty's competence + impatience, Chuck's carelessness, Dorry's design eye, Mark's mobile-first frustration, Nancy's cautious methodicalness) and produces a critique grounded in that lens. Haiku flattens persona voice into generic-evaluator prose, which defeats the point of running five personas.
- **Live-app mode** (implementation or presentation with `url:` and `auth-config:`): `model: sonnet` — personas coordinate multi-step `agent-browser` CLI calls (navigate, snapshot, click, screenshot) and need stronger tool-orchestration ability than haiku reliably provides. Confirmed empirically by the Unit 0 spike (see `docs/spikes/2026-05-10-user-scenarios-direct-drive.md`): sonnet completed a 7-screenshot persona walk in 24 invocations / 185s, well inside the action-budget caps below.

Both modes use Sonnet by design — the cost is bounded (5 personas × one-shot evaluation), and the value of distinct persona voices depends entirely on the model's ability to stay in character. Escalate a single persona to Opus only if its output is consistently generic across runs.

### Per-run environment setup (live-app mode only)

Skip this section in narrative mode.

Before spawning any persona subagent, the skill exports the per-run environment variables that govern `agent-browser` behavior. These are read by the `agent-browser` daemon at first-invocation spawn time for each `--session <name>` value AND are cached for the lifetime of that daemon. **Daemon spawn-time semantics: env-var changes on subsequent invocations of the same `--session` are ignored.** The cleanup contract in Step 7 issues `agent-browser state clear` on every terminal state precisely so that the next run can spawn a fresh daemon with fresh env values — that is not optional hygiene, it is load-bearing.

```bash
# Per-run ephemeral encryption key for at-rest session-state encryption.
# Generated fresh each run; discarded on cleanup (Step 7).
export BROWSER_ENCRYPTION_KEY=$(openssl rand -hex 32)
export AGENT_BROWSER_ENCRYPTION_KEY="$BROWSER_ENCRYPTION_KEY"

# Domain allowlist for outbound navigation from any persona session.
# Hostname only, no ports. Composed from the host of url: plus the host
# of mail_capture_url (if the auth-config: file references one),
# comma-joined.
export AGENT_BROWSER_ALLOWED_DOMAINS="<url-hostname>,<mail-capture-hostname-if-any>"

# Nonce-tagged page-content boundaries for prompt-injection mitigation.
export AGENT_BROWSER_CONTENT_BOUNDARIES=1
```

**Hostname extraction rule.** `AGENT_BROWSER_ALLOWED_DOMAINS` accepts hostnames only — **strip the port before composing the value.** Parse each URL with a standard library (Ruby's `URI`, Python's `urllib.parse`, `awk -F[:/] '{print $4}'`, etc.) and take the `host` field, which excludes the port. The Unit 0 spike confirmed that `localhost:3000` as a value rejects ALL navigation (it treats the entire string as a literal hostname, which never matches); bare `localhost` permits localhost-resolving URLs regardless of port. For KickScout's `http://localhost:3000` plus `http://localhost:3001/letter_opener` setup, the resulting value is simply `localhost`.

**Subagent env-var propagation — primary path with documented fallback.** Per the Unit 0 spike, child processes spawned via the platform's subagent dispatch mechanism inherit the parent's environment, so an `export` at this level reaches the persona's Bash. If a future platform change disrupts that inheritance, the skill also injects equivalent `export` statements at the top of each persona prompt's auth-and-navigate block as a redundant path. Pick the inheritance path in normal operation; switch to prompt-injection only if observability reveals the inheritance path failed.

### Per-persona dispatch

For each persona file discovered in Step 2:

1. Read the persona file content
2. Select the stage framing block matching the current mode and stage:
   - Narrative mode + `concept` → use the `concept` block (unchanged)
   - Narrative mode + `plan` → use the `plan` block (unchanged)
   - Narrative mode + `implementation` (fallback) → use the existing `implementation` block
   - Narrative mode + `presentation` (fallback) → use the existing `presentation` block
   - Live-app mode + `implementation` → use the `implementation-live-app` block (added in Unit 2)
   - Live-app mode + `presentation` → use the `presentation-live-app` block (added in Unit 2)
3. Construct the sub-agent prompt by filling template variables:
   - `{persona_file}` — the full persona markdown content
   - `{stage_framing}` — the stage-specific framing block selected above
   - `{feature_context}` — the assembled feature context from Step 3
   - For live-app mode only, also fill: `{run_id}`, `{session_name}` (composed as `ce-user-scenarios-${RUN_ID}-${PERSONA_NAME}`), `{url}`, `{auth_config_excerpt}` (structural fields plus env-var names only — see Unit 2), `{allowed_domains}` (hostnames extracted from `url:` and any `mail_capture_url`, comma-joined, no ports), `{persona_email_env}` (derived per-persona env-var name — substitute the uppercased persona filename for the `PERSONA` token in the auth-config's `email_env` template; e.g., template `KS_PERSONA_EMAIL` + persona `chuck` → `KS_CHUCK_EMAIL`. See Step 3.6 and `references/auth-config-schema.md`.), `{max_invocations}`, `{max_screenshots}`, `{max_wall_clock_seconds}`
4. Spawn a sub-agent with the model selected above and the constructed prompt

Spawn all persona agents in parallel. If parallel dispatch is not supported, spawn sequentially.

Wait for all agents to complete. If an agent times out or fails, note it and continue with the responses received.

### Persona result envelope

After each persona returns, wrap its raw output with a structured envelope so callers (Step 6 synthesis, Erin, downstream orchestrators) can route on outcome without parsing prose:

```
<persona-result name="dorry" status="success">
[persona's narrative + structured tail verbatim]
</persona-result>
```

`status` is one of: `success`, `error`, `timeout`, `silent-failure`, `malformed`. Determination rules:

| `status` | Condition |
|---|---|
| `success` | Persona returned, structured tail parses cleanly, no silent-failure or fabricated-citation tags |
| `silent-failure` | Step 4 silent-failure detection or Step 5 screenshot-existence validation tagged the persona |
| `timeout` | Persona exceeded any action-budget cap and returned partial output |
| `error` | Persona subagent returned an error or never returned a coherent narrative |
| `malformed` | Persona returned but the `## Structured Tail` section is missing or unparseable |

The envelope is emitted around every persona's section in Step 5's individual narratives. Step 6 synthesis aggregates statuses into `$TERMINAL_STATE` per Step 7's rules.

### Per-persona session isolation (live-app mode only)

Each persona subagent receives a unique `--session` name composed at dispatch time:

```bash
SESSION_NAME=ce-user-scenarios-${RUN_ID}-${PERSONA_NAME}
```

`${RUN_ID}` is the timestamp from Step 3.5; `${PERSONA_NAME}` is the persona's filename without extension (e.g., `dorry`, `chuck`, `mark`). Both are substituted as literals into the persona's `{session_name}` template variable. The persona template (Unit 2) requires `--session "{session_name}"` on every `npx agent-browser` invocation.

`--session <name>` is the agent-browser flag for **isolated browser process per name**. Concurrent invocations with distinct `--session` values get isolated cookies, tabs, and refs — confirmed empirically by the Unit 0 spike. `--session-name <name>` is a DIFFERENT flag (named cookie save/restore without process isolation); do not use it. Sessions sharing a `--session-name` value share state and cross-contaminate.

### Action budget caps (live-app mode only)

Each persona has hard ceilings on its `agent-browser` activity, surfaced into its prompt via template variables and enforced by the persona's own self-throttling per the template's action-budget reminder block:

| Variable | Default | Meaning |
|---|---|---|
| `{max_invocations}` | `40` | Maximum `agent-browser` CLI invocations per persona |
| `{max_screenshots}` | `20` | Maximum screenshots per persona |
| `{max_wall_clock_seconds}` | `300` | Maximum wall-clock seconds per persona |

Empirically the Dorry probe ran in 24 invocations / 7 screenshots / 185 seconds (real per-call average ≈ 7.7 seconds), so a healthy persona walk should consume roughly 30–60% of any cap. If observed runs consistently exceed 75% of any cap (30 invocations, 15 screenshots, or 225 seconds), reduce the work asked of the persona or raise the cap on the next revision — operate near a cap is a smell, not a target.

A persona that exceeds any cap must stop and produce partial output rather than continuing. The persona's structured tail records actual consumption against each cap.

**Self-enforcement limitation.** The caps are enforced by the persona subagent's own counting and self-throttling — there is no skill-side timer, invocation counter, or kill switch that forcibly terminates a runaway persona. A sonnet subagent told "stop at 40 invocations" may overshoot by 1–2 calls on the same conversational turn before stopping. The synthesis tolerates small overshoot (Step 7's terminal-state rule fires `timeout` only when caps are exceeded, regardless of the magnitude). Hard skill-side enforcement (e.g., a watchdog process that kills the subagent at the wall-clock cap) is deliberately deferred to a future iteration; it would require platform support for subagent timeouts that the dispatcher does not currently expose.

### Silent-failure detection

After all personas return, parse each persona's `## Structured Tail` section (defined in `references/user-subagent-template.md`). Extract three fields per persona:

1. **URLs visited** — the list on the `- URLs visited:` line. Trim, split on commas. Treat the literal strings `<list>` (unfilled template), `none`, and an empty value as zero.
2. **Screenshots captured** — the list on the `- Screenshots captured (...):` line. Same parsing rules.
3. **Action-budget consumption — invocations** — extract the integer `<invocations>` from the leading `<n>/<cap>` token on the `- Action-budget consumption:` line via regex `^\s*(\d+)\s*/\s*\d+\s+invocations`. A missing or non-integer value is treated as zero.

**A persona is tagged `silent-failure: no browser activity recorded — possible silent failure`** when all three of the following are true: zero URLs visited, zero screenshots, and zero invocations. Any single non-zero signal clears the tag — a persona that visited one URL but captured no screenshots is suspicious but not silent.

Surface the tag in the synthesis (Step 6) so the reader can treat that persona's narrative with appropriate skepticism — a live-app persona that produced narrative without invoking the browser cannot have observed the application. A persona missing the entire `## Structured Tail` section is treated as `silent-failure` AND `malformed-output` and surfaced separately.

## Step 5: Present individual narratives

### Screenshot-existence validation (live-app mode only)

Before presenting each persona's narrative, the skill resolves every screenshot path the persona cited and verifies the file exists on disk under `.context/compound-engineering/ce-user-scenarios/$RUN_ID/<persona-name>/`. For each cited path that does NOT exist on disk, append a line to the persona's structured tail:

```
fabricated-citation: <path>
```

Step 6 synthesis treats fabricated-citation findings as silent-failure signals on that persona — the persona invoked CLI commands but produced output that does not reference real evidence. The reader should weight that persona's narrative accordingly. This closes the gap where a persona could run `agent-browser` successfully but still hallucinate the screenshots it claims to have captured.

### Relative-path citation preservation

Persona narratives cite screenshots by relative path from the per-run directory (e.g., `dorry/03-chat.png`). Step 5 does NOT absolutize these paths in the in-process output — leave them relative so the reader can compute the on-disk location from the run-id. External sharing (e.g., uploading via the `proof` skill or pasting into a PR) MUST strip absolute paths if any leaked through; the in-process output is the canonical relative form.

Present each persona's narrative response under a clear heading:

```markdown
---

## Nancy's Experience

[Nancy's full narrative response]

---

## Dorry's Critique

[Dorry's full narrative response]

---
```

Present the narratives in a consistent order. Do not summarize, truncate, or paraphrase the persona responses — show them in full. Each persona has a distinct voice that is part of the value.

## Step 6: Synthesize

After presenting the individual narratives, produce a synthesis section that distills actionable items from all personas.

### Synthesis Structure

```markdown
## Synthesis: User Scenario Findings

### Common Themes
[Issues or observations that multiple personas raised — these are high-confidence findings]

### Unique Perspectives
[Issues only one persona raised but that represent a real concern for their user type]

### Acceptance Test Scenarios
[Concrete test scenarios derived from persona narratives. Each should specify: starting point, user action sequence, expected outcome. These are ready to translate into system tests.]

- Scenario: [Name]
  - Start: [Where the user begins]
  - Steps: [What they do]
  - Expected: [What should happen]
  - Source: [Which persona(s) surfaced this]

### UX Gaps
[Usability problems identified — missing labels, broken navigation, confusing flows, missing confirmations]

### Design Issues
[Visual and design coherence problems — primarily from Dorry but validated against other personas' experiences]

### Missing Features
[Capabilities personas expected but that don't exist in the current concept/plan/implementation]

### Risk Items
[Things that could cause users to abandon the feature entirely]

### Evidence Conflicts
[Live-app mode only. When multiple personas observed the same URL or captured screenshots of structurally equivalent surfaces (same page-name, same intended state) but reported materially different behavior — different error states, different rendered text, different element counts — surface that as a finding. Cross-reference both persona reports' evidence paths so the reader can inspect the discrepancy. This is the most distinctive value of observed-versus-imagined personas: narrative-only personas cannot disagree about what they observed because they observed nothing. Omit this subsection when no conflicts are detected.]
```

### Synthesis Guidelines

- Weight common themes higher than individual findings — if Nancy, Chuck, and Betty all hit the same problem, it is critical
- Acceptance test scenarios should be specific enough to translate directly into system tests (Capybara, Playwright, etc.)
- Distinguish between "nice to have" improvements and blocking issues
- For the `concept` stage, focus the synthesis on scenario coverage and design gaps
- For the `plan` stage, focus on unresolved questions and missing scenarios
- For the `implementation` stage, focus on acceptance test gaps and UX issues
- For the `presentation` stage, focus on overall readiness and launch risks

## Step 7: Cleanup and terminal-state contract

Skip this step in narrative mode (no browser sessions were created).

### Ordering invariants

- Step 5 (screenshot-existence validation) and Step 6 (synthesis) MUST complete before Step 7 runs. By the time cleanup starts, every citation has already been resolved against on-disk files and rendered into the synthesis text; cleanup is safe regardless of whether the scratch directory is retained or removed.
- A second invocation of the skill MUST generate a fresh `$RUN_ID` (Step 3.5 uses `date +%s` to seconds-resolution). Collisions are theoretically possible if two invocations start within the same second on the same machine. If a caller may invoke the skill in rapid sequence, append a short random suffix to `$RUN_ID` (e.g., `$(date +%s)-$RANDOM`) so the scratch directory and `--session` names cannot collide across runs.
- Per-persona cleanup is sequenced: close, then state-clear, per persona, before moving to the next. Parallel cleanup of multiple personas is permitted only if each `--session` name is unique (the dispatch already guarantees this).

The run reaches one of four terminal states:

| State | Meaning |
|---|---|
| `success` | All personas completed within budget, returned narrative + structured tail with no fabricated-citation tags, and synthesis ran to completion |
| `failure` | One or more personas returned errors that prevented synthesis; or auth/validation failed before persona dispatch |
| `timeout` | One or more personas exceeded a budget cap; partial output present |
| `partial` | One or more personas returned with `silent-failure` or `fabricated-citation` tags; useful output present but flagged |

### Determine the terminal state

Before running cleanup, the orchestrator computes `$TERMINAL_STATE` from the union of persona outcomes plus pre-dispatch validation results. Apply these rules in order — the first matching rule wins:

| Order | Condition | `$TERMINAL_STATE` |
|---|---|---|
| 1 | Step 3.6 validation aborted before any persona was spawned, OR every persona returned an error preventing synthesis | `failure` |
| 2 | One or more personas exceeded any action-budget cap (`{max_invocations}`, `{max_screenshots}`, `{max_wall_clock_seconds}`) | `timeout` |
| 3 | One or more personas carry a `silent-failure` or `fabricated-citation` tag from Steps 4/5 | `partial` |
| 4 | All personas returned within budget, no flagged tags, synthesis completed | `success` |

Assign the resolved value to `TERMINAL_STATE` as a shell variable before the cleanup commands below — it is consumed in the conditional scratch-directory cleanup section. Also surface the terminal state in the final synthesis output (one line, structured): `<terminal-state>success</terminal-state>` so callers (Erin, downstream orchestrators) can branch on it without parsing prose.

```bash
TERMINAL_STATE="success"  # or failure | timeout | partial — computed per rules above
```

### Universal per-persona cleanup (every terminal state)

Regardless of terminal state, the skill issues these two commands for every persona that was spawned:

```bash
npx agent-browser --session {session_name} close
npx agent-browser state clear {session_name}
```

`close` terminates the daemon process for that `--session`. `state clear` removes the named session's encrypted state file from `~/.agent-browser/sessions/`. Both are required: leaving plaintext-or-encrypted session files behind after a run is never acceptable, and the next run for the same `--session` needs a clean slate to spawn a fresh daemon with fresh env vars (the spawn-time caching documented in Step 4's per-run environment setup).

After per-persona cleanup completes, discard the per-run encryption key from the process environment:

```bash
unset BROWSER_ENCRYPTION_KEY AGENT_BROWSER_ENCRYPTION_KEY
```

### Conditional scratch-directory cleanup

The per-run scratch directory `.context/compound-engineering/ce-user-scenarios/$RUN_ID/` is retained by default. Default retention keeps synthesis citations resolvable for later inspection and gives the user a way to revisit screenshots after the synthesis is read.

Cleanup of the scratch directory is opt-in via the environment variable `CE_USER_SCENARIOS_CLEANUP`. Apply this rule:

```bash
if [ "$CE_USER_SCENARIOS_CLEANUP" = "1" ] && [ "$TERMINAL_STATE" = "success" ]; then
  rm -rf ".context/compound-engineering/ce-user-scenarios/$RUN_ID/"
fi
```

The env var must be exactly `1`. Other truthy-looking values (`true`, `yes`) are treated as absent. The terminal state must be exactly `success` — failure, timeout, and partial states never clean up regardless of the env var, because their artifacts are the only diagnostic evidence available.

There is no first-class skill argument for cleanup by design. Power users who consistently want cleanup set `CE_USER_SCENARIOS_CLEANUP=1` once in their shell rc; default behavior is safe and inspectable. The env var is documented in `references/auth-config-schema.md`'s "Advanced" section.

## Pipeline Mode

When invoked from an automated workflow (orchestrator phase), skip interactive questions. Use the stage and context provided in args. Present narratives and synthesis without asking for approval to proceed.
