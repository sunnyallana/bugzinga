import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentRunResult, AgentTask, CodingAgent } from "../src/agents/types.js";
import { parseConfigText, type ResolvedConfig } from "../src/config/load.js";
import type { Bug } from "../src/core/bug.js";
import { PHASE_ARTIFACTS, type PhaseId } from "../src/core/types.js";
import { runBugPipeline } from "../src/pipeline/runner.js";
import { importBugToWorkspace } from "../src/pipeline/workspace.js";
import { RepoManager } from "../src/repo/git.js";
import type { BugTracker } from "../src/trackers/types.js";
import { exec } from "../src/util/exec.js";
import { readTextIfExists } from "../src/util/fsx.js";
import { createLogger } from "../src/util/logger.js";

const tmp = mkdtempSync(join(tmpdir(), "bugzinga-e2e-"));
const repoDir = join(tmp, "repo");

async function git(args: string[], cwd: string): Promise<void> {
  const result = await exec("git", args, { cwd, timeoutMs: 60_000 });
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

beforeAll(async () => {
  mkdirSync(repoDir, { recursive: true });
  await git(["init", "-b", "main"], repoDir);
  await git(["config", "user.name", "Test"], repoDir);
  await git(["config", "user.email", "test@example.com"], repoDir);
  writeFileSync(join(repoDir, "app.js"), "function save() { return null; }\n");
  await git(["add", "-A"], repoDir);
  await git(["commit", "-m", "initial"], repoDir);
}, 60_000);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function makeConfig(
  bugsRootName: string,
  overrides: Record<string, unknown> = {},
): ResolvedConfig {
  return parseConfigText(
    JSON.stringify({
      tracker: { kind: "azure", organization: "acme", project: "Rocket", repository: "rocket" },
      repo: { url: repoDir.replace(/\\/g, "/"), defaultBranch: "main", root: join(tmp, "store") },
      bugsRoot: join(tmp, bugsRootName),
      build: { command: "echo build-ok", testCommand: "echo test-ok" },
      pipeline: { concurrency: 1, phaseAttempts: 2, revalidateLoops: 1 },
      debugging: { enabled: false },
      ...overrides,
    }),
    null,
  );
}

function makeBug(id: string): Bug {
  return {
    tracker: "azure",
    id,
    workspaceId: id,
    url: `https://dev.azure.com/acme/Rocket/_workitems/edit/${id}`,
    title: "Save crashes with null reference",
    state: "Active",
    description: "Clicking save crashes.",
    reproSteps: "1. Open app\n2. Click save",
    environment: "Windows 11",
    priority: 2,
    severity: 2,
    severityLabel: "2 - High",
    assignee: "Sunny",
    tags: [],
    branch: null,
    foundIn: null,
    areaPath: null,
    iterationPath: null,
    createdAt: null,
    updatedAt: null,
    attachments: [],
    comments: [],
  };
}

const fakeTracker = {
  kind: "azure",
  label: "fake tracker",
  queryBugs: async () => [],
  getBug: async () => makeBug("0"),
  downloadAttachment: async () => {},
  addComment: async () => {},
  createPullRequest: async () => ({ url: "https://example/pr/1" }),
  deriveRepoUrl: () => null,
} as unknown as BugTracker;

const ARTIFACT_TO_PHASE = new Map<string, PhaseId>(
  (Object.entries(PHASE_ARTIFACTS) as Array<[PhaseId, string]>).map(([phase, file]) => [
    file,
    phase,
  ]),
);

/**
 * Scripted stand-in for a coding agent: reads the rendered prompt, finds the
 * artifact contract, and "does the work". Per-phase verdicts (or null = write
 * no artifact, simulating a crash/aimless run) come from the script.
 */
class FakeAgent implements CodingAgent {
  readonly kind = "claude" as const;
  readonly displayName = "FakeAgent";
  readonly binary = "node";
  readonly calls: Array<{ phase: PhaseId; verdict: string | null }> = [];

  constructor(private readonly script: Partial<Record<PhaseId, Array<string | null>>> = {}) {}

  async isAvailable() {
    return { available: true, path: "fake", version: "1.0.0" };
  }

  async run(task: AgentTask): Promise<AgentRunResult> {
    const prompt = readTextIfExists(task.promptFile) ?? "";
    const artifactMatch = prompt.match(/Write the artifact file: `([^`]+)`/);
    if (!artifactMatch?.[1]) throw new Error("prompt missing artifact contract");
    const artifactPath = artifactMatch[1];
    const fileName = artifactPath.split(/[\\/]/).pop() ?? "";
    const phase = ARTIFACT_TO_PHASE.get(fileName);
    if (!phase) throw new Error(`unknown artifact ${fileName}`);

    const queue = this.script[phase];
    const scripted = queue && queue.length > 0 ? queue.shift() : undefined;
    const optionsMatch = prompt.match(/is one of: (.+)/);
    const successVerdict = optionsMatch?.[1]?.split("|")[0]?.trim() ?? "complete";
    const verdict = scripted === undefined ? successVerdict : scripted;
    this.calls.push({ phase, verdict });

    if (verdict === null) {
      // Simulate an agent that burned its run without producing the artifact.
      return { ok: true, exitCode: 0, timedOut: false, durationMs: 10, outputTail: "" };
    }
    if (phase === "fix") {
      // A real fix mutates the worktree.
      writeFileSync(
        join(task.cwd, "app.js"),
        "function save() { return { ok: true }; }\n",
      );
    }
    writeFileSync(
      artifactPath,
      `# ${fileName} for test\n\nwork happened here\n\nBUGZINGA_VERDICT: ${verdict}\n`,
    );
    return { ok: true, exitCode: 0, timedOut: false, durationMs: 10, outputTail: "" };
  }
}

async function runOnce(
  id: string,
  agent: FakeAgent,
  config: ResolvedConfig,
  opts: { fromPhase?: PhaseId | null } = {},
) {
  const log = createLogger("");
  const bug = makeBug(id);
  const ws = await importBugToWorkspace(bug, fakeTracker, config.bugsRoot, log);
  const repo = new RepoManager(config, repoDir, log);
  const state = await runBugPipeline(
    { config, tracker: fakeTracker, agent, repo, log },
    bug,
    ws,
    opts,
  );
  return { state, ws };
}

describe("end-to-end pipeline (real git, fake agent)", () => {
  it("runs reproduce → report, commits the fix, and lands on outcome=fixed", async () => {
    const config = makeConfig("bugs-happy");
    const agent = new FakeAgent();
    const { state, ws } = await runOnce("901", agent, config);

    expect(state.outcome).toBe("fixed");
    // baseline runs deterministically (build command is configured) — no agent call for it
    expect(agent.calls.map((c) => c.phase)).toEqual([
      "reproduce",
      "investigate",
      "propose",
      "fix",
      "validate",
      "report",
    ]);
    for (const file of Object.values(PHASE_ARTIFACTS)) {
      expect(readTextIfExists(ws.path(file)), file).toBeTruthy();
    }
    const baseline = readTextIfExists(ws.path(PHASE_ARTIFACTS.baseline));
    expect(baseline).toContain("deterministic");
    expect(baseline).toContain("BUGZINGA_VERDICT: complete");
    expect(state.phases.baseline.status).toBe("done");
    expect(state.fixBranch).toBe("bugzinga/901");
    expect(state.delivery.committed).toBe(true);

    const logResult = await exec("git", ["log", "--oneline"], { cwd: state.worktree ?? "" });
    expect(logResult.stdout).toContain("fix: Save crashes with null reference (AB#901)");
  }, 120_000);

  it("stops at cannot-reproduce when reproduction fails (repro-first gate)", async () => {
    const config = makeConfig("bugs-norepro");
    const agent = new FakeAgent({ reproduce: ["not-reproduced"] });
    const { state } = await runOnce("902", agent, config);

    expect(state.outcome).toBe("cannot-reproduce");
    expect(state.phases.reproduce.status).toBe("blocked");
    expect(state.phases.investigate.status).toBe("pending");
    expect(agent.calls).toHaveLength(1);
  }, 120_000);

  it("retries a phase that produced no artifact, then fails, then resumes with --from-phase", async () => {
    const config = makeConfig("bugs-resume");
    const flaky = new FakeAgent({ investigate: [null, null] });
    const first = await runOnce("903", flaky, config);

    expect(first.state.outcome).toBe("failed");
    expect(first.state.phases.investigate.status).toBe("failed");
    expect(first.state.phases.investigate.attempts).toBe(2);
    expect(first.state.phases.reproduce.status).toBe("done");

    const healthy = new FakeAgent();
    const second = await runOnce("903", healthy, config, { fromPhase: "investigate" });
    expect(second.state.outcome).toBe("fixed");
    // reproduce was preserved from the first run — only later phases re-ran
    // (baseline re-ran too, but deterministically, so it never reaches the agent)
    expect(healthy.calls.map((c) => c.phase)).toEqual([
      "investigate",
      "propose",
      "fix",
      "validate",
      "report",
    ]);
  }, 120_000);

  it("loops validate → fix when validation rejects the fix, then succeeds", async () => {
    const config = makeConfig("bugs-revalidate");
    const agent = new FakeAgent({ validate: ["not-fixed"] });
    const { state } = await runOnce("904", agent, config);

    expect(state.outcome).toBe("fixed");
    const fixRuns = agent.calls.filter((c) => c.phase === "fix").length;
    const validateRuns = agent.calls.filter((c) => c.phase === "validate").length;
    expect(fixRuns).toBe(2);
    expect(validateRuns).toBe(2);
  }, 120_000);

  it("blocks at baseline when the build command fails, without involving the agent", async () => {
    const config = makeConfig("bugs-broken-build", {
      build: { command: "exit 3" }, // fails identically under cmd and sh
    });
    const agent = new FakeAgent();
    const { state, ws } = await runOnce("905", agent, config);

    expect(state.outcome).toBe("failed");
    expect(state.phases.baseline.status).toBe("blocked");
    expect(state.phases.baseline.verdict).toBe("build-broken");
    expect(agent.calls.map((c) => c.phase)).toEqual(["reproduce", "investigate"]);
    const artifact = readTextIfExists(ws.path(PHASE_ARTIFACTS.baseline));
    expect(artifact).toContain("BUGZINGA_VERDICT: build-broken");
  }, 120_000);

  it("lets the agent own the baseline when deterministicBaseline is off", async () => {
    const config = makeConfig("bugs-agent-baseline", {
      pipeline: {
        concurrency: 1,
        phaseAttempts: 2,
        revalidateLoops: 1,
        deterministicBaseline: false,
      },
    });
    const agent = new FakeAgent();
    const { state } = await runOnce("906", agent, config);

    expect(state.outcome).toBe("fixed");
    expect(agent.calls.map((c) => c.phase)).toContain("baseline");
  }, 120_000);
});
