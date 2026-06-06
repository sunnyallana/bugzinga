import { BaseAgent } from "./base.js";
import type { AgentTask } from "./types.js";

/**
 * OpenAI Codex CLI adapter (`codex exec`).
 *
 * Autonomy:
 *   edits → --full-auto (workspace-write sandbox, no approval prompts)
 *   full  → --dangerously-bypass-approvals-and-sandbox
 *
 * MCP servers are passed as -c config overrides (codex parses them as TOML).
 */
export class CodexAgent extends BaseAgent {
  readonly kind = "codex" as const;
  readonly displayName = "Codex";
  readonly binary = "codex";

  protected buildArgs(task: AgentTask, prompt: string): string[] {
    const args = ["exec", "--skip-git-repo-check"];
    if (task.autonomy === "full") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("--full-auto");
    }
    if (task.model) args.push("--model", task.model);
    for (const server of task.mcp) {
      args.push("-c", `mcp_servers.${server.name}.command=${JSON.stringify(server.command)}`);
      if (server.args.length > 0) {
        args.push("-c", `mcp_servers.${server.name}.args=${JSON.stringify(server.args)}`);
      }
    }
    args.push(prompt);
    return args;
  }
}
