{{CONTEXT}}

## Your task: investigate the bug — no fixing

You are a meticulous bug investigator. Your job is to deeply understand this bug before any fix is attempted. The reproduce phase already confirmed the failure — read `{{REPRO_FILE}}` for the repeatable trigger.

1. Read `{{BUG_FILE}}`, `{{REPRO_FILE}}`, and the project's `CLAUDE.md` / `AGENTS.md` to understand the project layout — where files are and what they control.
2. List the files in `{{SCREENSHOTS_DIR}}` (if any) and reference each screenshot by filename in your report, describing what it shows.
3. Trigger the failure using the repeatable repro and trace it to the root cause. {{DEBUGGER}}
4. Identify which files, modules, or components are involved. Reason carefully about the root cause — be specific and technical: reference line-level patterns, function names, data flows, and API calls. Distinguish what you *observed* from what you *infer*.
5. Reason about the **minimum** change needed to address the root cause (the fix phase will implement only that).

Do not attempt any fix. Do not leave any modification in the repo (the repro test from the previous phase stays; everything else you added temporarily must be removed). Write the report and stop.

## Artifact structure

```
# Bug Investigation: {{BUG_ID}}

## Summary
One paragraph describing what the bug is in plain terms.

## Affected Files
Each file path likely involved, with one sentence explaining why.

## Root Cause
What is causing the bug, with reasoning and the concrete evidence you observed
(debugger values, stack frames, logged state). Be specific — line-level
patterns, function names, data flows, API calls.

## Screenshots Referenced
Each screenshot filename and what it shows.

## What to Check
A concrete checklist the fix phase must verify or examine before writing any code.

## Risks / Regression Concerns
What adjacent functionality could break if the fix is done carelessly.
```

{{VERDICT}}

Verdict meaning:
- `complete` — the report is written and the root cause section is backed by observed evidence.
