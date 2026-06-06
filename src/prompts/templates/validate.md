{{CONTEXT}}

## Your task: independently validate the fix

Be adversarial. Your job is to find reasons this fix is NOT good — before a code reviewer or production does. Re-run everything yourself; trust no claim in `{{FIX_LOG_FILE}}` that you have not verified first-hand.

1. **Re-run the repeatable repro** from `{{REPRO_FILE}}`. The original failure must be gone: the failing test is now green / the script shows correct behavior. Capture the evidence.
2. **Re-run the build** and compare against `{{BASELINE_FILE}}`: zero new warnings, zero new errors allowed.
3. **Run the test suite**: {{TEST_COMMAND}}. If that says "not configured", discover it from `CLAUDE.md` / `AGENTS.md` / project files; if the project genuinely has no test suite, say so. No new failures versus the project's pre-existing state.
4. **Probe the blast radius.** Exercise the adjacent functionality named in `{{PROPOSAL_FILE}}` ("Estimated Blast Radius") and `{{ISSUE_FILE}}` ("Risks / Regression Concerns"). Don't just reason about it — actually run/exercise what can be exercised.
5. **Review the diff** (`git diff`) with fresh eyes: is every changed line necessary and minimal (KISS)? Is the regression test meaningful (would it have failed before the fix)? Flag anything unrelated, leftover instrumentation, or accidental file churn.

## Artifact structure

```
# Validation Report: {{BUG_ID}}

## Repro Re-run
Command + result, with evidence the original failure is gone.

## Build vs Baseline
Errors: baseline <n> → now <n>. Warnings: baseline <n> → now <n>. New: <n> (must be 0).

## Test Suite
Command + summary (pass/fail counts; any new failures listed).

## Blast-Radius Checks
What you exercised and what happened.

## Diff Review
KISS assessment; anything suspicious or unrelated in the diff.
```

{{VERDICT}}

Verdict meanings:
- `validated` — original failure gone, build clean vs baseline, no regressions found.
- `not-fixed` — the original failure still occurs.
- `regression` — the fix works but introduced new failures/warnings/behavior changes.
