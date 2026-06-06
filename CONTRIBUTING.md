# Contributing to Bugzinga

## Setup

```powershell
npm install
npm run build      # tsc + copies src/prompts/templates into dist
npm test           # vitest (includes a real-git end-to-end pipeline test)
npm run lint
```

Node 20+ and git are required. The test suite needs no network access and no
tracker tokens — tracker logic is tested through exported pure helpers, and
the pipeline is tested end-to-end against a temporary local git repo with a
scripted fake agent.

## Architecture in one minute

Ports-and-adapters around a deterministic pipeline core:

- `src/query/` — query DSL: AST, recursive-descent parser, per-tracker
  compilers (WIQL, GitHub search). Pure functions; test here first.
- `src/trackers/` — `BugTracker` port + Azure DevOps / GitHub adapters.
  Adapters normalize everything into the `Bug` model (`src/core/bug.ts`).
- `src/agents/` — `CodingAgent` port + Claude Code / Cursor / Codex adapters.
  Agents receive a prompt *file* and a working directory; nothing else.
- `src/prompts/` — phase templates + partials with `{{VAR}}` substitution.
  Rendering throws on any unresolved variable.
- `src/pipeline/` — workspace layout, state machine, the runner (verdict
  verification, retries, revalidation loops), and the concurrency
  orchestrator.
- `src/repo/` — clone + per-bug worktree management.
- `src/cli/` — commander wiring only; commands stay thin.

**Adding a tracker** (e.g. Jira): implement `BugTracker` in
`src/trackers/jira.ts`, add a compiler for the query AST, register it in
`src/trackers/index.ts` and the config schema. No core changes.

**Adding an agent**: subclass `BaseAgent`, implement `buildArgs`, register in
`src/agents/index.ts`. No core changes.

## Rules of the road

- Every phase artifact contract change must update: the template, the
  `PHASE_VERDICTS`/`PHASE_ARTIFACTS` tables in `src/core/types.ts`, and the
  render tests.
- Anything that can print or log must pass through `redact()`.
- No new runtime dependencies without a strong reason — the dependency
  surface (commander, zod, picocolors) is deliberately tiny.
- `npm run build && npm run lint && npm test` must be green; CI runs the
  matrix on Windows + Ubuntu.
