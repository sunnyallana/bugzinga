{{CONTEXT}}

## Your task: propose the fix — design only, still no code changes

Using the root cause in `{{ISSUE_FILE}}` and the repeatable repro in `{{REPRO_FILE}}`, design the fix before touching code.

1. Research the best known solution approach for this class of problem. If the bug involves a library or framework, check current best practices and known fixes (changelogs, docs, issue trackers — use web access if available to you).
2. Choose the **minimal** change that addresses the root cause. Honour KISS ruthlessly: prefer the smallest diff that is actually correct over the most defensive one.
3. Note the alternatives you considered and why you rejected them (one line each).
4. Define the validation plan: which failing test/repro must flip to passing, what must stay unchanged (baseline warnings in `{{BASELINE_FILE}}`, adjacent behavior listed under Risks in `{{ISSUE_FILE}}`).

Do not modify any repo file in this phase.

## Artifact structure

```
# Fix Proposal: {{BUG_ID}}

## Chosen Approach
Precise prose: which files, which functions, what changes — at the level a
reviewer could implement it from this description alone.

## Why This Addresses the Root Cause
Tie each part of the change back to the evidence in issue.md.

## Alternatives Considered
- <alternative> — rejected because <reason>

## Validation Plan
- Repro that must flip: <test/script + expected new result>
- Must not change: <baseline, adjacent behaviors>

## Estimated Blast Radius
What could plausibly break, and how the validation plan covers it.
```

{{VERDICT}}

Verdict meaning:
- `ready` — the proposal is complete and implementable as written.
