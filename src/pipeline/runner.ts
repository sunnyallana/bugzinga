import type { AgentRunResult, CodingAgent } from "../agents/index.js";
import type { ResolvedConfig } from "../config/load.js";
import type { Bug } from "../core/bug.js";
import {
  freshPhaseState,
  PHASES,
  PHASE_ARTIFACTS,
  PHASE_VERDICTS,
  SUCCESS_VERDICTS,
  type BugState,
  type PhaseId,
} from "../core/types.js";
import {
  renderPhasePrompt,
  type DebuggerMode,
  type PromptVars,
} from "../prompts/render.js";
import type { RepoManager, WorktreeInfo } from "../repo/git.js";
import type { BugTracker } from "../trackers/types.js";
import { toMessage } from "../util/errors.js";
import { readTextIfExists, writeFileAtomic } from "../util/fsx.js";
import type { Logger } from "../util/logger.js";
import { runDeterministicBaseline } from "./baseline.js";
import { deriveOutcome, newBugState, resetFromPhase } from "./machine.js";
import { parseVerdict, type Workspace } from "./workspace.js";

export interface PipelineDeps {
  config: ResolvedConfig;
  tracker: BugTracker;
  agent: CodingAgent;
  repo: RepoManager;
  log: Logger;
}

export interface PipelineOptions {
  /** Restart from this phase, resetting it and everything after. */
  fromPhase?: PhaseId | null;
  /** Extra phases to skip for this run (merged with config.pipeline.skipPhases). */
  skipPhases?: PhaseId[];
}

interface PhaseOutcome {
  kind: "done" | "blocked" | "failed" | "revalidate";
  verdict: string | null;
}

/**
 * Drive one bug through reproduce → investigate → baseline → propose → fix →
 * validate → report. The runner is the deterministic harness around the
 * nondeterministic agent: it renders instructions, enforces timeouts,
 * verifies artifact + verdict after every phase, retries with feedback,
 * loops fix↔validate when validation rejects the fix, and persists state
 * after every transition so a crash or Ctrl+C is always resumable.
 */
export async function runBugPipeline(
  deps: PipelineDeps,
  bug: Bug,
  ws: Workspace,
  opts: PipelineOptions = {},
): Promise<BugState> {
  const { config, agent, repo, log } = deps;

  let state = ws.readState();
  if (!state || state.version !== 1) state = newBugState(bug, agent.kind);
  state.agent = agent.kind;
  state.title = bug.title;
  state.url = bug.url;
  state.branch = bug.branch ?? state.branch;
  state.error = null;

  if (opts.fromPhase) {
    const reset = resetFromPhase(state, opts.fromPhase);
    for (const phase of reset) ws.archiveArtifact(phase, 0);
    log.info(`restarting from phase "${opts.fromPhase}"`);
  }
  ws.writeState(state);

  let worktree: WorktreeInfo;
  try {
    worktree = await repo.ensureWorktree(bug.workspaceId, bug.branch);
  } catch (err) {
    state.error = `worktree setup failed: ${toMessage(err)}`;
    state.outcome = "failed";
    ws.writeState(state);
    log.error(state.error);
    return state;
  }
  state.worktree = worktree.dir;
  state.fixBranch = worktree.fixBranch;
  ws.writeState(state);

  const skip = new Set<PhaseId>([...config.pipeline.skipPhases, ...(opts.skipPhases ?? [])]);
  let revalidationsLeft = config.pipeline.revalidateLoops;
  let fixFeedback: string | null = null;

  let index = 0;
  while (index < PHASES.length) {
    const phase = PHASES[index] as PhaseId;
    const phaseState = state.phases[phase];

    if (phaseState.status === "done" || phaseState.status === "skipped") {
      index++;
      continue;
    }
    if (skip.has(phase)) {
      phaseState.status = "skipped";
      phaseState.note = "skipped by configuration";
      ws.writeState(state);
      log.info(`phase ${phase}: skipped (configured)`);
      index++;
      continue;
    }

    const outcome = await runPhase(
      deps,
      bug,
      ws,
      state,
      worktree,
      phase,
      phase === "fix" ? fixFeedback : null,
    );
    ws.writeState(state);

    if (outcome.kind === "done") {
      index++;
      continue;
    }

    if (outcome.kind === "revalidate") {
      if (revalidationsLeft > 0) {
        revalidationsLeft--;
        fixFeedback = revalidateFeedback(ws, outcome.verdict);
        state.phases.fix = freshPhaseState();
        state.phases.validate = freshPhaseState();
        ws.archiveArtifact("fix", 0);
        ws.archiveArtifact("validate", 0);
        ws.writeState(state);
        log.warn(
          `validation verdict "${outcome.verdict}" — looping back to fix (${revalidationsLeft} revalidation(s) left)`,
        );
        index = PHASES.indexOf("fix");
        continue;
      }
      state.phases.validate.status = "failed";
      state.phases.validate.note = `verdict "${outcome.verdict}" with no revalidation budget left`;
      ws.writeState(state);
      break;
    }

    if (phase === "reproduce" && outcome.kind === "blocked" && !config.pipeline.reproRequired) {
      phaseState.status = "skipped";
      phaseState.note = "could not reproduce — continuing because pipeline.reproRequired=false";
      ws.writeState(state);
      log.warn("bug not reproduced; continuing anyway (reproRequired=false)");
      index++;
      continue;
    }

    break; // blocked or failed → pipeline stops here
  }

  state.outcome = deriveOutcome(state);
  await finalize(deps, bug, ws, state, worktree);
  ws.writeState(state);
  return state;
}

async function runPhase(
  deps: PipelineDeps,
  bug: Bug,
  ws: Workspace,
  state: BugState,
  worktree: WorktreeInfo,
  phase: PhaseId,
  injectedFeedback: string | null,
): Promise<PhaseOutcome> {
  const { config, agent, log } = deps;
  const phaseState = state.phases[phase];
  const maxAttempts = config.pipeline.phaseAttempts;
  const timeoutMinutes = config.pipeline.timeoutMinutes[phase];
  const phaseIndex = PHASES.indexOf(phase);

  // Resume shortcut: a previous run crashed after the artifact was written.
  if (phaseState.status === "running") {
    const verdict = parseVerdict(ws.readArtifact(phase));
    if (verdict && PHASE_VERDICTS[phase].includes(verdict)) {
      log.info(`phase ${phase}: adopting artifact from interrupted run (verdict "${verdict}")`);
      return evaluateVerdict(state, phase, verdict);
    }
  }

  // Baseline is mechanical when the build command is known — run it as a
  // plain script instead of burning an agent session. Falls back to the
  // agent if the script itself crashes (not if the build merely fails).
  if (phase === "baseline" && config.pipeline.deterministicBaseline && config.build.command) {
    phaseState.attempts++;
    phaseState.status = "running";
    phaseState.startedAt = phaseState.startedAt ?? new Date().toISOString();
    ws.writeState(state);
    log.info(`phase baseline: deterministic (no agent) — ${config.build.command}`);
    try {
      const verdict = await runDeterministicBaseline({
        bugId: bug.workspaceId,
        buildCommand: config.build.command,
        testCommand: config.build.testCommand,
        cwd: worktree.dir,
        artifactPath: ws.artifactPath("baseline"),
        timeoutMs: timeoutMinutes * 60_000,
      });
      const result = evaluateVerdict(state, phase, verdict);
      if (result.kind === "done") {
        log.success(`phase baseline: ${verdict} (deterministic)`);
      } else {
        log.warn(`phase baseline: verdict "${verdict}" (deterministic)`);
      }
      return result;
    } catch (err) {
      phaseState.attempts--; // the script crash must not consume the agent's budget
      log.warn(`deterministic baseline crashed (${toMessage(err)}) — falling back to the agent`);
    }
  }

  let feedback = injectedFeedback ?? "";
  while (phaseState.attempts < maxAttempts) {
    phaseState.attempts++;
    phaseState.status = "running";
    phaseState.startedAt = phaseState.startedAt ?? new Date().toISOString();
    ws.writeState(state);

    // Never let a stale artifact's verdict be mistaken for this attempt's.
    if (phase !== "baseline" && phaseState.attempts > 1) {
      ws.archiveArtifact(phase, phaseState.attempts - 1);
    }

    let prompt: string;
    try {
      prompt = renderPhasePrompt({
        phase,
        vars: buildPromptVars(config, bug, ws, worktree, phase, feedback),
        debuggerMode: debuggerModeFor(deps),
      });
    } catch (err) {
      // A template/var bug is a programming error — no point retrying.
      phaseState.status = "failed";
      phaseState.note = `prompt rendering failed: ${toMessage(err)}`;
      phaseState.finishedAt = new Date().toISOString();
      log.error(phaseState.note);
      return { kind: "failed", verdict: null };
    }

    const promptFile = ws.path("logs", `phase-${phaseIndex}-${phase}.prompt.md`);
    writeFileAtomic(promptFile, prompt);
    const transcriptFile = ws.path("logs", `phase-${phaseIndex}-${phase}.log`);

    log.info(
      `phase ${phase}: attempt ${phaseState.attempts}/${maxAttempts} via ${agent.displayName} (timeout ${timeoutMinutes}m)`,
    );

    let run: AgentRunResult | null = null;
    try {
      run = await agent.run({
        promptFile,
        cwd: worktree.dir,
        timeoutMs: timeoutMinutes * 60_000,
        transcriptFile,
        autonomy: config.agent.autonomy,
        model: config.agent.models[phase] ?? config.agent.model,
        extraArgs: config.agent.extraArgs,
        mcp: config.debugging.enabled ? config.debugging.mcp : [],
      });
    } catch (err) {
      feedback = `Your previous attempt crashed before completing: ${toMessage(err)}.`;
      log.warn(`phase ${phase}: agent crashed — ${toMessage(err)}`);
      continue;
    }

    const verdict = parseVerdict(ws.readArtifact(phase));
    if (verdict && PHASE_VERDICTS[phase].includes(verdict)) {
      if (!run.ok) {
        log.warn(
          `phase ${phase}: agent exited ${run.exitCode}${run.timedOut ? " (timed out)" : ""} but a valid artifact exists — accepting it`,
        );
      }
      const result = evaluateVerdict(state, phase, verdict);
      const minutes = Math.round(run.durationMs / 60_000);
      if (result.kind === "done") {
        log.success(`phase ${phase}: ${verdict} (${minutes}m, attempt ${phaseState.attempts})`);
      } else {
        log.warn(`phase ${phase}: verdict "${verdict}" (${minutes}m)`);
      }
      return result;
    }

    const artifactName = PHASE_ARTIFACTS[phase];
    if (run.timedOut) {
      feedback =
        `Your previous attempt hit the ${timeoutMinutes}-minute timeout before producing a valid artifact. ` +
        `Budget your time: do the essential work first and write ${artifactName} with its BUGZINGA_VERDICT line before polishing anything.`;
    } else if (verdict) {
      feedback =
        `Your previous attempt wrote "${verdict}" as the verdict, which is not valid for this phase. ` +
        `The verdict must be one of: ${PHASE_VERDICTS[phase].join(" | ")}.`;
    } else {
      feedback =
        `Your previous attempt finished (exit ${run.exitCode}) without writing the required artifact ` +
        `${artifactName} ending in a BUGZINGA_VERDICT line. The artifact file is mandatory.`;
    }
    log.warn(`phase ${phase}: ${feedback}`);
  }

  phaseState.status = "failed";
  phaseState.note = feedback || `no valid artifact after ${maxAttempts} attempts`;
  phaseState.finishedAt = new Date().toISOString();
  log.error(`phase ${phase}: failed after ${phaseState.attempts} attempt(s)`);
  return { kind: "failed", verdict: null };
}

/** Map a valid verdict onto phase state + pipeline consequence. */
function evaluateVerdict(state: BugState, phase: PhaseId, verdict: string): PhaseOutcome {
  const phaseState = state.phases[phase];
  phaseState.verdict = verdict;
  phaseState.finishedAt = new Date().toISOString();
  phaseState.artifact = PHASE_ARTIFACTS[phase];

  if (SUCCESS_VERDICTS[phase].includes(verdict)) {
    phaseState.status = "done";
    phaseState.note = null;
    return { kind: "done", verdict };
  }
  if (phase === "validate" && (verdict === "not-fixed" || verdict === "regression")) {
    // Caller decides: loop back to fix, or fail when out of budget.
    return { kind: "revalidate", verdict };
  }
  if (phase === "fix") {
    phaseState.status = "failed";
    phaseState.note = `fix loop exhausted (verdict: ${verdict})`;
    return { kind: "failed", verdict };
  }
  // reproduce/not-reproduced, baseline/build-broken
  phaseState.status = "blocked";
  phaseState.note = `verdict: ${verdict}`;
  return { kind: "blocked", verdict };
}

function debuggerModeFor(deps: PipelineDeps): DebuggerMode {
  if (!deps.config.debugging.enabled) return "none";
  const hasPointbreak = deps.config.debugging.mcp.some((server) =>
    server.name.toLowerCase().includes("pointbreak"),
  );
  if (hasPointbreak || deps.agent.kind === "claude") return "pointbreak";
  return "generic";
}

function buildPromptVars(
  config: ResolvedConfig,
  bug: Bug,
  ws: Workspace,
  worktree: WorktreeInfo,
  phase: PhaseId,
  feedback: string,
): PromptVars {
  const baseRefNote = bug.branch
    ? worktree.baseRef.endsWith(bug.branch)
      ? `\`${worktree.baseRef}\` — the branch the bug was produced on`
      : `\`${worktree.baseRef}\` (the bug's branch \`${bug.branch}\` was not found in the repo; fell back to the default branch)`
    : `\`${worktree.baseRef}\` (the bug report does not name a branch; using the default branch)`;

  const environment = bug.environment?.trim();
  const environmentNote = environment
    ? environment.length <= 400
      ? environment.replace(/\s*\n\s*/g, " · ")
      : "see the Environment section of bug.md"
    : "no environment information recorded — use the repo's default setup";

  const discoverNote =
    "not configured — discover it (CLAUDE.md / AGENTS.md / README / project files) and record exactly what you used in your artifact";

  return {
    BUG_ID: bug.workspaceId,
    BUG_TITLE: bug.title,
    WORKSPACE: ws.dir,
    BUG_FILE: ws.path("bug.md"),
    SCREENSHOTS_DIR: ws.screenshotsDir,
    REPO_DIR: worktree.dir,
    FIX_BRANCH: worktree.fixBranch,
    BASE_REF: worktree.baseRef,
    BASE_REF_NOTE: baseRefNote,
    BUILD_COMMAND: config.build.command ? `\`${config.build.command}\`` : discoverNote,
    TEST_COMMAND: config.build.testCommand ? `\`${config.build.testCommand}\`` : discoverNote,
    ENVIRONMENT_NOTE: environmentNote,
    MAX_FIX_ATTEMPTS: String(config.pipeline.maxFixAttempts),
    ARTIFACT: ws.artifactPath(phase),
    VERDICT_OPTIONS: PHASE_VERDICTS[phase].join(" | "),
    FEEDBACK: feedback
      ? `\n### ⚠ Feedback from the previous attempt\n\n${feedback}\n`
      : "",
    REPRO_FILE: ws.artifactPath("reproduce"),
    ISSUE_FILE: ws.artifactPath("investigate"),
    BASELINE_FILE: ws.artifactPath("baseline"),
    PROPOSAL_FILE: ws.artifactPath("propose"),
    FIX_LOG_FILE: ws.artifactPath("fix"),
    VALIDATION_FILE: ws.artifactPath("validate"),
    REPORT_FILE: ws.artifactPath("report"),
  };
}

function revalidateFeedback(ws: Workspace, verdict: string | null): string {
  const validation = readTextIfExists(ws.artifactPath("validate"));
  const detail = validation
    ? `\n\nThe validation report that rejected the previous fix (read it carefully):\n\n${validation.slice(0, 6000)}`
    : "";
  return (
    `A previous fix for this bug was rejected by independent validation with verdict "${verdict}". ` +
    `Address the validation findings — do not simply retry the same change.${detail}`
  );
}

function trackerRef(bug: Bug): string {
  return bug.tracker === "azure" ? `AB#${bug.id}` : `#${bug.id}`;
}

async function finalize(
  deps: PipelineDeps,
  bug: Bug,
  ws: Workspace,
  state: BugState,
  worktree: WorktreeInfo,
): Promise<void> {
  const { config, tracker, repo, log } = deps;

  if (state.outcome === "fixed") {
    try {
      if (config.delivery.autoCommit) {
        const message =
          `fix: ${bug.title} (${trackerRef(bug)})\n\n` +
          `Bug: ${bug.url}\n` +
          `Automated by Bugzinga (reproduce → investigate → propose → fix → validate).`;
        const committed = await repo.commitAll(worktree.dir, message);
        state.delivery.committed = state.delivery.committed || committed;
        if (committed) log.info(`committed fix on ${worktree.fixBranch}`);
      }
      if (config.delivery.push || config.delivery.createPr) {
        await repo.push(worktree.dir, worktree.fixBranch);
        state.delivery.pushed = true;
        log.info(`pushed ${worktree.fixBranch}`);
      }
      if (config.delivery.createPr) {
        const target =
          config.delivery.prTargetBranch ??
          (worktree.baseRef === "HEAD"
            ? config.repo.defaultBranch
            : worktree.baseRef.replace(/^origin\//, ""));
        const report = readTextIfExists(ws.artifactPath("report"));
        const pr = await tracker.createPullRequest({
          sourceBranch: worktree.fixBranch,
          targetBranch: target,
          title: `Fix ${trackerRef(bug)}: ${bug.title}`,
          description:
            `Automated fix for **${bug.title}**.\n\n` +
            `${bug.tracker === "azure" ? `Fixes AB#${bug.id}` : `Fixes #${bug.id}`}\n\n` +
            (report ? `${report.slice(0, 6000)}\n\n` : "") +
            `---\n🤖 Generated by Bugzinga (agent: ${state.agent ?? "unknown"}; pipeline: reproduce → investigate → baseline → propose → fix → validate → report).`,
        });
        state.delivery.prUrl = pr.url;
        log.success(`pull request: ${pr.url}`);
      }
      if (config.delivery.comment) {
        await tracker.addComment(
          bug.id,
          `Bugzinga fixed this bug automatically.\n` +
            `- Fix branch: ${worktree.fixBranch}${state.delivery.pushed ? " (pushed)" : " (local)"}\n` +
            (state.delivery.prUrl ? `- Pull request: ${state.delivery.prUrl}\n` : "") +
            `- Validation: repro re-run, build vs baseline, and test suite all passed.\n` +
            `- Artifacts: repro.md, issue.md, proposal.md, fix-attempts.md, validation.md, what-was-done.md (workspace ${ws.workspaceId})`,
        );
        state.delivery.commented = true;
      }
    } catch (err) {
      state.error = `delivery failed: ${toMessage(err)}`;
      log.error(state.error);
    }
    return;
  }

  if (state.phases.fix.status === "failed") {
    // fix-failed.md — same contract as the fix-bug orchestrator skill.
    const attempts = ws.readArtifact("fix");
    writeFileAtomic(
      ws.path("fix-failed.md"),
      `# Fix Failed: ${bug.workspaceId}\n\n` +
        `Bug: ${bug.title}\n${bug.url}\n\n` +
        `The fix phase did not produce a working fix.\n\n` +
        (attempts ? `## Attempt log\n\n${attempts}\n` : "No attempt log was produced.\n"),
    );
    log.warn(`wrote fix-failed.md`);
  }

  if (state.outcome === "cannot-reproduce" && config.delivery.comment) {
    try {
      await tracker.addComment(
        bug.id,
        `Bugzinga attempted this bug but could not reproduce it. ` +
          `The reproduction attempt log (repro.md) lists exactly what was tried. ` +
          `More precise repro steps, sample data, or environment details would unblock an automated fix.`,
      );
      state.delivery.commented = true;
    } catch (err) {
      log.warn(`could not comment on ${bug.id}: ${toMessage(err)}`);
    }
  }
}
