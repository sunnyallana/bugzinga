/**
 * Shared vocabulary for the whole system. This module must stay dependency-free.
 */

export type TrackerKind = "azure" | "github";
export type AgentKind = "claude" | "cursor" | "codex";

/** Pipeline phases, in execution order. */
export const PHASES = [
  "reproduce",
  "investigate",
  "baseline",
  "propose",
  "fix",
  "validate",
  "report",
] as const;

export type PhaseId = (typeof PHASES)[number];

export function isPhaseId(value: string): value is PhaseId {
  return (PHASES as readonly string[]).includes(value);
}

/**
 * The artifact each phase must write into the bug workspace.
 * Names intentionally match the fix-bug / bug-investigator / build-verifier /
 * bug-reporter Claude skill contracts (issue.md, existing-warnings.md,
 * what-was-done.md) so workspaces are interchangeable with those skills.
 */
export const PHASE_ARTIFACTS: Record<PhaseId, string> = {
  reproduce: "repro.md",
  investigate: "issue.md",
  baseline: "existing-warnings.md",
  propose: "proposal.md",
  fix: "fix-attempts.md",
  validate: "validation.md",
  report: "what-was-done.md",
};

/**
 * Every phase artifact must contain a line `BUGZINGA_VERDICT: <value>`.
 * This is the deterministic contract between the nondeterministic agent and
 * the pipeline runner: the runner only trusts what it can parse.
 */
export const PHASE_VERDICTS: Record<PhaseId, readonly string[]> = {
  reproduce: ["reproduced", "not-reproduced"],
  investigate: ["complete"],
  baseline: ["complete"],
  propose: ["ready"],
  fix: ["fixed", "failed"],
  validate: ["validated", "not-fixed", "regression"],
  report: ["complete"],
};

/** Verdicts that allow the pipeline to advance to the next phase. */
export const SUCCESS_VERDICTS: Record<PhaseId, readonly string[]> = {
  reproduce: ["reproduced"],
  investigate: ["complete"],
  baseline: ["complete"],
  propose: ["ready"],
  fix: ["fixed"],
  validate: ["validated"],
  report: ["complete"],
};

export type PhaseStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "blocked";

/** Overall outcome of a bug run. */
export type BugOutcome =
  | "imported"
  | "in-progress"
  | "fixed"
  | "cannot-reproduce"
  | "failed";

export interface PhaseState {
  status: PhaseStatus;
  verdict: string | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  artifact: string | null;
  note: string | null;
}

export interface DeliveryState {
  committed: boolean;
  pushed: boolean;
  prUrl: string | null;
  commented: boolean;
}

/** Persisted to <workspace>/state.json after every transition. */
export interface BugState {
  version: 1;
  workspaceId: string;
  tracker: TrackerKind;
  bugId: string;
  title: string;
  url: string;
  agent: AgentKind | null;
  outcome: BugOutcome;
  branch: string | null;
  fixBranch: string | null;
  worktree: string | null;
  phases: Record<PhaseId, PhaseState>;
  delivery: DeliveryState;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function freshPhaseState(): PhaseState {
  return {
    status: "pending",
    verdict: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    artifact: null,
    note: null,
  };
}

export function freshPhases(): Record<PhaseId, PhaseState> {
  return {
    reproduce: freshPhaseState(),
    investigate: freshPhaseState(),
    baseline: freshPhaseState(),
    propose: freshPhaseState(),
    fix: freshPhaseState(),
    validate: freshPhaseState(),
    report: freshPhaseState(),
  };
}
