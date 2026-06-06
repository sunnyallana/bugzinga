import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PhaseId } from "../core/types.js";
import { PipelineError } from "../util/errors.js";

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), "templates");

const cache = new Map<string, string>();

export function loadTemplate(relPath: string): string {
  let text = cache.get(relPath);
  if (text === undefined) {
    text = readFileSync(join(templatesDir, relPath), "utf8");
    cache.set(relPath, text);
  }
  return text;
}

export type PromptVars = Record<string, string>;

export function substitute(template: string, vars: PromptVars): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new PipelineError(`Prompt variable {{${key}}} was not provided.`);
    }
    return value;
  });
}

export const PHASE_TEMPLATES: Record<PhaseId, string> = {
  reproduce: "reproduce.md",
  investigate: "investigate.md",
  baseline: "baseline.md",
  propose: "propose.md",
  fix: "fix.md",
  validate: "validate.md",
  report: "report.md",
};

export const PHASE_TITLES: Record<PhaseId, string> = {
  reproduce: "Reproduce",
  investigate: "Investigate",
  baseline: "Build Baseline",
  propose: "Propose Solution",
  fix: "Fix",
  validate: "Validate",
  report: "Report",
};

/**
 * Soft line caps per artifact (token economy). Intermediates are
 * machine-consumed and re-read by every later phase, so verbosity compounds;
 * the report is the human deliverable and gets more room.
 */
export const PHASE_ARTIFACT_BUDGETS: Record<PhaseId, number> = {
  reproduce: 60,
  investigate: 80,
  baseline: 60,
  propose: 50,
  fix: 60,
  validate: 60,
  report: 120,
};

export type DebuggerMode = "pointbreak" | "generic" | "none";

export interface RenderPhaseOptions {
  phase: PhaseId;
  vars: PromptVars;
  debuggerMode: DebuggerMode;
}

/**
 * Compose partials + phase template into the final self-contained prompt.
 * Throws if any {{VAR}} is left unresolved — a phase must never reach an
 * agent with holes in its instructions.
 */
export function renderPhasePrompt(opts: RenderPhaseOptions): string {
  const vars: PromptVars = { ...opts.vars };
  vars.PHASE_TITLE = PHASE_TITLES[opts.phase];
  vars.ARTIFACT_BUDGET = vars.ARTIFACT_BUDGET ?? String(PHASE_ARTIFACT_BUDGETS[opts.phase]);
  vars.KISS = loadTemplate("partials/kiss.md").trim();
  vars.DEBUGGER =
    opts.debuggerMode === "none"
      ? ""
      : loadTemplate(`partials/debugger-${opts.debuggerMode}.md`).trim();
  // The report is human-facing — it carries its own concision rule instead.
  vars.DISCIPLINE =
    opts.phase === "report"
      ? ""
      : substitute(loadTemplate("partials/discipline.md"), vars).trim();
  vars.CONTEXT = substitute(loadTemplate("partials/context.md"), vars).trim();
  vars.VERDICT = substitute(loadTemplate("partials/verdict.md"), vars).trim();
  const rendered = substitute(loadTemplate(PHASE_TEMPLATES[opts.phase]), vars);
  return `${rendered.trim()}\n`;
}
