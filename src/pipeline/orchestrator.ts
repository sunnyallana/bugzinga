import { join } from "node:path";
import type { CodingAgent } from "../agents/index.js";
import type { ResolvedConfig } from "../config/load.js";
import type { Bug } from "../core/bug.js";
import type { BugState } from "../core/types.js";
import type { RepoManager } from "../repo/git.js";
import type { BugTracker } from "../trackers/types.js";
import { toMessage } from "../util/errors.js";
import { createLogger, type Logger } from "../util/logger.js";
import { mapWithConcurrency } from "../util/pool.js";
import { runBugPipeline, type PipelineOptions } from "./runner.js";
import { importBugToWorkspace } from "./workspace.js";

export interface OrchestratorDeps {
  config: ResolvedConfig;
  tracker: BugTracker;
  agent: CodingAgent;
  repo: RepoManager;
  log: Logger;
}

export interface BugRunReport {
  bug: Bug;
  state: BugState | null;
  error: string | null;
}

export interface ProcessOptions extends PipelineOptions {
  concurrency?: number;
}

/**
 * Process a batch of bugs concurrently. Each bug gets its own workspace,
 * worktree, and log file; failures are isolated — one bug blowing up never
 * takes the batch down.
 */
export async function processBugs(
  deps: OrchestratorDeps,
  bugs: Bug[],
  opts: ProcessOptions = {},
): Promise<BugRunReport[]> {
  const concurrency = opts.concurrency ?? deps.config.pipeline.concurrency;
  deps.log.info(
    `processing ${bugs.length} bug(s) with ${deps.agent.displayName}, concurrency ${concurrency}`,
  );

  return mapWithConcurrency(bugs, concurrency, async (bug): Promise<BugRunReport> => {
    const log = createLogger(
      bug.workspaceId,
      join(deps.config.bugsRoot, bug.workspaceId, "logs", "bugzinga.log"),
    );
    try {
      const ws = await importBugToWorkspace(bug, deps.tracker, deps.config.bugsRoot, log);
      const state = await runBugPipeline({ ...deps, log }, bug, ws, opts);
      return { bug, state, error: state.error };
    } catch (err) {
      const message = toMessage(err);
      log.error(`pipeline crashed: ${message}`);
      return { bug, state: null, error: message };
    }
  });
}
