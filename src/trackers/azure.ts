import { Buffer } from "node:buffer";
import {
  attachmentKind,
  makeWorkspaceId,
  parseAdoSeverity,
  type Bug,
  type BugAttachment,
  type BugComment,
} from "../core/bug.js";
import type { ResolvedAzureTracker } from "../config/load.js";
import { extractIdOnlyQuery, type QueryNode } from "../query/ast.js";
import { buildWiql } from "../query/wiql.js";
import { TrackerError } from "../util/errors.js";
import { htmlToMarkdown } from "../util/html-to-md.js";
import { downloadToFile, httpJson } from "../util/http.js";
import type { BugTracker, PullRequestRequest } from "./types.js";

const API = "api-version=7.1";

interface AdoIdentity {
  displayName?: string;
  uniqueName?: string;
}

interface AdoRelation {
  rel: string;
  url: string;
  attributes?: { name?: string };
}

interface AdoWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: AdoRelation[];
  _links?: { html?: { href?: string } };
}

interface AdoComment {
  text?: string;
  createdDate?: string;
  createdBy?: AdoIdentity;
}

const GIT_REF_PREFIX = "vstfs:///Git/Ref/";

/** Decode "vstfs:///Git/Ref/{proj}%2F{repo}%2FGB{branch}" → branch name. */
export function branchFromArtifactUrl(url: string): string | null {
  if (!url.startsWith(GIT_REF_PREFIX)) return null;
  try {
    const decoded = decodeURIComponent(url.slice(GIT_REF_PREFIX.length));
    const match = decoded.match(/\/GB(.+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function fileNameFromAttachmentUrl(url: string, index: number): string {
  try {
    const name = new URL(url).searchParams.get("fileName");
    if (name) return name;
  } catch {}
  return `inline-${index}.png`;
}

export class AzureDevOpsTracker implements BugTracker {
  readonly kind = "azure" as const;
  readonly label: string;
  private readonly auth: Record<string, string>;

  constructor(
    private readonly cfg: ResolvedAzureTracker,
    pat: string,
  ) {
    this.label = `Azure DevOps (${cfg.organization}/${cfg.project})`;
    this.auth = {
      Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
    };
  }

  private orgUrl(): string {
    return `${this.cfg.baseUrl}/${encodeURIComponent(this.cfg.organization)}`;
  }

  private projectUrl(): string {
    return `${this.orgUrl()}/${encodeURIComponent(this.cfg.project)}`;
  }

  deriveRepoUrl(): string | null {
    if (!this.cfg.repository) return null;
    return `${this.projectUrl()}/_git/${encodeURIComponent(this.cfg.repository)}`;
  }

  async queryBugs(query: QueryNode, opts: { max: number }): Promise<Bug[]> {
    const directIds = extractIdOnlyQuery(query);
    if (directIds) {
      return Promise.all(directIds.slice(0, opts.max).map((id) => this.getBug(id)));
    }
    const wiql = buildWiql(query);
    const result = await httpJson<{ workItems?: Array<{ id: number }> }>(
      `${this.projectUrl()}/_apis/wit/wiql?${API}&$top=${opts.max}`,
      { method: "POST", headers: this.auth, jsonBody: { query: wiql } },
    );
    const ids = (result.workItems ?? []).slice(0, opts.max).map((w) => w.id);
    if (ids.length === 0) return [];
    return this.fetchWorkItems(ids);
  }

  async getBug(id: string): Promise<Bug> {
    const numeric = Number(id);
    if (!Number.isInteger(numeric)) {
      throw new TrackerError(`Azure DevOps work item id must be numeric, got "${id}".`);
    }
    const bugs = await this.fetchWorkItems([numeric]);
    const bug = bugs[0];
    if (!bug) throw new TrackerError(`Work item ${id} not found.`);
    return bug;
  }

  private async fetchWorkItems(ids: number[]): Promise<Bug[]> {
    const bugs: Bug[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const result = await httpJson<{ value?: AdoWorkItem[] }>(
        `${this.orgUrl()}/_apis/wit/workitems?ids=${chunk.join(",")}&$expand=relations&${API}`,
        { headers: this.auth },
      );
      for (const item of result.value ?? []) {
        bugs.push(this.normalize(item));
      }
    }
    await Promise.all(
      bugs.map(async (bug) => {
        bug.comments = await this.fetchComments(bug.id);
      }),
    );
    return bugs;
  }

  private async fetchComments(id: string): Promise<BugComment[]> {
    try {
      const result = await httpJson<{ comments?: AdoComment[] }>(
        `${this.projectUrl()}/_apis/wit/workItems/${id}/comments?$top=5&order=desc&api-version=7.1-preview.4`,
        { headers: this.auth },
      );
      return (result.comments ?? []).map((c) => ({
        author: c.createdBy?.displayName ?? c.createdBy?.uniqueName ?? "unknown",
        date: c.createdDate ?? "",
        text: htmlToMarkdown(c.text ?? "").markdown,
      }));
    } catch {
      return []; // comments are nice-to-have context — never fail the import
    }
  }

  private normalize(item: AdoWorkItem): Bug {
    const f = item.fields;
    const str = (key: string): string | null =>
      typeof f[key] === "string" && (f[key] as string).trim() ? (f[key] as string) : null;

    const description = htmlToMarkdown(str("System.Description"));
    const repro = htmlToMarkdown(str("Microsoft.VSTS.TCM.ReproSteps"));
    const sysInfo = htmlToMarkdown(str("Microsoft.VSTS.TCM.SystemInfo"));
    const severity = parseAdoSeverity(str("Microsoft.VSTS.Common.Severity"));

    const priorityRaw = f["Microsoft.VSTS.Common.Priority"];
    const priority =
      typeof priorityRaw === "number"
        ? priorityRaw
        : Number.isInteger(Number(priorityRaw))
          ? Number(priorityRaw)
          : null;

    const assigneeRaw = f["System.AssignedTo"];
    const assignee =
      typeof assigneeRaw === "object" && assigneeRaw !== null
        ? ((assigneeRaw as AdoIdentity).displayName ??
          (assigneeRaw as AdoIdentity).uniqueName ??
          null)
        : typeof assigneeRaw === "string"
          ? assigneeRaw
          : null;

    const attachments: BugAttachment[] = [];
    const seenUrls = new Set<string>();
    const addAttachment = (name: string, url: string): void => {
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      attachments.push({ name, url, kind: attachmentKind(name), localPath: null });
    };

    let branch: string | null = null;
    for (const relation of item.relations ?? []) {
      if (relation.rel === "AttachedFile") {
        addAttachment(relation.attributes?.name ?? "attachment", relation.url);
      } else if (relation.rel === "ArtifactLink") {
        branch = branch ?? branchFromArtifactUrl(relation.url);
      }
    }
    // Images embedded inline in repro steps / description are attachments too.
    [...repro.images, ...sysInfo.images, ...description.images].forEach((url, i) => {
      addAttachment(fileNameFromAttachmentUrl(url, i + 1), url);
    });

    const id = String(item.id);
    return {
      tracker: "azure",
      id,
      workspaceId: makeWorkspaceId("azure", id),
      url: item._links?.html?.href ?? `${this.projectUrl()}/_workitems/edit/${id}`,
      title: str("System.Title") ?? `Work item ${id}`,
      state: str("System.State") ?? "Unknown",
      description: description.markdown,
      reproSteps: repro.markdown || null,
      environment: sysInfo.markdown || null,
      priority,
      severity: severity.num,
      severityLabel: severity.label,
      assignee,
      tags: (str("System.Tags") ?? "")
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean),
      branch,
      foundIn: str("Microsoft.VSTS.Build.FoundIn"),
      areaPath: str("System.AreaPath"),
      iterationPath: str("System.IterationPath"),
      createdAt: str("System.CreatedDate"),
      updatedAt: str("System.ChangedDate"),
      attachments,
      comments: [],
    };
  }

  async downloadAttachment(attachment: BugAttachment, destPath: string): Promise<void> {
    const sep = attachment.url.includes("?") ? "&" : "?";
    await downloadToFile(`${attachment.url}${sep}download=true&${API}`, destPath, this.auth);
  }

  async addComment(id: string, text: string): Promise<void> {
    await httpJson(
      `${this.projectUrl()}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`,
      {
        method: "POST",
        headers: this.auth,
        jsonBody: { text: text.replace(/\n/g, "<br>") },
      },
    );
  }

  async createPullRequest(req: PullRequestRequest): Promise<{ url: string }> {
    if (!this.cfg.repository) {
      throw new TrackerError(
        "tracker.repository must be set in bugzinga.config.json to create Azure DevOps pull requests.",
      );
    }
    const result = await httpJson<{
      pullRequestId: number;
      repository?: { webUrl?: string };
    }>(
      `${this.projectUrl()}/_apis/git/repositories/${encodeURIComponent(this.cfg.repository)}/pullrequests?${API}`,
      {
        method: "POST",
        headers: this.auth,
        jsonBody: {
          sourceRefName: `refs/heads/${req.sourceBranch}`,
          targetRefName: `refs/heads/${req.targetBranch}`,
          title: req.title,
          description: req.description,
        },
      },
    );
    const webUrl = result.repository?.webUrl ?? this.deriveRepoUrl() ?? this.projectUrl();
    return { url: `${webUrl}/pullrequest/${result.pullRequestId}` };
  }
}
