import type { Command } from "commander";
import pc from "picocolors";
import { importBugToWorkspace } from "../../pipeline/workspace.js";
import { newBugState } from "../../pipeline/machine.js";
import { parseQuery } from "../../query/parser.js";
import { createTracker } from "../../trackers/index.js";
import { createLogger } from "../../util/logger.js";
import { bugListTable } from "./hunt.js";
import { fail, loadCfgOrFail } from "../shared.js";

interface ImportOpts {
  query?: string;
  id?: string;
  max: string;
}

export function registerImport(program: Command): void {
  program
    .command("import [query]")
    .description("query bugs and import them (context, screenshots) without running the pipeline")
    .option("-q, --query <query>", "bug query")
    .option("-i, --id <id>", "import a single bug by id")
    .option("-m, --max <n>", "maximum bugs to import", "10")
    .action(async (queryArg: string | undefined, opts: ImportOpts) => {
      const config = loadCfgOrFail(program.opts<{ config?: string }>().config);
      const log = createLogger("bugzinga");
      const tracker = createTracker(config);

      const bugs = opts.id
        ? [await tracker.getBug(opts.id)]
        : await (async () => {
            const queryText = queryArg ?? opts.query ?? config.defaultQuery;
            if (!queryText) {
              fail("No query given. Pass a query, use --id <bug-id>, or set defaultQuery in config.");
            }
            return tracker.queryBugs(parseQuery(queryText), {
              max: Math.max(1, Number(opts.max) || 10),
            });
          })();

      if (bugs.length === 0) {
        console.log(`${pc.yellow("!")} No bugs matched.`);
        return;
      }
      console.log(`\n${pc.bold(`Importing ${bugs.length} bug(s)`)}\n`);
      console.log(bugListTable(bugs));
      console.log("");

      for (const bug of bugs) {
        const ws = await importBugToWorkspace(bug, tracker, config.bugsRoot, log);
        if (!ws.readState()) ws.writeState(newBugState(bug, null));
        log.success(`${bug.workspaceId} → ${ws.dir}`);
      }
      console.log(
        `\nWorkspaces are ready under ${pc.cyan(config.bugsRoot)}.` +
          `\nRun the pipeline with ${pc.cyan("bugzinga fix <id>")} — or use your /fix-bug Claude skill on them directly.`,
      );
    });
}
