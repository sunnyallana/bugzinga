/** Programmatic API — everything the CLI uses is exported here. */

export type { Bug, BugAttachment, BugComment } from "./core/bug.js";
export {
  makeWorkspaceId,
  parseAdoSeverity,
  renderBugMarkdown,
} from "./core/bug.js";
export {
  PHASES,
  PHASE_ARTIFACTS,
  PHASE_VERDICTS,
  SUCCESS_VERDICTS,
  type AgentKind,
  type BugOutcome,
  type BugState,
  type PhaseId,
  type PhaseState,
  type TrackerKind,
} from "./core/types.js";

export { loadConfig, parseConfigText, resolveConfig, exampleConfig, type ResolvedConfig } from "./config/load.js";

export { parseQuery } from "./query/parser.js";
export { formatQuery, type QueryNode } from "./query/ast.js";
export { buildWiql, compileWiqlWhere } from "./query/wiql.js";
export { compileGithubSearch } from "./query/github-search.js";

export { createTracker, type BugTracker } from "./trackers/index.js";
export { createAgent, allAgents, type CodingAgent } from "./agents/index.js";
export { RepoManager, resolveRepoUrl } from "./repo/git.js";

export { runBugPipeline, type PipelineOptions } from "./pipeline/runner.js";
export { processBugs, type BugRunReport } from "./pipeline/orchestrator.js";
export { Workspace, importBugToWorkspace, parseVerdict } from "./pipeline/workspace.js";
export { deriveOutcome, newBugState } from "./pipeline/machine.js";
export { renderPhasePrompt, substitute } from "./prompts/render.js";
