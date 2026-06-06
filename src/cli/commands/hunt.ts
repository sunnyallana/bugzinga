import type { Command } from "commander";
import pc from "picocolors";
import type { Bug } from "../../core/bug.js";
import { processBugs, type BugRunReport } from "../../pipeline/orchestrator.js";
import { parseQuery } from "../../query/parser.js";
import { formatQuery } from "../../query/ast.js";
import { RepoManager, resolveRepoUrl } from "../../repo/git.js";
import { createTracker } from "../../trackers/index.js";
import { createLogger } from "../../util/logger.js";
import { cell, outcomeCell, phaseLegend, phaseStrip, renderTable } from "../../ui/table.js";
import {
  applyAgentOverrides,
  bazinga,
  fail,
  loadCfgOrFail,
  parsePhase,
  parsePhaseList,
  requireAgent,
} from "../shared.js";

interface HuntOpts {
  query?: string;
  max: string;
  dryRun?: boolean;
  agent?: string;
  autonomy?: string;
  model?: string;
  concurrency?: string;
  fromPhase?: string;
  skip?: string;
}

export function bugListTable(bugs: Bug[]): string {
  return renderTable(
    ["ID", "P", "S", "State", "Branch", "Assignee", "Title"],
    bugs.map((bug) => [
      cell(bug.workspaceId, pc.cyan),
      cell(bug.priority !== null ? String(bug.priority) : "-"),
      cell(bug.severity !== null ? String(bug.severity) : "-"),
      cell(bug.state),
      cell(bug.branch ?? "-"),
      cell(bug.assignee ?? "-"),
      cell(bug.title.length > 60 ? `${bug.title.slice(0, 57)}…` : bug.title),
    ]),
  );
}

export function summarize(reports: BugRunReport[]): void {
  console.log(`\n${pc.bold("Results")}\n`);
  console.log(
    renderTable(
      ["ID", "Outcome", "Pipeline", "Detail"],
      reports.map((report) => {
        const outcome = report.state?.outcome ?? "failed";
        return [
          cell(report.bug.workspaceId, pc.cyan),
          outcomeCell(outcome),
          cell(report.state ? phaseStrip(report.state) : "-------"),
          cell(
            report.state?.delivery.prUrl ??
              report.error ??
              (outcome === "fixed" ? `branch ${report.state?.fixBranch ?? ""}` : ""),
          ),
        ];
      }),
    ),
  );
  console.log(`\n${phaseLegend()}\n`);

  const fixed = reports.filter((r) => r.state?.outcome === "fixed").length;
  const cannotRepro = reports.filter((r) => r.state?.outcome === "cannot-reproduce").length;
  const failed = reports.length - fixed - cannotRepro;
  const parts = [
    fixed > 0 ? pc.green(`${fixed} fixed`) : null,
    cannotRepro > 0 ? pc.yellow(`${cannotRepro} cannot-reproduce`) : null,
    failed > 0 ? pc.red(`${failed} failed`) : null,
  ].filter(Boolean);
  console.log(parts.length > 0 ? parts.join(pc.dim(" · ")) : pc.dim("nothing to do"));
  if (fixed > 0) {
    console.log(`\n${bazinga()} ${fixed} bug(s) down. Review with: ${pc.cyan("bugzinga report <id>")}\n`);
  }
}

export function registerHunt(program: Command): void {
  program
    .command("hunt [query]")
    .description(
      'query bugs, import them with full context, and run the fix pipeline on each\n(e.g. bugzinga hunt "priority=2 AND severity=2 AND assignee=me")',
    )
    .option("-q, --query <query>", "bug query (alternative to the positional argument)")
    .option("-m, --max <n>", "maximum bugs to process", "10")
    .option("-n, --dry-run", "list matching bugs without importing or fixing")
    .option("-a, --agent <kind>", "coding agent: claude | cursor | codex")
    .option("--autonomy <level>", "agent autonomy: edits | full")
    .option("--model <model>", "model override for the agent")
    .option("-j, --concurrency <n>", "bugs processed in parallel")
    .option("--from-phase <phase>", "restart every bug from this phase")
    .option("--skip <phases>", "comma-separated phases to skip")
    .action(async (queryArg: string | undefined, opts: HuntOpts) => {
      const config = loadCfgOrFail(program.opts<{ config?: string }>().config);
      applyAgentOverrides(config, opts);

      const queryText = queryArg ?? opts.query ?? config.defaultQuery;
      if (!queryText) {
        fail(
          'No query given. Pass one (e.g. bugzinga hunt "priority=2 AND severity=2 AND assignee=me") or set defaultQuery in bugzinga.config.json.',
        );
      }
      const query = parseQuery(queryText);
      const max = Math.max(1, Number(opts.max) || 10);

      const log = createLogger("bugzinga");
      const tracker = createTracker(config);
      log.info(`querying ${tracker.label}: ${formatQuery(query)}`);

      const bugs = await tracker.queryBugs(query, { max });
      if (bugs.length === 0) {
        console.log(`${pc.yellow("!")} No bugs matched. Sharpen the query or celebrate.`);
        return;
      }
      console.log(`\n${pc.bold(`${bugs.length} bug(s) matched`)}\n`);
      console.log(bugListTable(bugs));

      if (opts.dryRun) {
        console.log(`\n${pc.dim("dry run — nothing imported, nothing fixed. Drop --dry-run to unleash.")}`);
        return;
      }

      const agent = await requireAgent(config);
      const repo = new RepoManager(config, resolveRepoUrl(config, tracker.deriveRepoUrl()), log);

      console.log("");
      const reports = await processBugs(
        { config, tracker, agent, repo, log },
        bugs,
        {
          concurrency: opts.concurrency ? Math.max(1, Number(opts.concurrency)) : undefined,
          fromPhase: parsePhase(opts.fromPhase, "--from-phase"),
          skipPhases: parsePhaseList(opts.skip, "--skip"),
        },
      );
      summarize(reports);
      if (reports.some((r) => !r.state || r.state.outcome !== "fixed")) {
        process.exitCode = 1;
      }
    });
}
