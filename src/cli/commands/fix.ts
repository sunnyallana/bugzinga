import type { Command } from "commander";
import type { Bug } from "../../core/bug.js";
import { makeWorkspaceId } from "../../core/bug.js";
import { processBugs } from "../../pipeline/orchestrator.js";
import { Workspace } from "../../pipeline/workspace.js";
import { RepoManager, resolveRepoUrl } from "../../repo/git.js";
import { createTracker } from "../../trackers/index.js";
import { toMessage } from "../../util/errors.js";
import { readJsonIfExists } from "../../util/fsx.js";
import { createLogger } from "../../util/logger.js";
import { summarize } from "./hunt.js";
import {
  applyAgentOverrides,
  fail,
  loadCfgOrFail,
  parsePhase,
  parsePhaseList,
  requireAgent,
} from "../shared.js";

interface FixOpts {
  agent?: string;
  autonomy?: string;
  model?: string;
  fromPhase?: string;
  skip?: string;
  offline?: boolean;
}

export function registerFix(program: Command): void {
  program
    .command("fix <bugId>")
    .description("run the full pipeline on a single bug (fetches/refreshes it from the tracker first)")
    .option("-a, --agent <kind>", "coding agent: claude | cursor | codex")
    .option("--autonomy <level>", "agent autonomy: edits | full")
    .option("--model <model>", "model override for the agent")
    .option("--from-phase <phase>", "restart from this phase (resets it and everything after)")
    .option("--skip <phases>", "comma-separated phases to skip")
    .option("--offline", "use the already-imported workspace; don't contact the tracker")
    .action(async (bugId: string, opts: FixOpts) => {
      const config = loadCfgOrFail(program.opts<{ config?: string }>().config);
      applyAgentOverrides(config, opts);

      const log = createLogger("bugzinga");
      const tracker = createTracker(config);

      let bug: Bug | null = null;
      if (!opts.offline) {
        try {
          bug = await tracker.getBug(bugId);
        } catch (err) {
          log.warn(`could not fetch ${bugId} from ${tracker.label}: ${toMessage(err)}`);
        }
      }
      if (!bug) {
        // Fall back to a previously imported workspace.
        const workspaceId = makeWorkspaceId(config.tracker.kind, bugId.replace(/^GH-/i, ""));
        const ws = new Workspace(config.bugsRoot, workspaceId);
        bug = readJsonIfExists<Bug>(ws.path("bug.json"));
        if (!bug) {
          fail(
            `Bug ${bugId} could not be fetched and no imported workspace exists at ${ws.dir}. ` +
              `Check the id, or run \`bugzinga import --id ${bugId}\` first.`,
          );
        }
        log.info(`using previously imported context from ${ws.dir}`);
      }

      const agent = await requireAgent(config);
      const repo = new RepoManager(config, resolveRepoUrl(config, tracker.deriveRepoUrl()), log);

      const reports = await processBugs({ config, tracker, agent, repo, log }, [bug], {
        fromPhase: parsePhase(opts.fromPhase, "--from-phase"),
        skipPhases: parsePhaseList(opts.skip, "--skip"),
      });
      summarize(reports);
      if (reports.some((r) => !r.state || r.state.outcome !== "fixed")) {
        process.exitCode = 1;
      }
    });
}
