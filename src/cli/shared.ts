import pc from "picocolors";
import { createAgent, type CodingAgent } from "../agents/index.js";
import { loadConfig, type ResolvedConfig } from "../config/load.js";
import { isPhaseId, type AgentKind, type PhaseId } from "../core/types.js";
import { ConfigError } from "../util/errors.js";

export function fail(message: string): never {
  console.error(`${pc.red("✗")} ${message}`);
  process.exit(1);
}

export function loadCfgOrFail(configPath: string | undefined): ResolvedConfig {
  try {
    return loadConfig(configPath);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export interface AgentOverrides {
  agent?: string;
  autonomy?: string;
  model?: string;
}

export function applyAgentOverrides(config: ResolvedConfig, opts: AgentOverrides): void {
  if (opts.agent) {
    if (!["claude", "cursor", "codex"].includes(opts.agent)) {
      fail(`Unknown agent "${opts.agent}" — expected claude, cursor, or codex.`);
    }
    config.agent.kind = opts.agent as AgentKind;
  }
  if (opts.autonomy) {
    if (!["edits", "full"].includes(opts.autonomy)) {
      fail(`Unknown autonomy "${opts.autonomy}" — expected edits or full.`);
    }
    config.agent.autonomy = opts.autonomy as "edits" | "full";
  }
  if (opts.model) {
    // An explicit CLI --model beats everything, including per-phase models.
    config.agent.model = opts.model;
    config.agent.models = {};
  }
}

const INSTALL_HINTS: Record<AgentKind, string> = {
  claude: "npm install -g @anthropic-ai/claude-code   (then run `claude` once to sign in)",
  cursor: "install the Cursor CLI: https://cursor.com/cli (provides `cursor-agent`)",
  codex: "npm install -g @openai/codex   (then run `codex` once to sign in)",
};

export async function requireAgent(config: ResolvedConfig): Promise<CodingAgent> {
  const agent = createAgent(config.agent.kind);
  const availability = await agent.isAvailable();
  if (!availability.available) {
    throw new ConfigError(
      `The configured coding agent "${config.agent.kind}" (${agent.binary}) is not available on PATH.\n` +
        `  Install it: ${INSTALL_HINTS[config.agent.kind]}\n` +
        `  Or pick another agent with --agent claude|cursor|codex.`,
    );
  }
  return agent;
}

export function parsePhaseList(value: string | undefined, flag: string): PhaseId[] {
  if (!value) return [];
  const phases: PhaseId[] = [];
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (!isPhaseId(part)) {
      fail(
        `Invalid phase "${part}" for ${flag} — expected one or more of: reproduce, investigate, baseline, propose, fix, validate, report.`,
      );
    }
    phases.push(part);
  }
  return phases;
}

export function parsePhase(value: string | undefined, flag: string): PhaseId | null {
  if (!value) return null;
  if (!isPhaseId(value)) {
    fail(
      `Invalid phase "${value}" for ${flag} — expected one of: reproduce, investigate, baseline, propose, fix, validate, report.`,
    );
  }
  return value;
}

export function bazinga(): string {
  return pc.green(pc.bold("BUGZINGA!"));
}
