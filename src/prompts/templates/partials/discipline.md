## Artifact discipline

Your artifact is machine-consumed by later phases — optimize for information density, not narrative:

- Telegraphic bullets, not prose paragraphs. Keep identifiers, file paths, line numbers, commands, and error text VERBATIM; compress everything around them.
- Never restate what an earlier artifact already establishes — reference it instead (e.g. "root cause: issue.md §Root Cause").
- Record only what a later phase or a human auditor needs to act on. Routine steps that simply worked get one line at most.
- Soft cap: {{ARTIFACT_BUDGET}} lines (excluding code/output blocks the structure explicitly asks for). Exceed it only for evidence that genuinely does not fit.
