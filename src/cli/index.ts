#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { setVerbose } from "../util/logger.js";
import { BugzingaError } from "../util/errors.js";
import { registerInit } from "./commands/init.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerHunt } from "./commands/hunt.js";
import { registerImport } from "./commands/import.js";
import { registerFix } from "./commands/fix.js";
import { registerStatus } from "./commands/status.js";
import { registerReport } from "./commands/report.js";

function version(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("bugzinga")
  .description(
    "Bazinga for bugs. Query bugs from GitHub or Azure DevOps, import their full context\n" +
      "(branch, environment, repro steps, screenshots), then drive Claude Code, Cursor, or\n" +
      "Codex through reproduce → investigate → propose → fix → validate → report —\n" +
      "while you work on something else.",
  )
  .version(version())
  .option("-c, --config <path>", "path to bugzinga.config.json")
  .option("-v, --verbose", "verbose logging")
  .hook("preAction", () => {
    setVerbose(Boolean(program.opts<{ verbose?: boolean }>().verbose));
  });

registerInit(program);
registerDoctor(program);
registerHunt(program);
registerImport(program);
registerFix(program);
registerStatus(program);
registerReport(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof BugzingaError) {
    console.error(`${pc.red("✗")} ${err.message}`);
  } else {
    console.error(`${pc.red("✗")} Unexpected error:`, err);
  }
  process.exit(1);
});
