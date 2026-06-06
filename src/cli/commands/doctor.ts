import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { allAgents } from "../../agents/index.js";
import { findConfigFile, loadConfig, type ResolvedConfig } from "../../config/load.js";
import {
  adoPat,
  ADO_PAT_ENV_VARS,
  githubToken,
  GITHUB_TOKEN_ENV_VARS,
} from "../../config/tokens.js";
import { exec, findExecutable } from "../../util/exec.js";
import { ensureDir } from "../../util/fsx.js";
import { toMessage } from "../../util/errors.js";

type Status = "ok" | "warn" | "fail";

interface Check {
  status: Status;
  name: string;
  detail: string;
}

const GLYPH: Record<Status, string> = {
  ok: pc.green("✓"),
  warn: pc.yellow("!"),
  fail: pc.red("✗"),
};

function dirContains(root: string, needle: string, depth: number): boolean {
  if (!existsSync(root)) return false;
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name.toLowerCase().includes(needle)) return true;
      if (depth > 0 && entry.isDirectory() && dirContains(join(root, entry.name), needle, depth - 1)) {
        return true;
      }
    }
  } catch {}
  return false;
}

function fileContains(path: string, needle: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, "utf8").toLowerCase().includes(needle);
  } catch {
    return false;
  }
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("check that bugzinga, your tracker, and your coding agents are ready")
    .action(async () => {
      const checks: Check[] = [];
      const add = (status: Status, name: string, detail: string): void => {
        checks.push({ status, name, detail });
      };

      // Runtime
      const nodeMajor = Number(process.versions.node.split(".")[0]);
      add(
        nodeMajor >= 20 ? "ok" : "fail",
        "node",
        `v${process.versions.node}${nodeMajor >= 20 ? "" : " — bugzinga needs Node 20+"}`,
      );

      const gitPath = findExecutable("git");
      if (gitPath) {
        const result = await exec("git", ["--version"], { timeoutMs: 15_000 }).catch(() => null);
        add("ok", "git", result?.stdout.trim() ?? gitPath);
      } else {
        add("fail", "git", "not found on PATH — install git");
      }

      // Config
      let config: ResolvedConfig | null = null;
      const globalOpts = program.opts<{ config?: string }>();
      try {
        const path = findConfigFile(globalOpts.config);
        if (!path) {
          add("warn", "config", "no bugzinga.config.json found — run `bugzinga init`");
        } else {
          config = loadConfig(globalOpts.config);
          add("ok", "config", path);
        }
      } catch (err) {
        add("fail", "config", toMessage(err));
      }

      // Tracker credentials
      if (config?.tracker.kind === "azure") {
        add(
          adoPat() ? "ok" : "fail",
          "azure devops pat",
          adoPat()
            ? "found"
            : `not set — set one of ${ADO_PAT_ENV_VARS.join(", ")}`,
        );
      } else if (config?.tracker.kind === "github") {
        add(
          githubToken() ? "ok" : "fail",
          "github token",
          githubToken()
            ? "found"
            : `not set — set one of ${GITHUB_TOKEN_ENV_VARS.join(", ")}`,
        );
      }

      // Workspace root
      if (config) {
        try {
          ensureDir(config.bugsRoot);
          add("ok", "bugs root", config.bugsRoot);
        } catch (err) {
          add("fail", "bugs root", `${config.bugsRoot} not writable: ${toMessage(err)}`);
        }
        if (!config.build.command) {
          add(
            "warn",
            "build command",
            "build.command not set — agents will have to discover it (slower, less reliable)",
          );
        } else {
          add("ok", "build command", config.build.command);
        }
      }

      // Agents
      const selected = config?.agent.kind ?? "claude";
      for (const agent of allAgents()) {
        const availability = await agent.isAvailable();
        const isSelected = agent.kind === selected;
        const label = `${agent.displayName}${isSelected ? " (selected)" : ""}`;
        if (availability.available) {
          add("ok", label, availability.version ?? availability.path ?? "available");
        } else {
          add(isSelected ? "fail" : "warn", label, `\`${agent.binary}\` not found on PATH`);
        }
      }

      // Capability MCP servers (debugger, DB inspector, UI driver, …)
      if (config?.debugging.enabled) {
        if (config.debugging.mcp.length > 0) {
          add(
            "ok",
            "mcp servers",
            config.debugging.mcp.map((s) => `${s.name} (${s.command})`).join("; "),
          );
        } else {
          const hints: string[] = [];
          if (dirContains(join(homedir(), ".claude", "plugins"), "pointbreak", 2)) {
            hints.push("Claude Code pointbreak plugin detected");
          }
          if (fileContains(join(homedir(), ".cursor", "mcp.json"), "pointbreak")) {
            hints.push("Cursor MCP config has pointbreak");
          }
          if (fileContains(join(homedir(), ".codex", "config.toml"), "pointbreak")) {
            hints.push("Codex config has pointbreak");
          }
          add(
            hints.length > 0 ? "ok" : "warn",
            "debugger (pointbreak)",
            hints.length > 0
              ? hints.join("; ")
              : "no Pointbreak detected — agents fall back to instrumentation. " +
                  "Claude Code: /plugin marketplace add withpointbreak/pointbreak-claude && /plugin install pointbreak@pointbreak-claude. " +
                  "Or set debugging.mcp in bugzinga.config.json.",
          );
        }
      }

      console.log(`\n${pc.bold("bugzinga doctor")}\n`);
      const nameWidth = Math.max(...checks.map((c) => c.name.length));
      for (const check of checks) {
        const padding = " ".repeat(nameWidth - check.name.length + 2);
        console.log(`  ${GLYPH[check.status]} ${check.name}${padding}${pc.dim(check.detail)}`);
      }
      const fails = checks.filter((c) => c.status === "fail");
      console.log(
        fails.length === 0
          ? `\n${pc.green("All set.")} Try: ${pc.cyan('bugzinga hunt --dry-run --query "priority=2 AND severity=2 AND assignee=me"')}\n`
          : `\n${pc.red(`${fails.length} blocking issue(s).`)} Fix the ✗ items above and re-run.\n`,
      );
      if (fails.length > 0) process.exit(1);
    });
}
