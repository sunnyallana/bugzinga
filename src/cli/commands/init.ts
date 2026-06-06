import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { CONFIG_FILENAME, exampleConfig } from "../../config/load.js";
import { writeFileAtomic } from "../../util/fsx.js";
import { fail } from "../shared.js";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("create a bugzinga.config.json in the current directory")
    .option("-t, --tracker <kind>", "tracker kind: azure or github", "azure")
    .option("-f, --force", "overwrite an existing config")
    .action((opts: { tracker: string; force?: boolean }) => {
      if (opts.tracker !== "azure" && opts.tracker !== "github") {
        fail(`Unknown tracker "${opts.tracker}" — expected azure or github.`);
      }
      const target = join(process.cwd(), CONFIG_FILENAME);
      if (existsSync(target) && !opts.force) {
        fail(`${CONFIG_FILENAME} already exists here. Use --force to overwrite.`);
      }
      writeFileAtomic(target, `${JSON.stringify(exampleConfig(opts.tracker), null, 2)}\n`);
      console.log(`${pc.green("✓")} wrote ${target}`);
      console.log(`
Next steps:
  1. Edit ${CONFIG_FILENAME}: fill in your ${
    opts.tracker === "azure" ? "organization/project/repository" : "owner/repo"
  } and real build/test commands.
  2. Set your token:${
    opts.tracker === "azure"
      ? `
       ${pc.cyan("$env:BUGZINGA_ADO_PAT = '<pat>'")}   (scopes: Work Items Read & Write, Code Read & Write)`
      : `
       ${pc.cyan("$env:BUGZINGA_GITHUB_TOKEN = '<token>'")}   (repo scope)`
  }
  3. Verify everything: ${pc.cyan("bugzinga doctor")}
  4. Dry-run a hunt:     ${pc.cyan('bugzinga hunt --query "priority=2 AND severity=2 AND assignee=me" --dry-run')}
`);
    });
}
