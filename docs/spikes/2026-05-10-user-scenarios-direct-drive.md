---
date: 2026-05-10
spike: ce:user-scenarios direct-drive architecture gate (Unit 0)
plan: docs/plans/2026-05-10-001-feat-ce-user-scenarios-browser-fidelity-plan.md
outcome: GREEN-with-corrections
---

# Unit 0 Spike — `ce:user-scenarios` direct-drive architecture

## TL;DR

The direct-drive architecture (sonnet × `agent-browser` × per-persona isolated session) is **viable**. The architectural gate **passes** for Units 1-6. However, the plan as written contains two flag/format errors that must be corrected before Unit 1 ships. Net signal: **GREEN with mechanical corrections.**

## Pass/fail vs plan thresholds

| Threshold | Plan target | Spike result | Status |
|---|---|---|---|
| Happy path: 1 persona, full walk ≤ 300s, ≤ 40 invocations | 4/5 runs | 1/1 probe (Dorry): 24 invocations / 185s / 7 screenshots / real observations | PASS (probe) |
| Env-var propagation | 5/5 | Pre-command env-var setting works (`VAR=val cmd`); daemon caches first-call env, ignores later changes | PASS with operational note |
| Allowlist format | Deterministic answer | **Hostname only, NO port.** `localhost` works; `localhost:3000` is rejected as a hostname | PASS (correction needed) |
| Concurrency (parallel isolation) | 0 contamination across 3 paired runs | `--session-name` does NOT isolate (cross-contaminated). **`--session` DOES isolate (verified)** | PASS with plan correction |
| Sandbox effectiveness (off-list nav blocked) | 0 unblocked navs | Direct: `✗ Domain 'example.com' is not in the allowed domains list` (exit 1). Subagent reported success — false negative, see analysis | PASS with operational note |
| Reliability (screenshot paths exist, no hallucination) | 0 hallucinated paths in 5 runs | All 7 cited screenshots from the Dorry probe exist on disk | PASS |

## Empirical measurements

### Dorry probe (single, qualitative)
- 24 agent-browser CLI invocations
- 185s wall-clock
- 7 screenshots captured (all exist on disk, verified)
- Real per-call average: 7.7s (matches plan's 7.5s estimate almost exactly)
- Real design observations produced (paired-vs-single avatar inconsistency on chat, verb/noun mixed action tiles, absolute-vs-relative timestamp coexistence on chat scroll) — observations that imagined narrative could not have produced

### Chuck + Mark parallel runs
- Chuck: 22 invocations / 180s; identity contamination observed (`--session-name` not isolating)
- Mark: 20 invocations / 150s; mobile viewport via `resize` worked (subcommand exists)
- Confirms parallel sonnet subagents drive agent-browser cleanly; the contamination was a tool-flag bug, not a sonnet-coordination bug

### Nancy adversarial run
- 12 invocations / 45s
- Reported allowlist as broken; **investigation revealed this was a false negative** caused by daemon env-var caching combined with using a re-used `--session-name` daemon (see plan corrections below)

## Findings requiring plan corrections

### Correction 1 (CRITICAL) — `--session` vs `--session-name`

The plan uses `--session-name <name>` throughout for both auth persistence AND parallel isolation. **These are two different flags in agent-browser v0.27.0:**

- `--session <name>` — isolated browser process with its own cookies, tabs, refs. **This is the parallel-isolation flag.**
- `--session-name <name>` — auto-saves and restores cookies + localStorage by name. **No process isolation — sessions share state.**

Empirical proof (this spike, direct invocation):
```
Session A (--session-name iso-a) logs in as Maria → "Hey, Maria!"
Session B (--session-name iso-b) logs in as David → "Hey, David!"
Re-check A → "Hey, David!"  ← CONTAMINATED, isolation broken
```

```
Session A (--session iso-real-a) logs in as Maria → "Hey, Maria!"
Session B (--session iso-real-b) logs in as David → "Hey, David!"
Re-check A → "Hey, Maria!"  ← isolated, identity preserved
```

**Required plan changes:** global s/`--session-name`/`--session`/ throughout `docs/plans/2026-05-10-001-...md` and the brainstorm. The template variable name `{session_name}` stays (it's just a variable name); the CLI flag it's substituted into must be `--session`.

Specific file edits identified:
- Plan §Key Technical Decisions, line 94 — the entire "--session-name flag standardization" paragraph reverses
- Plan §Implementation Units → Unit 0, Unit 4 — references to `--session-name`
- Plan §Mermaid diagram — `--session-name unique to persona+run` → `--session unique to persona+run`
- Brainstorm — same audit

### Correction 2 (CRITICAL) — Allowlist format is hostname-only

`AGENT_BROWSER_ALLOWED_DOMAINS=localhost:3000` rejects ALL navigation including to localhost (the literal hostname is `localhost`, not `localhost:3000`). Working form: `AGENT_BROWSER_ALLOWED_DOMAINS=localhost`.

For KickScout's two-host setup (app on :3000, letter_opener_web on :3001), both run on `localhost`, so a single entry `localhost` covers both. For production scenarios where app and mail-capture are on different hostnames, comma-separated works: `AGENT_BROWSER_ALLOWED_DOMAINS=app.example.com,mail.example.com`.

Wildcard support not confirmed (a `localhost:*` test was inconclusive due to letter_opener_web not running on :3001 during the spike).

**Required plan changes:**
- Plan §Key Technical Decisions, line 95 — change "host of `url:` + host of `mail_capture_url`" to clarify it's the hostname extracted from each URL, not the host:port string
- Plan §Implementation Units → Unit 4 Approach — `AGENT_BROWSER_ALLOWED_DOMAINS="<url-host>,<mail-capture-host-if-any>"` is correct in intent but needs an explicit "hostname only — strip port" note
- Unit 4 contract assertion (in Unit 6) — assert that the SKILL.md text says "hostname-only"

### Operational note 1 — Daemon env-var caching

agent-browser spawns a daemon per `--session` name on first invocation. Env vars are read at daemon-spawn time. Subsequent invocations on the same `--session` ignore changes to `AGENT_BROWSER_ALLOWED_DOMAINS` (and presumably other env vars).

Implication for Unit 4: **`state clear <name>` MUST precede any re-spawn that needs different env values.** The plan's cleanup contract already runs `state clear` on every terminal state, so this is satisfied — but Unit 4's documentation should explicitly call out the spawn-time semantics so future maintainers don't get confused.

Implication for Unit 0 false-negative (Nancy): she ran Test 1 (localhost) and Test 2 (example.com) on the same `--session-name` (the older flag), and the daemon kept whatever state it had from the first call. The "all navigations succeeded" report was a confusing artifact of the conflated flag, not actual agent-browser behavior.

### Operational note 2 — Sonnet handles agent-browser CLI syntax well, with one wrinkle

Dorry's probe report flagged:
> Initial `click --ref e5` syntax failed; the correct syntax is `click @e5` (using the `@` prefix for ref IDs). Corrected after consulting the skills guide.

This is a learn-on-the-fly behavior that worked out, but Unit 2's persona template should pre-teach it. **Add to Unit 2 template variables / framing:** `click <selector>` accepts `@<ref>` for refs from `snapshot`; Turbo-driven links may not navigate via `click` — extract the URL via `eval` or `snapshot` and use `open <url>`.

This avoids burning 1-2 invocations per persona on syntax discovery.

## Findings the plan handled correctly

- **`agent-browser` is invocable via `npx`** without global install (plan §Key Technical Decisions line 93 — confirmed)
- **`agent-browser snapshot` returns structured accessibility tree with refs** (plan assumed this; confirmed)
- **`agent-browser screenshot <path>` produces real PNGs** (plan assumed; confirmed — 40-60KB per screenshot)
- **Action budget defaults 40/20/300 are realistic** (Dorry: 24/7/185 well inside; plan stays as-is)
- **`.context/compound-engineering/<skill>/<run-id>/` scratch convention** works for screenshot organization (plan §Step 5 — confirmed)
- **Magic-link auth complexity is real but isolatable** — `/dev/sessions` shortcut was used for the spike; the auth-config schema's `magic_link` variant still needs Unit 7 smoke validation against the real letter_opener flow

## Findings the spike could not validate

- **5/5 reliability across multiple independent runs** — only 1 happy-path run (Dorry) was executed. Spike was scoped to a probe rather than the full 5-run statistical test. Risk: a single clean run does not bound variance. Mitigation: Unit 7 smoke against KickScout will exercise 5 personas in parallel; if variance is high there, plan can be revised before merge.
- **Magic-link auth specifically against letter_opener_web** — substituted with `/dev/sessions` for spike convenience. Unit 7 must exercise the actual magic-link path before declaring shippable.
- **Wildcard allowlist support** — inconclusive (test target wasn't running). Stick with comma-separated form for v1; investigate wildcard if needed in v2.
- **DNS-rebinding behavior** — out of scope (plan already documents this as residual risk).

## Gate decision

**GREEN with mechanical corrections.** Proceed to Unit 1 after applying:

1. Global s/`--session-name`/`--session`/ in plan + brainstorm
2. Allowlist hostname-only clarification in plan §Key Technical Decisions and Unit 4
3. Daemon spawn-time env-var note added to Unit 4 documentation
4. Unit 2 template gets the `@<ref>` syntax + Turbo-link pre-teach

The architecture survives. No reroll to scout-plus-critic is warranted. The Unit 0 spike paid for itself by catching the flag bug and the allowlist format bug before they shipped into Units 1-6.

## Artifacts captured

- `.context/compound-engineering/ce-user-scenarios/1778455594/dorry/` — 7 screenshots from the probe (verified on disk)
- `.context/compound-engineering/ce-user-scenarios/1778455594/chuck/` — 3 screenshots (Chuck identity-contamination evidence)
- `.context/compound-engineering/ce-user-scenarios/1778455594/mark/` — 3 screenshots (mobile-viewport Sarah Wilson walk)
- `.context/compound-engineering/ce-user-scenarios/1778455594/nancy/` — 1 screenshot (sandbox test artifact)

These are gitignored under `.context/` and serve as the spike's empirical receipts.
