import type { Bug } from "../core/bug.js";
import {
  freshPhases,
  freshPhaseState,
  PHASES,
  type AgentKind,
  type BugOutcome,
  type BugState,
  type PhaseId,
} from "../core/types.js";

export function newBugState(bug: Bug, agent: AgentKind | null): BugState {
  const now = new Date().toISOString();
  return {
    version: 1,
    workspaceId: bug.workspaceId,
    tracker: bug.tracker,
    bugId: bug.id,
    title: bug.title,
    url: bug.url,
    agent,
    outcome: "imported",
    branch: bug.branch,
    fixBranch: null,
    worktree: null,
    phases: freshPhases(),
    delivery: { committed: false, pushed: false, prUrl: null, commented: false },
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Reset `from` and everything after it (used by --from-phase). */
export function resetFromPhase(state: BugState, from: PhaseId): PhaseId[] {
  const index = PHASES.indexOf(from);
  const reset = PHASES.slice(index);
  for (const id of reset) {
    state.phases[id] = freshPhaseState();
  }
  state.error = null;
  return [...reset];
}

export function isPipelineComplete(state: BugState): boolean {
  return PHASES.every(
    (id) => state.phases[id].status === "done" || state.phases[id].status === "skipped",
  );
}

/**
 * Outcome is always derived from phase states — never set independently —
 * so state.json can't disagree with itself.
 */
export function deriveOutcome(state: BugState): BugOutcome {
  const phases = state.phases;
  if (phases.reproduce.status === "blocked") return "cannot-reproduce";
  for (const id of PHASES) {
    const status = phases[id].status;
    if (status === "failed" || status === "blocked") return "failed";
  }
  if (isPipelineComplete(state)) return "fixed";
  const anyStarted = PHASES.some((id) => phases[id].status !== "pending");
  return anyStarted ? "in-progress" : "imported";
}
