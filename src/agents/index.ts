import type { AgentKind } from "../core/types.js";
import { ClaudeCodeAgent } from "./claude.js";
import { CodexAgent } from "./codex.js";
import { CursorAgent } from "./cursor.js";
import type { CodingAgent } from "./types.js";

export type {
  AgentAvailability,
  AgentRunResult,
  AgentTask,
  CodingAgent,
} from "./types.js";

export function createAgent(kind: AgentKind): CodingAgent {
  switch (kind) {
    case "claude":
      return new ClaudeCodeAgent();
    case "cursor":
      return new CursorAgent();
    case "codex":
      return new CodexAgent();
  }
}

export function allAgents(): CodingAgent[] {
  return [new ClaudeCodeAgent(), new CursorAgent(), new CodexAgent()];
}
