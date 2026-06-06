### Debug with evidence, not speculation

- If a debugger tool/MCP server is available in your environment (e.g. Pointbreak), use it: breakpoints at function entries, error-handling blocks, return statements, and conditional branches along the repro path; step through and inspect variable values.
- Otherwise, gather concrete evidence with targeted temporary instrumentation (focused logging, a failing unit test, REPL probes) — capture exact values, not impressions.
- Quote the observed evidence in your artifact. Remove all temporary instrumentation before you finish.
