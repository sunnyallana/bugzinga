import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentKind, PhaseId } from "../core/types.js";
import { ConfigError } from "../util/errors.js";
import { expandHome } from "../util/fsx.js";
import { configSchema, type RawConfig } from "./schema.js";

export interface ResolvedAzureTracker {
  kind: "azure";
  organization: string;
  project: string;
  repository: string | null;
  baseUrl: string;
}

export interface ResolvedGithubTracker {
  kind: "github";
  owner: string;
  repo: string;
  labels: { priority: string; severity: string };
}

export type ResolvedTracker = ResolvedAzureTracker | ResolvedGithubTracker;

export interface ResolvedMcpServer {
  name: string;
  command: string;
  args: string[];
}

export interface ResolvedConfig {
  tracker: ResolvedTracker;
  repo: { url: string | null; defaultBranch: string; root: string };
  agent: {
    kind: AgentKind;
    model: string | null;
    /** Per-phase model overrides; take precedence over `model` for that phase. */
    models: Partial<Record<PhaseId, string>>;
    autonomy: "edits" | "full";
    extraArgs: string[];
  };
  bugsRoot: string;
  build: { command: string | null; testCommand: string | null };
  pipeline: {
    concurrency: number;
    maxFixAttempts: number;
    phaseAttempts: number;
    reproRequired: boolean;
    revalidateLoops: number;
    skipPhases: PhaseId[];
    timeoutMinutes: Record<PhaseId, number>;
    deterministicBaseline: boolean;
  };
  delivery: {
    autoCommit: boolean;
    push: boolean;
    createPr: boolean;
    comment: boolean;
    branchPrefix: string;
    prTargetBranch: string | null;
  };
  debugging: {
    enabled: boolean;
    /** Capability MCP servers (debugger, DB inspector, UI driver, …) exposed to the agent. */
    mcp: ResolvedMcpServer[];
  };
  defaultQuery: string | null;
  configPath: string | null;
}

export const CONFIG_FILENAME = "bugzinga.config.json";

const DEFAULT_TIMEOUTS: Record<PhaseId, number> = {
  reproduce: 30,
  investigate: 20,
  baseline: 15,
  propose: 15,
  fix: 60,
  validate: 30,
  report: 10,
};

export function defaultBugsRoot(): string {
  // Matches the C:\Bugs\<id> convention used by the fix-bug Claude skills.
  return process.platform === "win32" ? "C:\\Bugs" : join(homedir(), "Bugs");
}

export function defaultRepoRoot(): string {
  return join(homedir(), ".bugzinga");
}

/** Walk up from cwd looking for bugzinga.config.json, then try ~/.bugzinga. */
export function findConfigFile(explicitPath?: string): string | null {
  if (explicitPath) {
    const full = resolve(expandHome(explicitPath));
    if (!existsSync(full)) {
      throw new ConfigError(`Config file not found: ${full}`);
    }
    return full;
  }
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const home = join(homedir(), ".bugzinga", "config.json");
  return existsSync(home) ? home : null;
}

/** Apply defaults to a validated raw config. Pure — unit-testable. */
export function resolveConfig(raw: RawConfig, configPath: string | null): ResolvedConfig {
  const tracker: ResolvedTracker =
    raw.tracker.kind === "azure"
      ? {
          kind: "azure",
          organization: raw.tracker.organization,
          project: raw.tracker.project,
          repository: raw.tracker.repository ?? null,
          baseUrl: (raw.tracker.baseUrl ?? "https://dev.azure.com").replace(/\/+$/, ""),
        }
      : {
          kind: "github",
          owner: raw.tracker.owner,
          repo: raw.tracker.repo,
          labels: {
            priority: raw.tracker.labels?.priority ?? "priority:{n}",
            severity: raw.tracker.labels?.severity ?? "severity:{n}",
          },
        };

  return {
    tracker,
    repo: {
      url: raw.repo?.url ?? null,
      defaultBranch: raw.repo?.defaultBranch ?? "main",
      root: expandHome(raw.repo?.root ?? defaultRepoRoot()),
    },
    agent: {
      kind: raw.agent?.kind ?? "claude",
      model: raw.agent?.model ?? null,
      models: Object.fromEntries(
        Object.entries(raw.agent?.models ?? {}).filter(([, v]) => v !== undefined),
      ) as Partial<Record<PhaseId, string>>,
      autonomy: raw.agent?.autonomy ?? "edits",
      extraArgs: raw.agent?.extraArgs ?? [],
    },
    bugsRoot: expandHome(raw.bugsRoot ?? defaultBugsRoot()),
    build: {
      command: raw.build?.command ?? null,
      testCommand: raw.build?.testCommand ?? null,
    },
    pipeline: {
      concurrency: raw.pipeline?.concurrency ?? 2,
      maxFixAttempts: raw.pipeline?.maxFixAttempts ?? 5,
      phaseAttempts: raw.pipeline?.phaseAttempts ?? 2,
      reproRequired: raw.pipeline?.reproRequired ?? true,
      revalidateLoops: raw.pipeline?.revalidateLoops ?? 1,
      skipPhases: raw.pipeline?.skipPhases ?? [],
      timeoutMinutes: {
        ...DEFAULT_TIMEOUTS,
        ...Object.fromEntries(
          Object.entries(raw.pipeline?.timeoutMinutes ?? {}).filter(
            ([, v]) => v !== undefined,
          ),
        ),
      },
      deterministicBaseline: raw.pipeline?.deterministicBaseline ?? true,
    },
    delivery: {
      autoCommit: raw.delivery?.autoCommit ?? true,
      push: raw.delivery?.push ?? false,
      createPr: raw.delivery?.createPr ?? false,
      comment: raw.delivery?.comment ?? false,
      branchPrefix: raw.delivery?.branchPrefix ?? "bugzinga/",
      prTargetBranch: raw.delivery?.prTargetBranch ?? null,
    },
    debugging: {
      enabled: raw.debugging?.enabled ?? true,
      mcp: (raw.debugging?.mcp === undefined
        ? []
        : Array.isArray(raw.debugging.mcp)
          ? raw.debugging.mcp
          : [raw.debugging.mcp]
      ).map((server) => ({
        name: server.name,
        command: server.command,
        args: server.args ?? [],
      })),
    },
    defaultQuery: raw.defaultQuery ?? null,
    configPath,
  };
}

export function parseConfigText(text: string, configPath: string | null): ResolvedConfig {
  let json: unknown;
  try {
    // Windows editors (Notepad, PowerShell Set-Content) emit a UTF-8 BOM.
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new ConfigError(
      `${configPath ?? "config"} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config${configPath ? ` (${configPath})` : ""}:\n${issues}`);
  }
  return resolveConfig(parsed.data, configPath);
}

export function loadConfig(explicitPath?: string): ResolvedConfig {
  const path = findConfigFile(explicitPath);
  if (!path) {
    throw new ConfigError(
      `No ${CONFIG_FILENAME} found in this directory, any parent, or ~/.bugzinga/config.json. Run \`bugzinga init\` to create one.`,
    );
  }
  return parseConfigText(readFileSync(path, "utf8"), path);
}

/** Example config used by `bugzinga init`. */
export function exampleConfig(kind: "azure" | "github"): Record<string, unknown> {
  const tracker =
    kind === "azure"
      ? {
          kind: "azure",
          organization: "your-organization",
          project: "Your Project",
          repository: "your-repo",
        }
      : {
          kind: "github",
          owner: "your-org",
          repo: "your-repo",
          labels: { priority: "priority:{n}", severity: "severity:{n}" },
        };
  return {
    tracker,
    repo: { defaultBranch: "main" },
    agent: { kind: "claude", autonomy: "edits" },
    bugsRoot: defaultBugsRoot(),
    build: {
      command: "<your build command, e.g. npm run build or dotnet build>",
      testCommand: "<your test command, e.g. npm test>",
    },
    pipeline: {
      concurrency: 2,
      maxFixAttempts: 5,
      reproRequired: true,
    },
    delivery: {
      autoCommit: true,
      push: false,
      createPr: false,
      comment: false,
    },
    debugging: { enabled: true },
    defaultQuery: "priority=2 AND severity=2 AND assignee=me",
  };
}
