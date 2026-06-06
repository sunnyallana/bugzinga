import {
  attachmentKind,
  makeWorkspaceId,
  type Bug,
  type BugAttachment,
  type BugComment,
} from "../core/bug.js";
import type { ResolvedGithubTracker } from "../config/load.js";
import { extractIdOnlyQuery, type QueryNode } from "../query/ast.js";
import { compileGithubSearch } from "../query/github-search.js";
import { TrackerError } from "../util/errors.js";
import { downloadToFile, httpJson } from "../util/http.js";
import type { BugTracker, PullRequestRequest } from "./types.js";

const API_BASE = "https://api.github.com";

interface GhLabel {
  name?: string;
}

interface GhUser {
  login?: string;
}

interface GhIssue {
  number: number;
  title?: string;
  body?: string | null;
  state?: string;
  html_url?: string;
  labels?: Array<GhLabel | string>;
  assignee?: GhUser | null;
  created_at?: string;
  updated_at?: string;
  pull_request?: unknown;
}

interface GhComment {
  body?: string;
  created_at?: string;
  user?: GhUser;
}

/**
 * Pull a named section ("Steps to reproduce", "Environment", …) out of a
 * markdown issue body. Understands `# Heading`, `### Heading` (issue forms)
 * and standalone `**Heading**` lines.
 */
export function extractIssueSection(body: string, names: RegExp): string | null {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    const bold = line.match(/^\*\*([^*]+?)\*\*:?\s*$/);
    const title = heading?.[1] ?? bold?.[1];
    if (title && names.test(title.trim())) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  const collected: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (/^#{1,6}\s+/.test(line) || /^\*\*[^*]+?\*\*:?\s*$/.test(line)) break;
    collected.push(lines[i] ?? "");
  }
  const text = collected.join("\n").trim();
  return text || null;
}

export const REPRO_SECTION = /^(steps?\s+to\s+reproduce|repro(duction)?(\s+steps)?|how\s+to\s+reproduce)$/i;
export const ENVIRONMENT_SECTION = /^(environment|system\s+info(rmation)?|versions?|setup|platform)$/i;
export const BRANCH_SECTION = /^(branch|branch\s+produced\s+on)$/i;

/** Image/file attachment URLs referenced in a markdown body. */
export function extractAttachmentUrls(body: string): Array<{ name: string; url: string }> {
  const found = new Map<string, string>();
  const add = (url: string): void => {
    if (found.has(url)) return;
    let name = "";
    try {
      const segments = new URL(url).pathname.split("/").filter(Boolean);
      name = segments[segments.length - 1] ?? "";
    } catch {
      return;
    }
    if (!/\.[a-z0-9]{2,4}$/i.test(name)) name = `${name || `attachment-${found.size + 1}`}.png`;
    found.set(url, name);
  };

  for (const match of body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (match[1]) add(match[1]);
  }
  for (const match of body.matchAll(/<img\b[^>]*src\s*=\s*["']([^"']+)["']/gi)) {
    if (match[1]) add(match[1]);
  }
  for (const match of body.matchAll(
    /https:\/\/(?:github\.com\/user-attachments\/(?:assets|files)\/[\w./-]+|user-images\.githubusercontent\.com\/[\w./-]+)/g,
  )) {
    add(match[0]);
  }
  return [...found.entries()].map(([url, name]) => ({ name, url }));
}

/** "Branch: feature/foo" or a Branch section in the body. */
export function extractBranchFromBody(body: string): string | null {
  const section = extractIssueSection(body, BRANCH_SECTION);
  if (section) {
    const candidate = section.split(/\s/)[0]?.replace(/^`|`$/g, "");
    if (candidate) return candidate;
  }
  const inline = body.match(/branch\s*[:=]\s*`?([\w][\w./-]*)`?/i);
  return inline?.[1] ?? null;
}

/** Reverse a label format ("priority:{n}" / "P{n}") back to its number. */
export function labelNumber(format: string, label: string): number | null {
  const pattern = format
    .split("{n}")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("(\\d+)");
  const match = label.match(new RegExp(`^${pattern}$`, "i"));
  return match?.[1] ? Number(match[1]) : null;
}

export class GithubTracker implements BugTracker {
  readonly kind = "github" as const;
  readonly label: string;

  constructor(
    private readonly cfg: ResolvedGithubTracker,
    private readonly token: string,
  ) {
    this.label = `GitHub (${cfg.owner}/${cfg.repo})`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bugzinga",
    };
  }

  deriveRepoUrl(): string {
    return `https://github.com/${this.cfg.owner}/${this.cfg.repo}.git`;
  }

  async queryBugs(query: QueryNode, opts: { max: number }): Promise<Bug[]> {
    const directIds = extractIdOnlyQuery(query);
    if (directIds) {
      return Promise.all(directIds.slice(0, opts.max).map((id) => this.getBug(id)));
    }
    const q = compileGithubSearch(query, this.cfg);
    const issues: GhIssue[] = [];
    for (let page = 1; issues.length < opts.max && page <= 10; page++) {
      const perPage = Math.min(100, opts.max - issues.length);
      const result = await httpJson<{ items?: GhIssue[]; total_count?: number }>(
        `${API_BASE}/search/issues?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}&sort=created&order=desc`,
        { headers: this.headers() },
      );
      const items = (result.items ?? []).filter((i) => !i.pull_request);
      issues.push(...items);
      if (!result.items || result.items.length < perPage) break;
    }
    return Promise.all(issues.slice(0, opts.max).map((issue) => this.normalize(issue)));
  }

  async getBug(id: string): Promise<Bug> {
    const numeric = Number(id.replace(/^GH-/i, "").replace(/^#/, ""));
    if (!Number.isInteger(numeric)) {
      throw new TrackerError(`GitHub issue number must be numeric, got "${id}".`);
    }
    const issue = await httpJson<GhIssue>(
      `${API_BASE}/repos/${this.cfg.owner}/${this.cfg.repo}/issues/${numeric}`,
      { headers: this.headers() },
    );
    if (issue.pull_request) {
      throw new TrackerError(`#${numeric} is a pull request, not an issue.`);
    }
    return this.normalize(issue);
  }

  private async normalize(issue: GhIssue): Promise<Bug> {
    const body = issue.body ?? "";
    const labels = (issue.labels ?? [])
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter(Boolean);

    let priority: number | null = null;
    let severity: number | null = null;
    let severityLabel: string | null = null;
    for (const label of labels) {
      priority = priority ?? labelNumber(this.cfg.labels.priority, label);
      const sev = labelNumber(this.cfg.labels.severity, label);
      if (sev !== null && severity === null) {
        severity = sev;
        severityLabel = label;
      }
    }

    const attachments: BugAttachment[] = extractAttachmentUrls(body).map((a) => ({
      name: a.name,
      url: a.url,
      kind: attachmentKind(a.name),
      localPath: null,
    }));

    const [linkedBranch, comments] = await Promise.all([
      this.fetchLinkedBranch(issue.number),
      this.fetchComments(issue.number),
    ]);

    const id = String(issue.number);
    return {
      tracker: "github",
      id,
      workspaceId: makeWorkspaceId("github", id),
      url: issue.html_url ?? `https://github.com/${this.cfg.owner}/${this.cfg.repo}/issues/${id}`,
      title: issue.title ?? `Issue #${id}`,
      state: issue.state ?? "open",
      description: body,
      reproSteps: extractIssueSection(body, REPRO_SECTION),
      environment: extractIssueSection(body, ENVIRONMENT_SECTION),
      priority,
      severity,
      severityLabel,
      assignee: issue.assignee?.login ?? null,
      tags: labels,
      branch: linkedBranch ?? extractBranchFromBody(body),
      foundIn: null,
      areaPath: null,
      iterationPath: null,
      createdAt: issue.created_at ?? null,
      updatedAt: issue.updated_at ?? null,
      attachments,
      comments,
    };
  }

  /** Branches linked to the issue via GitHub's "Development" panel (GraphQL only). */
  private async fetchLinkedBranch(issueNumber: number): Promise<string | null> {
    try {
      const result = await httpJson<{
        data?: {
          repository?: {
            issue?: { linkedBranches?: { nodes?: Array<{ ref?: { name?: string } }> } };
          };
        };
      }>(`${API_BASE}/graphql`, {
        method: "POST",
        headers: this.headers(),
        jsonBody: {
          query: `query($owner:String!,$name:String!,$number:Int!){
            repository(owner:$owner,name:$name){
              issue(number:$number){ linkedBranches(first:5){ nodes{ ref{ name } } } }
            }
          }`,
          variables: { owner: this.cfg.owner, name: this.cfg.repo, number: issueNumber },
        },
      });
      const nodes = result.data?.repository?.issue?.linkedBranches?.nodes ?? [];
      return nodes[0]?.ref?.name ?? null;
    } catch {
      return null;
    }
  }

  private async fetchComments(issueNumber: number): Promise<BugComment[]> {
    try {
      const comments = await httpJson<GhComment[]>(
        `${API_BASE}/repos/${this.cfg.owner}/${this.cfg.repo}/issues/${issueNumber}/comments?per_page=5&sort=created&direction=desc`,
        { headers: this.headers() },
      );
      return comments.map((c) => ({
        author: c.user?.login ?? "unknown",
        date: c.created_at ?? "",
        text: c.body ?? "",
      }));
    } catch {
      return [];
    }
  }

  async downloadAttachment(attachment: BugAttachment, destPath: string): Promise<void> {
    // user-attachments URLs are session-authenticated for private repos; the
    // API token works for public assets. Failures are handled by the caller.
    await downloadToFile(attachment.url, destPath, {
      Authorization: `Bearer ${this.token}`,
      "User-Agent": "bugzinga",
    });
  }

  async addComment(id: string, text: string): Promise<void> {
    await httpJson(
      `${API_BASE}/repos/${this.cfg.owner}/${this.cfg.repo}/issues/${Number(id.replace(/^GH-/i, ""))}/comments`,
      { method: "POST", headers: this.headers(), jsonBody: { body: text } },
    );
  }

  async createPullRequest(req: PullRequestRequest): Promise<{ url: string }> {
    const result = await httpJson<{ html_url?: string; number?: number }>(
      `${API_BASE}/repos/${this.cfg.owner}/${this.cfg.repo}/pulls`,
      {
        method: "POST",
        headers: this.headers(),
        jsonBody: {
          title: req.title,
          head: req.sourceBranch,
          base: req.targetBranch,
          body: req.description,
        },
      },
    );
    return {
      url:
        result.html_url ??
        `https://github.com/${this.cfg.owner}/${this.cfg.repo}/pull/${result.number ?? ""}`,
    };
  }
}
