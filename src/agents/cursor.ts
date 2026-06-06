import { BaseAgent } from "./base.js";
import type { AgentTask } from "./types.js";

/**
 * Cursor CLI adapter (`cursor-agent -p`).
 *
 * Cursor's non-interactive mode needs --force to execute commands; it has no
 * granular permission tiers, so both autonomy levels map to --force. MCP
 * servers are configured globally in ~/.cursor/mcp.json (bugzinga doctor
 * points this out when debugging is enabled).
 */
export class CursorAgent extends BaseAgent {
  readonly kind = "cursor" as const;
  readonly displayName = "Cursor";
  readonly binary = "cursor-agent";

  protected buildArgs(task: AgentTask, prompt: string): string[] {
    const args = ["-p", prompt, "--output-format", "text", "--force"];
    if (task.model) args.push("--model", task.model);
    return args;
  }
}
