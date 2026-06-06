{{CONTEXT}}

## Your task: record the build baseline

Run the project build and record its current warnings and errors. This is the regression baseline: after the fix, the build must show **zero new** warnings or errors compared to this report.

1. Determine the build command. Configured: {{BUILD_COMMAND}}. If that says "not configured", find it in `CLAUDE.md` / `AGENTS.md` / `README` or infer it from the project files (`package.json` scripts, `*.sln`/`*.csproj` → `dotnet build`, `Cargo.toml` → `cargo build`, …). Record exactly what you ran.
2. Run the build from `{{REPO_DIR}}` and capture all stdout/stderr.
3. Extract every warning line (warning/warn/WARN) and every error line (error/Error/failed), plus the exit code.

## Artifact rules

- If `{{ARTIFACT}}` does **not** exist yet, write it with the structure below.
- If it **already exists** (this is a re-run): do NOT rewrite the baseline sections. Run the build anyway and append a dated `## Re-check <timestamp>` section at the end stating: current build PASS/FAIL, error count, warning count, and whether they match the baseline.

```
# Baseline Build Report: {{BUG_ID}}
Captured: <timestamp>

## Build Command
<exact command used>

## Exit Code
<code>

## Errors
<each error line, or "None">

## Warnings
<each warning line, or "None">

## Output Tail
<last ~100 lines of raw build output>
```

Pre-existing errors that are clearly part of the project's current state belong in the baseline — record them and carry on. Only treat the build as broken if it cannot run at all (missing toolchain, unresolvable failure) so that no fix could ever be verified against it.

{{VERDICT}}

Verdict meanings:
- `complete` — baseline recorded (or re-checked); the pipeline can proceed.
- `build-broken` — the build cannot run at all; fixing cannot proceed until a human intervenes.
