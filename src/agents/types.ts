import type { AgentKind } from "../core/types.js";

export interface AgentMcpServer {
  name: string;
  command: string;
  args: string[];
}

/** One phase execution handed to a coding agent. */
export interface AgentTask {
  /** Absolute path to the rendered instruction file (the full prompt). */
  promptFile: string;
  /** Working directory — the bug's git worktree. */
  cwd: string;
  timeoutMs: number;
  /** Full agent transcript is streamed here (already redacted). */
  transcriptFile: string;
  /** "edits": agent may edit files/run tools with guardrails. "full": skip all permission prompts. */
  autonomy: "edits" | "full";
  model: string | null;
  extraArgs: string[];
  /** MCP servers (debugger, DB inspector, UI driver, …) to expose to the agent. */
  mcp: AgentMcpServer[];
}

export interface AgentRunResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Tail of combined output for diagnostics when something goes wrong. */
  outputTail: string;
}

export interface AgentAvailability {
  available: boolean;
  path: string | null;
  version: string | null;
}

/**
 * Port implemented per coding agent (Claude Code, Cursor, Codex). The
 * pipeline is agent-agnostic: full instructions live in a prompt *file* and
 * the CLI invocation only points at it — which sidesteps Windows command-line
 * length limits and leaves an auditable record in the workspace.
 */
export interface CodingAgent {
  readonly kind: AgentKind;
  readonly displayName: string;
  readonly binary: string;
  isAvailable(): Promise<AgentAvailability>;
  run(task: AgentTask): Promise<AgentRunResult>;
}

export function pointerPrompt(promptFile: string): string {
  return (
    "You are running unattended inside Bugzinga, an automated bug-fixing pipeline. " +
    `Read the instruction file at "${promptFile}" first — it contains your complete instructions, ` +
    "all bug context, and the exact output contract you must fulfil. Follow it precisely and work " +
    "autonomously until done. There is no interactive user: never ask questions, never wait for input."
  );
}
