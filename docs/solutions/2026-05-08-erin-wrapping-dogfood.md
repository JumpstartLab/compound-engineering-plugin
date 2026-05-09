# Erin Phase Isolation v1 — Dogfood Post-Mortem

**Date:** 2026-05-08
**Plan reference:** [docs/plans/2026-05-07-001-feat-erin-phase-isolation-plan.md](../plans/2026-05-07-001-feat-erin-phase-isolation-plan.md), Unit 4
**Spike reference:** [docs/solutions/2026-05-07-agent-tool-depth-2-spike.md](2026-05-07-agent-tool-depth-2-spike.md)
**Feature dogfooded:** KickScout's eval-draft mobile single-player evaluator (`docs/plans/2026-05-08-001-feat-evaluation-draft-mobile-single-player-plan.md`) — a real feature Jeff would have run `/ce:run erin` on anyway. 5 implementation units, ~1126 lines of changes across 33 files.
**Run-id:** `2026-05-08-22-03-44-erin-eval-draft-mobile`
**Verdict:** ✅ **v1 mechanism works. Three v2 changes recommended on evidence.**

## Summary

The wrapped work-phase mechanism dispatched cleanly, the run-state file kept Erin oriented across the work boundary, and `git diff --stat <pre_sha>` proved adequate as ground truth. The wrapped subagent returned a structurally valid handoff at the documented path with `status: success`, and the verification protocol (read handoff → diff → empty-success check) produced a usable signal in seconds.

But the dogfood also surfaced three issues that v1 did not anticipate, all of them on the boundary between "subagent was honest" and "subagent gave a complete picture":

1. **`git diff <pre_sha>` includes parallel-stream merges, not just the subagent's work.** Initially read as scope drift: the `git diff` showed 33 files changed, only ~8 of them in the plan's stated file list. On closer inspection, main had moved during the wrapped phase — PR #140 (Cards::DetailComponent + drift-sentinel helper) merged from a separate stream while the subagent was working, advancing main from `6ef1b2c` (the pre_dispatch_sha) to `b85dc6a`. The subagent rebased onto fresh main during its run, used the just-merged `Cards::DetailComponent` appropriately in `_mobile_evaluator.html.erb`, and was correctly silent about the Cards work in its handoff. v1's verification protocol asks "how big is `git diff <pre_sha>`?" — but that diff is `<pre_sha>..working_tree`, which includes both (a) commits the subagent made and (b) commits parallel streams merged. v1 conflates the two.
2. **The work phase is wrapped but the *next* phase isn't.** v1's wrapping won the parent context back from `/ce:work`'s tool churn — and immediately spent it on `/ce:review`'s instruction expansion (~250 lines) plus 11 reviewer Agent dispatches with full diff payloads each. The net win is real but smaller than implied. Wrapping work alone solves a smaller fraction of the original "main thread fills up" pain than v1 hoped.
3. **The race-condition bugs the wrapped subagent shipped were exactly the kind that depth-2-dispatch wrapping was meant to enable detection of, but v1's verification protocol cannot see them.** Two reviewers (julik, correctness) independently flagged three manifestations of a stale-response race in the wrapped subagent's Stimulus controller — a class of bug the subagent's own `bin/rails test:system` happily passed because system tests don't exercise mid-flight player switches. v1's verification stops at "did the subagent change files and pass the pre-PR checklist?" — both true here, both insufficient.

The mechanism is right. The protocol around it needs three small reinforcements.

## What worked

### Run-state file as a recovery anchor
The `docs/runs/<run-id>/run-state.md` file did its job cleanly. The two-write protocol (about_to_dispatch, then dispatched-with-sha) felt redundant for a happy path with no `/compact`, but the redundancy is cheap and the second write is cleanly justified by crash safety. Keep as-is.

### `git diff --stat <pre_sha>` as ground truth
Single command, deterministic, no tooling. Captured all 33 changed files including the brand-new uncommitted plan file (working-tree changes are included because the diff is against the SHA, not `..HEAD`). Catches uncommitted work that staged-only diffs would miss.

### Handoff schema
The minimal handoff (`phase`, timestamps, `status`, Outcome, Artifacts, Recommended Next Phase Action, Judgment Calls, Open Questions) covered every actionable thing Erin needed. Dropping `claimed_files`/`claimed_lines` was correct — having the subagent self-report would have created a discrepancy-detection burden for zero added signal, since `git diff` is right there.

### Inline-only constraint (Workaround A) was a non-event
The wrapped subagent's own dogfood notes: "Inline-only constraint felt natural for this slice. I never reached for `/ce:review` or a parallel-subagent strategy." This validates Workaround A as the right v1 pivot — for plan-driven implementation work, the constraint doesn't bite.

### Streaming worked
Tool calls from the wrapped subagent streamed live to the parent terminal during the ~50-minute work phase. No "black box for N minutes" UX regression. This was a Unit-1 spike concern that the actual dispatch resolved.

### Empty-success check fired correctly (and was correctly inert)
The subagent reported `status: success` and the diff showed +1126/-199 — far from empty. Check was a no-op as designed. No false positive, no false negative.

## What needs strengthening for v2

### Issue 1: `git diff <pre_sha>` conflates the subagent's work with parallel-stream merges

**Symptom:** Initially read as scope drift: the `git diff <pre_sha>` showed 33 files / +1126 / −199, but only ~8 files were in the plan's stated file list. The on-the-fly interpretation was "subagent shipped a Cards::DetailComponent extraction + new plan + new reviewer rule + 8-view migration on top of the 14 in-plan files." That interpretation was wrong. PR #140 (Cards::DetailComponent + drift-sentinel helper) merged to main from a separate stream during the wrapped phase, advancing main from `6ef1b2c` to `b85dc6a`. The wrapped subagent picked up fresh main during its work and correctly used the just-merged Cards component in the new mobile partial. Its handoff was honest — the Cards work was never claimed. The error was Erin's: `git diff <pre_sha>..working_tree` includes both the subagent's commits AND any commits that landed on the branch from elsewhere.

**Why v1 missed it:** The verification step says "Run `git diff --stat <pre_sha>` (no `..HEAD`) for verified files/lines." That command answers "what changed since pre_sha?" — which is the wrong question. The right question is "what changed *because of the subagent's work*?", and the answer requires distinguishing two diffs:

- `git diff <pre_sha>..HEAD` — commits on the branch since dispatch (subagent's commits AND parallel-stream merges)
- `git diff HEAD` — uncommitted working-tree changes (the subagent's in-flight work that didn't get committed)

The subagent's actual contribution is the second, plus any commits with the subagent in their author trail. The first diff is "everything that happened to the branch."

**v2 recommendation — replace the single-diff check with a two-diff comparison:**

Erin's verification step becomes:

```
1. Capture: COMMITS_SINCE_DISPATCH = git log <pre_sha>..HEAD --format="%H %s"
2. Capture: WORKING_TREE_FILES = git diff --stat HEAD --name-only
3. If COMMITS_SINCE_DISPATCH is non-empty AND those commits weren't authored by the wrapped phase,
   flag to user: "Main moved during wrapped phase. Commits: <list>. Working tree changes are still
   the subagent's work, but the diff against <pre_sha> includes parallel work."
4. The empty-success check applies to WORKING_TREE_FILES, not the full <pre_sha> diff.
```

This costs Erin one extra `git log` invocation and a name comparison. It produces a correct picture of what the subagent actually did versus what landed on the branch from elsewhere. The earlier "scope adherence" idea (add a field to the handoff schema) is unnecessary — the data is already in git.

**Cost:** ~10 lines added to Erin's verification step. No schema change. No new tooling.

### Issue 2: The wrapping win is partial

**Symptom:** `/ce:work` (wrapped, ~50 min) loaded the parent context with: dispatch prompt + handoff text. `/ce:review` (NOT wrapped) loaded the parent context with: 250 lines of skill expansion + 11 reviewer dispatches + their findings. Net: the parent context still grew substantially during the run.

**Why v1 chose this:** The spike's Workaround A constrains *what* can be wrapped (no skill that internally dispatches Agent). `/ce:review` and `/ce:user-scenarios` *do* internally dispatch — wrapping them via A would break them; wrapping them via B (claude -p subprocess) is the explicit v2 escape hatch flagged in the spike findings.

**v2 recommendation — three options, not all simultaneous:**

a. **Add a "review-and-personas via Workaround B" mode** for orchestrators that hit a long parent-context phase. Cost: real (subprocess overhead, streaming-fidelity regression per spike). Benefit: the only path to wrapping `/ce:review`'s diff dispatches without losing main-thread context.

b. **Add a "trim, don't wrap" pass to `/ce:review`** that writes its 250 lines of instructions to disk on first invocation and references the path on subsequent invocations within the same run. Lower-cost; partial mitigation; doesn't help the reviewer-dispatch payload bloat.

c. **Accept the partial win.** v1's value is "work no longer crowds the parent" — that's still true. Document in the wrapping prose that v1 wraps `work` and only `work`, that `review` and `user-scenarios` will continue to consume parent context, and trust the user to invoke them in fresh sessions or via worktree if context becomes a problem. This is the cheapest v2 and probably the right starting point — let dogfood evidence accumulate before reaching for B.

**Recommendation:** option (c) until a second dogfood run shows context bloat *during the review phase* actually breaks something. The current run's main thread is healthy enough to continue — the bloat is observable but not load-bearing.

### Issue 3: "Pre-PR checklist green" doesn't mean "no shipped bugs"

**Symptom:** The wrapped subagent passed `bin/rubocop`, `bin/rails test`, `bin/rails test:system` (1846/0/0, 394/0/0) and reported `status: success`. The reviewer panel then surfaced three race-condition manifestations in `mobile_evaluator_controller.js` that none of those tests cover, plus three required-by-plan acceptance tests that were never written. The bugs are real ("rating revert overwrites new player's rating after player switch", "retry closure posts to wrong player", "stale note response wipes fresh textarea"). They would have shipped silently.

**Why v1 missed it:** Erin's verification protocol checks the handoff's pre-PR checklist as a green/red signal. Green is treated as load-bearing; in reality, green only means "the tests we wrote pass." Plan-required acceptance tests that the subagent skipped (Unit 4 lines 352-354 explicitly required: cross-surface integration, player-switch-mid-debounce, note 500-retry) are exactly the tests that would have caught the bugs. The subagent didn't write them, so they didn't fail.

**v2 recommendation — small, targeted:**

Add a one-line check to Erin's verification protocol: **"For each plan unit, verify the test scenarios listed under that unit have a corresponding test in the diff."** This is a structural check, not a semantic one — Erin grep's the plan for `*Test scenarios:*` blocks, extracts the test names/descriptions, and confirms each appears in a test file in the diff (by name match or close paraphrase). If any are missing, that becomes a `partial` rather than `success` regardless of what the subagent reported.

This isn't bulletproof (the subagent could write tests with the right names but wrong assertions) but it catches the load-bearing case: the subagent skipped writing the tests entirely. Reviewer-panel quality (julik, correctness in this run) catches the rest.

**Cost:** ~15 lines added to the verification protocol. Requires Erin to parse the plan's "Test scenarios:" subsections, which are conventional but not strictly schematic. Acceptable for v2.

## What I would NOT change

- **Don't add `claimed_files`/`claimed_lines` back.** Per the spike's Charles-driven decision, `git diff` is truth. Re-adding self-report is solving the wrong problem.
- **Don't add a tiered sanity-check engine.** v1's empty-success-only is correct. The drift detection (Issue 1) and acceptance-test coverage (Issue 3) are *different* checks, not finer gradations of the empty-success rule.
- **Don't formalize an Erin-disagrees protocol.** When this run surfaced scope drift, judgment-as-usual worked: Erin presented options, user chose B. No protocol needed.
- **Don't pre-plan migration of run-state location.** Stayed at `docs/runs/<run-id>/` for the entire workflow with zero friction. Nothing to migrate.
- **Don't wrap `review` via Workaround A.** It would silently break (subagents can't call Agent; review IS Agent dispatch). The constraints in the wrapped-prompt are doing real work — preserve them.
- **Don't drop `model: opus` for the wrapped work phase.** The 50-minute run produced a substantial real feature; cost was justified for implementation work that exercised judgment in 5 distinct units.

## Behaviors observed but not actionable

- The two-write protocol on run-state (`about_to_dispatch` → SHA capture → `dispatched`) felt mechanical for the happy path. Considered shortening to single write; rejected because the second write is the *recovery anchor* if `/compact` lands between SHA capture and dispatch. Keep as-is.
- The wrapped subagent's "Dogfood observations" section in its handoff was unsolicited but useful (it noted "the system-reminder noise about TaskCreate/TaskUpdate was persistent and irrelevant"). Worth formalizing: the handoff schema could include an optional `## Process Notes` section so wrapped subagents have a documented place to say things back about the wrapping itself. Low priority.
- The wrapped subagent's `started`/`completed` timestamps used `-06:00` offset; the run-state's used `Z`. Tiny inconsistency, not a bug. The handoff schema should specify ISO-8601-with-Z to keep mtime reasoning consistent across files.

## Recommended v2 cut

Three changes, all small, all on the *protocol around* the wrapping (not the wrapping mechanism itself):

1. **Replace the single `git diff <pre_sha>` check with a two-diff comparison** (commits-since-dispatch via `git log <pre_sha>..HEAD`, working-tree-only via `git diff HEAD`). Erin can then see what the subagent actually did versus what landed on the branch from parallel streams. No handoff-schema change needed; the data is in git.
2. **Add plan-required-test coverage check** to Erin's verification step — grep plan for "Test scenarios:" blocks, intersect with test files in diff, downgrade `success` to `partial` if missing.
3. **Document v1's wrapping scope explicitly in Erin's prose:** "Only `work` is wrapped. `review`, `user-scenarios`, and any other Agent-dispatching skill stays in the parent thread. If parent-context bloat is a real problem during a phase, run that phase in a fresh session or worktree."

Combined cost: ~30 lines of prose edits to `erin.md` + the handoff schema in the same file. No new tooling, no new files, no escape to Workaround B.

## Verdict on v1

The mechanism — wrap the work phase via `Agent`, write run-state for `/compact` survival, verify with `git diff --stat <pre_sha>` and the handoff — works as designed and earned its keep on the very first real run. The three issues above are reinforcements, not redesigns. The original plan's instinct ("ship the cupcake, eat it, let usage tell you what to add next") was right; this dogfood is the cake-eating, and the v2 list is what usage said.

## Artifact integrity

- Run-state and handoff for this dogfood: `kick_scout/docs/runs/2026-05-08-22-03-44-erin-eval-draft-mobile/`
- Eval-draft mobile work product: 33 files in the kick_scout working tree against pre_sha `6ef1b2c`. User chose Path B: split into two commits/PRs at merge time (one for the in-plan eval-draft slice, one for the Cards::DetailComponent extraction). The race-condition bugs found by julik+correctness are P1 fix-before-merge; the three plan-required acceptance tests are also fix-before-merge. Eval-draft work is otherwise sound.
- Reviewer panel summary: 11 reviewers, parallel haiku dispatch, ~3 minutes wall-clock, depth-1 (worked as designed per spike).
