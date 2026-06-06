import { describe, expect, it } from "vitest";
import { PHASES, PHASE_VERDICTS, type PhaseId } from "../src/core/types.js";
import { renderPhasePrompt, substitute, type PromptVars } from "../src/prompts/render.js";
import { PipelineError } from "../src/util/errors.js";

function fullVars(): PromptVars {
  return {
    BUG_ID: "48213",
    BUG_TITLE: "Save crashes",
    WORKSPACE: "C:\\Bugs\\48213",
    BUG_FILE: "C:\\Bugs\\48213\\bug.md",
    SCREENSHOTS_DIR: "C:\\Bugs\\48213\\screenshots",
    REPO_DIR: "C:\\work\\repo",
    FIX_BRANCH: "bugzinga/48213",
    BASE_REF: "origin/feature/save",
    BASE_REF_NOTE: "`origin/feature/save` — the branch the bug was produced on",
    BUILD_COMMAND: "`npm run build`",
    TEST_COMMAND: "`npm test`",
    ENVIRONMENT_NOTE: "Windows 11 · build 2.4",
    MAX_FIX_ATTEMPTS: "5",
    ARTIFACT: "C:\\Bugs\\48213\\repro.md",
    VERDICT_OPTIONS: "reproduced | not-reproduced",
    FEEDBACK: "",
    REPRO_FILE: "C:\\Bugs\\48213\\repro.md",
    ISSUE_FILE: "C:\\Bugs\\48213\\issue.md",
    BASELINE_FILE: "C:\\Bugs\\48213\\existing-warnings.md",
    PROPOSAL_FILE: "C:\\Bugs\\48213\\proposal.md",
    FIX_LOG_FILE: "C:\\Bugs\\48213\\fix-attempts.md",
    VALIDATION_FILE: "C:\\Bugs\\48213\\validation.md",
    REPORT_FILE: "C:\\Bugs\\48213\\what-was-done.md",
  };
}

describe("renderPhasePrompt", () => {
  it.each(PHASES.map((p) => [p] as [PhaseId]))(
    "renders %s with no unresolved placeholders",
    (phase) => {
      const vars = fullVars();
      vars.VERDICT_OPTIONS = PHASE_VERDICTS[phase].join(" | ");
      for (const mode of ["pointbreak", "generic", "none"] as const) {
        const prompt = renderPhasePrompt({ phase, vars, debuggerMode: mode });
        expect(prompt).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
        expect(prompt).toContain("BUGZINGA_VERDICT");
        expect(prompt).toContain("C:\\Bugs\\48213");
        expect(prompt).toContain("Bug 48213: Save crashes");
        expect(prompt).toContain(PHASE_VERDICTS[phase].join(" | "));
      }
    },
  );

  it("embeds the KISS principle everywhere and pointbreak guidance when enabled", () => {
    const prompt = renderPhasePrompt({
      phase: "fix",
      vars: { ...fullVars(), VERDICT_OPTIONS: "fixed | failed" },
      debuggerMode: "pointbreak",
    });
    expect(prompt).toContain("KISS");
    expect(prompt).toContain("Pointbreak");
    expect(prompt).toContain("max 5 attempts");
  });

  it("injects retry feedback", () => {
    const prompt = renderPhasePrompt({
      phase: "reproduce",
      vars: { ...fullVars(), FEEDBACK: "\n### ⚠ Feedback from the previous attempt\n\nYou timed out.\n" },
      debuggerMode: "generic",
    });
    expect(prompt).toContain("You timed out.");
  });

  it("throws on missing variables instead of emitting holes", () => {
    expect(() => substitute("hello {{NOPE}}", {})).toThrowError(PipelineError);
  });
});
