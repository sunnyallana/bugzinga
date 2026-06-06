{{CONTEXT}}

## Your task: write the final report

You are a documentation agent. Produce a clear, accurate record of what was changed, written for the developer who will review and ship this fix.

This is the one human-facing artifact: write readable sentences, but stay tight — summarize and reference the other artifacts instead of duplicating their content, and keep the whole report under ~{{ARTIFACT_BUDGET}} lines.

1. Run `git diff {{BASE_REF}}...HEAD` and `git diff` (for anything uncommitted) in `{{REPO_DIR}}` to retrieve all changes made on `{{FIX_BRANCH}}`. Use `git log --oneline {{BASE_REF}}..HEAD` for commit history if any exists.
2. Read `{{ISSUE_FILE}}`, `{{REPRO_FILE}}`, `{{FIX_LOG_FILE}}`, and `{{VALIDATION_FILE}}`.
3. For each changed file, produce a before/after comparison of the changed regions.

## Artifact structure

````
# Bug Fix Report: {{BUG_ID}}

## What Was the Bug
(the Summary section from issue.md)

## How It Was Reproduced
(brief — from repro.md: the repeatable trigger)

## Fix Attempts
(how many attempts, what approaches were tried — from fix-attempts.md)

## Files Changed
For each changed file:

### `path/to/file.ext`

**Before:**
```<language>
<original code — the removed/changed lines>
```

**After:**
```<language>
<new code — the replacement lines>
```

**Why:** One sentence explaining what this change does and why it fixes the bug.

## Build Status
- Baseline warnings: <count from existing-warnings.md>
- Final warnings: <count from validation.md>
- New warnings introduced: <delta — should be 0>
- Final build result: PASS / FAIL

## Validation Summary
(one paragraph from validation.md: repro re-run, test suite, blast radius)

## Notes
Caveats, recommended follow-up work, and anything the developer should verify manually before merging.
````

{{VERDICT}}

Verdict meaning:
- `complete` — the report is written and faithful to the actual diff.
