{{CONTEXT}}

## Your task: reproduce the bug

Nothing gets fixed until the failure has been observed first-hand. Confirming the bug exists — and knowing exactly how to trigger it on demand — is the foundation every later phase builds on.

1. Read `{{BUG_FILE}}` in full. Study the repro steps, the environment the bug was produced on, and every screenshot in `{{SCREENSHOTS_DIR}}` (open the images — they usually show the exact error and UI state).
2. Read the repo's `CLAUDE.md` / `AGENTS.md` / `README` to learn how to build and run this project. Install dependencies and build if needed.
3. Set up the closest practical match to the bug's environment. Environment from the bug report: {{ENVIRONMENT_NOTE}}. Record any difference you could not match.
4. Follow the repro steps and try to trigger the failure. If the literal steps don't trigger it, try reasonable interpretations (data variations, timing, state preconditions) before giving up. {{DEBUGGER}}
5. Once you can trigger it, make the reproduction REPEATABLE:
   - **Best:** a minimal automated test inside the repo that fails for the bug's root reason. Keep it in place — later phases run it, the fix must turn it green, and it ships as the regression test.
   - If an automated test is impractical here, save a script to `{{WORKSPACE}}/repro/` (e.g. `repro.ps1`, `repro.sh`, a curl sequence) plus precise manual steps.
6. Capture evidence verbatim: exact error messages, stack traces, observed vs expected behavior.

If you genuinely cannot reproduce the failure after thorough, good-faith attempts, write the report anyway — exactly what you tried and what you observed instead is valuable for whoever picks this up.

## Artifact structure

```
# Reproduction Report: {{BUG_ID}}

## Environment Used
(what you actually ran on, and differences from the bug's reported environment)

## Steps Executed
(numbered — exactly what you did, so anyone can repeat it)

## Result
(the observed failure: verbatim error output / stack trace / wrong behavior, vs what was expected)

## Repeatable Repro
(test file path + run command, or script path under {{WORKSPACE}}/repro/ + how to run it)

## Notes for Investigation
(first clues: where the failure surfaces, suspicious modules or values)
```

{{VERDICT}}

Verdict meanings:
- `reproduced` — you observed the failure and have a repeatable way to trigger it.
- `not-reproduced` — you could not trigger the failure despite thorough attempts.
