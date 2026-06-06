import type { TrackerKind } from "./types.js";

export interface BugAttachment {
  name: string;
  url: string;
  kind: "image" | "file";
  /** Path under the workspace once downloaded, null if download failed/skipped. */
  localPath: string | null;
}

export interface BugComment {
  author: string;
  date: string;
  text: string;
}

/** Tracker-agnostic, fully normalized bug. Everything the pipeline needs. */
export interface Bug {
  tracker: TrackerKind;
  /** Tracker-native id, e.g. "48213" (ADO) or "417" (GitHub issue number). */
  id: string;
  /** Directory name under bugsRoot. ADO keeps the plain id (matches the C:\Bugs\<id> skill convention); GitHub gets a GH- prefix. */
  workspaceId: string;
  url: string;
  title: string;
  state: string;
  description: string;
  /** Markdown. From Microsoft.VSTS.TCM.ReproSteps or a parsed issue-body section. */
  reproSteps: string | null;
  /** Markdown. From Microsoft.VSTS.TCM.SystemInfo or a parsed Environment section. */
  environment: string | null;
  priority: number | null;
  /** Normalized 1 (critical) … 4 (low). */
  severity: number | null;
  /** Raw tracker label, e.g. "2 - High". */
  severityLabel: string | null;
  assignee: string | null;
  tags: string[];
  /** Branch the bug was produced on, when the tracker links one. */
  branch: string | null;
  /** Build/version the bug was found in (Microsoft.VSTS.Build.FoundIn). */
  foundIn: string | null;
  areaPath: string | null;
  iterationPath: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  attachments: BugAttachment[];
  comments: BugComment[];
}

export function makeWorkspaceId(tracker: TrackerKind, id: string): string {
  return tracker === "github" ? `GH-${id}` : id;
}

/** "2 - High" → { num: 2, label: "2 - High" }; tolerant of plain numbers. */
export function parseAdoSeverity(raw: string | null | undefined): {
  num: number | null;
  label: string | null;
} {
  if (!raw) return { num: null, label: null };
  const match = raw.match(/^\s*(\d)/);
  return { num: match?.[1] ? Number(match[1]) : null, label: raw };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|svg)$/i;

export function attachmentKind(name: string): "image" | "file" {
  return IMAGE_EXT.test(name) ? "image" : "file";
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

/**
 * Render bug.md — the canonical context document agents read first.
 * Keep it deterministic: it is also what humans review in the workspace.
 */
export function renderBugMarkdown(bug: Bug): string {
  const rows: Array<[string, string | null]> = [
    ["Tracker", bug.tracker === "azure" ? "Azure DevOps" : "GitHub"],
    ["ID", bug.id],
    ["URL", bug.url],
    ["State", bug.state],
    ["Priority", bug.priority !== null ? String(bug.priority) : null],
    ["Severity", bug.severityLabel ?? (bug.severity !== null ? String(bug.severity) : null)],
    ["Assigned to", bug.assignee],
    ["Branch produced on", bug.branch],
    ["Found in", bug.foundIn],
    ["Area", bug.areaPath],
    ["Iteration", bug.iterationPath],
    ["Tags", bug.tags.length > 0 ? bug.tags.join(", ") : null],
    ["Created", bug.createdAt],
    ["Updated", bug.updatedAt],
  ];

  const lines: string[] = [
    `# Bug ${bug.id}: ${bug.title}`,
    "",
    `> Imported by Bugzinga from ${bug.tracker === "azure" ? "Azure DevOps" : "GitHub"}: ${bug.url}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
  ];
  for (const [field, value] of rows) {
    if (value !== null && value !== "") {
      lines.push(`| ${field} | ${escapeTableCell(value)} |`);
    }
  }

  lines.push("", "## Description", "", bug.description.trim() || "_(empty)_");

  if (bug.reproSteps) {
    lines.push("", "## Repro Steps", "", bug.reproSteps.trim());
  }
  if (bug.environment) {
    lines.push("", "## Environment", "", bug.environment.trim());
  }

  lines.push("", "## Screenshots & Attachments", "");
  if (bug.attachments.length === 0) {
    lines.push("_None_");
  } else {
    for (const att of bug.attachments) {
      const location = att.localPath ?? `${att.url} (not downloaded)`;
      lines.push(`- ${att.kind === "image" ? "🖼" : "📎"} \`${location}\` — ${att.name}`);
    }
  }

  if (bug.comments.length > 0) {
    lines.push("", "## Recent Comments", "");
    for (const comment of bug.comments) {
      lines.push(`**${comment.author}** (${comment.date}):`, "", comment.text.trim(), "");
    }
  }

  lines.push("");
  return lines.join("\n");
}
