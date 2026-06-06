import pc from "picocolors";
import type { BugOutcome, BugState, PhaseStatus } from "../core/types.js";
import { PHASES } from "../core/types.js";

export interface Cell {
  text: string;
  color?: (s: string) => string;
}

export function cell(text: string, color?: (s: string) => string): Cell {
  return { text, color };
}

/** Simple aligned table. Colors are applied after padding so widths stay true. */
export function renderTable(headers: string[], rows: Cell[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.text.length ?? 0)),
  );
  const renderRow = (cells: Cell[]): string =>
    cells
      .map((c, i) => {
        const padded = c.text.padEnd(widths[i] ?? c.text.length);
        return c.color ? c.color(padded) : padded;
      })
      .join("  ")
      .trimEnd();

  const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? h.length)).join("  ").trimEnd();
  const separator = widths.map((w) => "─".repeat(w)).join("──");
  return [pc.bold(headerLine), pc.dim(separator), ...rows.map(renderRow)].join("\n");
}

export function outcomeCell(outcome: BugOutcome): Cell {
  switch (outcome) {
    case "fixed":
      return cell("fixed ✔", pc.green);
    case "failed":
      return cell("failed ✗", pc.red);
    case "cannot-reproduce":
      return cell("cannot-reproduce", pc.yellow);
    case "in-progress":
      return cell("in-progress", pc.cyan);
    case "imported":
      return cell("imported", pc.dim);
  }
}

const PHASE_GLYPHS: Record<PhaseStatus, string> = {
  pending: "·",
  running: "▶",
  done: "✔",
  failed: "✗",
  skipped: "○",
  blocked: "■",
};

/** Compact 7-glyph pipeline progress, e.g. "✔✔✔✔▶··" */
export function phaseStrip(state: BugState): string {
  return PHASES.map((id) => PHASE_GLYPHS[state.phases[id].status]).join("");
}

export function phaseLegend(): string {
  return pc.dim(
    `phases: ${PHASES.join(" → ")}   glyphs: ✔ done  ▶ running  · pending  ○ skipped  ✗ failed  ■ blocked`,
  );
}
