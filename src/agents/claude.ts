import { dirname, join } from "node:path";
import { writeJsonAtomic } from "../util/fsx.js";
import { BaseAgent } from "./base.js";
import type { AgentTask } from "./types.js";

/**
 * Claude Code headless adapter (`claude -p`).
 *
 * Autonomy:
 *   edits → --permission-mode acceptEdits + explicit tool allowlist
 *   full  → --dangerously-skip-permissions (opt-in, for unattended runs)
 *
 * Debugging: when a Pointbreak (or other) MCP server is configured, it is
 * passed via --mcp-config so the agent can set real breakpoints and inspect
 * state instead of guessing from print statements.
 */
export class ClaudeCodeAgent extends BaseAgent {
  readonly kind = "claude" as const;
  readonly displayName = "Claude Code";
  readonly binary = "claude";

  protected buildArgs(task: AgentTask, prompt: string): string[] {
    const args = ["-p", prompt, "--output-format", "text"];
    if (task.autonomy === "full") {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push(
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Bash,Read,Write,Edit,MultiEdit,NotebookEdit,Glob,Grep,WebFetch,WebSearch,TodoWrite,Task",
      );
    }
    if (task.model) args.push("--model", task.model);
    if (task.mcp.length > 0) {
      const mcpConfigPath = join(dirname(task.transcriptFile), "mcp-config.json");
      writeJsonAtomic(mcpConfigPath, {
        mcpServers: Object.fromEntries(
          task.mcp.map((server) => [server.name, { command: server.command, args: server.args }]),
        ),
      });
      args.push("--mcp-config", mcpConfigPath);
    }
    return args;
  }
}
