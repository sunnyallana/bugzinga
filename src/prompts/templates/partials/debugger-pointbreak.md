### Debug with a real debugger (Pointbreak)

The Pointbreak debugger is available to you (as an MCP server and/or the `/debug`, `/step`, `/inspect` commands of the pointbreak plugin). Prefer real debugging over guesswork:

- Set breakpoints at function entry points, error-handling blocks, return statements, loop entries, and conditional branches along the repro path.
- Step through execution (over / into / out) while triggering the bug, and inspect variables — including nested properties — at each stop.
- Capture the exact observed values where state diverges from what the code expects; quote them in your artifact as evidence.

Fall back to temporary print/log instrumentation only if the debugger genuinely cannot attach to this project type, and remove all such instrumentation before you finish.
