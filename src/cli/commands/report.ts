import type { Command } from "commander";
import pc from "picocolors";
import { makeWorkspaceId } from "../../core/bug.js";
import { PHASES, PHASE_ARTIFACTS } from "../../core/types.js";
import { Workspace } from "../../pipeline/workspace.js";
import { readTextIfExists } from "../../util/fsx.js";
import { fail, loadCfgOrFail } from "../shared.js";

export function registerReport(program: Command): void {
  program
    .command("report <bugId>")
    .description("print the final what-was-done report (or the most useful artifact available)")
    .option("--artifact <phase>", "print a specific phase artifact instead")
    .action((bugId: string, opts: { artifact?: string }) => {
      const config = loadCfgOrFail(program.opts<{ config?: string }>().config);
      const workspaceId = /^GH-/i.test(bugId)
        ? bugId.toUpperCase()
        : makeWorkspaceId(config.tracker.kind, bugId);
      const ws = new Workspace(config.bugsRoot, workspaceId);

      if (opts.artifact) {
        const phase = PHASES.find((p) => p === opts.artifact);
        if (!phase) {
          fail(`Unknown phase "${opts.artifact}" — expected one of: ${PHASES.join(", ")}.`);
        }
        const text = readTextIfExists(ws.artifactPath(phase));
        if (!text) fail(`No ${PHASE_ARTIFACTS[phase]} in ${ws.dir} yet.`);
        console.log(text);
        return;
      }

      // Most useful artifact first: final report → failure note → validation → investigation → repro.
      const candidates = [
        ws.artifactPath("report"),
        ws.path("fix-failed.md"),
        ws.artifactPath("validate"),
        ws.artifactPath("investigate"),
        ws.artifactPath("reproduce"),
      ];
      for (const candidate of candidates) {
        const text = readTextIfExists(candidate);
        if (text) {
          console.log(pc.dim(`# ${candidate}\n`));
          console.log(text);
          return;
        }
      }
      fail(`No artifacts found in ${ws.dir}. Has the pipeline run? Try: bugzinga fix ${bugId}`);
    });
}
