import type { Command } from "commander";
import pc from "picocolors";
import type { BugState } from "../../core/types.js";
import { Workspace } from "../../pipeline/workspace.js";
import { cell, outcomeCell, phaseLegend, phaseStrip, renderTable } from "../../ui/table.js";
import { loadCfgOrFail } from "../shared.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("show the state of every bug workspace")
    .option("--json", "machine-readable output")
    .action((opts: { json?: boolean }) => {
      const config = loadCfgOrFail(program.opts<{ config?: string }>().config);
      const states = Workspace.list(config.bugsRoot)
        .map((ws) => ws.readState())
        .filter((s): s is BugState => s !== null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      if (opts.json) {
        console.log(JSON.stringify(states, null, 2));
        return;
      }
      if (states.length === 0) {
        console.log(
          `${pc.yellow("!")} No bug workspaces under ${config.bugsRoot}. Start with ${pc.cyan("bugzinga hunt")}.`,
        );
        return;
      }
      console.log(`\n${pc.bold(`Bug workspaces in ${config.bugsRoot}`)}\n`);
      console.log(
        renderTable(
          ["ID", "Outcome", "Pipeline", "Agent", "Fix Branch", "Updated", "Title"],
          states.map((state) => [
            cell(state.workspaceId, pc.cyan),
            outcomeCell(state.outcome),
            cell(phaseStrip(state)),
            cell(state.agent ?? "-"),
            cell(state.fixBranch ?? "-"),
            cell(state.updatedAt.slice(0, 16).replace("T", " ")),
            cell(state.title.length > 44 ? `${state.title.slice(0, 41)}…` : state.title),
          ]),
        ),
      );
      console.log(`\n${phaseLegend()}\n`);
    });
}
