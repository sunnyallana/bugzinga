import { describe, expect, it } from "vitest";
import type { Bug } from "../src/core/bug.js";
import { PHASES } from "../src/core/types.js";
import { deriveOutcome, isPipelineComplete, newBugState, resetFromPhase } from "../src/pipeline/machine.js";

function sampleBug(): Bug {
  return {
    tracker: "azure",
    id: "1",
    workspaceId: "1",
    url: "https://x",
    title: "t",
    state: "Active",
    description: "",
    reproSteps: null,
    environment: null,
    priority: 2,
    severity: 2,
    severityLabel: "2 - High",
    assignee: null,
    tags: [],
    branch: "feature/x",
    foundIn: null,
    areaPath: null,
    iterationPath: null,
    createdAt: null,
    updatedAt: null,
    attachments: [],
    comments: [],
  };
}

describe("pipeline state machine", () => {
  it("starts as imported with all phases pending", () => {
    const state = newBugState(sampleBug(), "claude");
    expect(state.outcome).toBe("imported");
    expect(deriveOutcome(state)).toBe("imported");
    for (const id of PHASES) expect(state.phases[id].status).toBe("pending");
  });

  it("derives in-progress, fixed, failed, cannot-reproduce", () => {
    const state = newBugState(sampleBug(), "claude");

    state.phases.reproduce.status = "running";
    expect(deriveOutcome(state)).toBe("in-progress");

    state.phases.reproduce.status = "blocked";
    expect(deriveOutcome(state)).toBe("cannot-reproduce");

    state.phases.reproduce.status = "done";
    state.phases.investigate.status = "failed";
    expect(deriveOutcome(state)).toBe("failed");

    for (const id of PHASES) state.phases[id].status = "done";
    expect(isPipelineComplete(state)).toBe(true);
    expect(deriveOutcome(state)).toBe("fixed");

    state.phases.validate.status = "skipped";
    expect(deriveOutcome(state)).toBe("fixed");
  });

  it("resetFromPhase clears the phase and everything after it", () => {
    const state = newBugState(sampleBug(), "claude");
    for (const id of PHASES) {
      state.phases[id].status = "done";
      state.phases[id].attempts = 2;
    }
    const reset = resetFromPhase(state, "fix");
    expect(reset).toEqual(["fix", "validate", "report"]);
    expect(state.phases.propose.status).toBe("done");
    expect(state.phases.fix.status).toBe("pending");
    expect(state.phases.fix.attempts).toBe(0);
    expect(state.phases.report.status).toBe("pending");
  });
});
