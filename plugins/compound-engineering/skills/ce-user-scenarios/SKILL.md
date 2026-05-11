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
⚠️  Live-app evaluation requires `url:` and `auth-config:` — falling back to narrative-only mode for this run. To observe the live app, re-run with `url:http://localhost:3000 auth-config:./auth.yaml` (see `references/auth-config-schema.md` for the auth.yaml format).
```

This warning serves a second purpose: when ce:user-scenarios is invoked via the Erin orchestrator's `everyday-usability` phase and Erin's args-forwarding has regressed (a cross-repo drift in `ce-reviewers-jsl`), the user sees this exact warning even when they did supply `url:` and `auth-config:` to `/ce:run erin`. The warning text is therefore the observable failure mode for both skill-internal misuse AND cross-repo orchestrator drift.

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

## Step 4: Spawn persona agents

Read `references/user-subagent-template.md` for the prompt template and stage framing blocks.

### Model selection

- **Narrative mode** (concept, plan, or fallback at implementation/presentation): `model: haiku` — fast and cheap for text-only reasoning.
- **Live-app mode** (implementation or presentation with `url:` and `auth-config:`): `model: sonnet` — personas coordinate multi-step `agent-browser` CLI calls (navigate, snapshot, click, screenshot) and need stronger tool-orchestration ability than haiku reliably provides. Confirmed empirically by the Unit 0 spike (see `docs/spikes/2026-05-10-user-scenarios-direct-drive.md`): sonnet completed a 7-screenshot persona walk in 24 invocations / 185s, well inside the action-budget caps documented in Unit 4 below.

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
   - For live-app mode only, also fill: `{run_id}`, `{session_name}` (composed as `ce-user-scenarios-${RUN_ID}-${PERSONA_NAME}`), `{url}`, `{auth_config_excerpt}` (structural fields plus env-var names only — see Unit 2), `{allowed_domains}` (hostnames extracted from `url:` and any `mail_capture_url`, comma-joined, no ports), `{persona_email_env}` (per-persona env-var identity assignment from `auth-config:`), `{max_invocations}`, `{max_screenshots}`, `{max_wall_clock_seconds}`
4. Spawn a sub-agent with the model selected above and the constructed prompt

Spawn all persona agents in parallel. If parallel dispatch is not supported, spawn sequentially.

Wait for all agents to complete. If an agent times out or fails, note it and continue with the responses received.

The env-var exports for live-app mode (`AGENT_BROWSER_ALLOWED_DOMAINS`, `AGENT_BROWSER_CONTENT_BOUNDARIES`, `AGENT_BROWSER_ENCRYPTION_KEY`) and the action-budget enforcement are wired in by Unit 4. The `--session` flag isolation and cleanup contract are wired in by Unit 4 and Unit 5 respectively.

## Step 5: Present individual narratives

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
```

### Synthesis Guidelines

- Weight common themes higher than individual findings — if Nancy, Chuck, and Betty all hit the same problem, it is critical
- Acceptance test scenarios should be specific enough to translate directly into system tests (Capybara, Playwright, etc.)
- Distinguish between "nice to have" improvements and blocking issues
- For the `concept` stage, focus the synthesis on scenario coverage and design gaps
- For the `plan` stage, focus on unresolved questions and missing scenarios
- For the `implementation` stage, focus on acceptance test gaps and UX issues
- For the `presentation` stage, focus on overall readiness and launch risks

## Pipeline Mode

When invoked from an automated workflow (orchestrator phase), skip interactive questions. Use the stage and context provided in args. Present narratives and synthesis without asking for approval to proceed.
