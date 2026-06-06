# Changelog

All notable changes to bugzinga are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-06-06

Initial release.

### Added
- Query DSL (`priority=2 AND severity=2 AND assignee=me`) with AND/OR/parens,
  compiled to Azure DevOps WIQL and GitHub issue-search qualifiers.
- Azure DevOps tracker adapter: WIQL querying, work-item normalization
  (priority, severity, repro steps, system info/environment, Found In),
  branch extraction from Git-ref artifact links, attachment/screenshot
  download, comments, pull-request creation, work-item comments.
- GitHub tracker adapter: issue search, issue-form/markdown section parsing
  (repro steps, environment, branch), linked-branch lookup via GraphQL,
  attachment extraction + download, label→priority/severity mapping with
  configurable formats, PR creation, issue comments.
- Agent adapters for Claude Code (`claude -p`), Cursor (`cursor-agent -p`),
  and Codex (`codex exec`) with autonomy tiers, prompt-file indirection,
  redacted transcripts, timeouts with process-tree kill, and MCP wiring for
  the Pointbreak debugger (Claude `--mcp-config`, Codex `-c` overrides).
- Seven-phase pipeline (reproduce → investigate → baseline → propose → fix →
  validate → report) with machine-checked `BUGZINGA_VERDICT` contracts,
  retry-with-feedback, validate→fix revalidation loops, repro-first gating,
  stale-artifact archiving, and crash-safe resumable state.
- Workspace layout compatible with the fix-bug Claude skill family
  (`C:\Bugs\<id>` with issue.md / existing-warnings.md / what-was-done.md /
  fix-failed.md), extended with bug.md, bug.json, repro.md, proposal.md,
  validation.md, screenshots/ and logs/.
- Per-bug git worktrees branched from the bug's source branch, concurrent
  processing, deterministic delivery (auto-commit, optional push / PR /
  tracker comment).
- CLI: `init`, `doctor`, `hunt`, `import`, `fix`, `status`, `report`.
- 74-test vitest suite including a real-git end-to-end pipeline test with a
  scripted fake agent; GitHub Actions CI on Windows + Ubuntu, Node 20/22.
