import type { Bug, BugAttachment } from "../core/bug.js";
import type { TrackerKind } from "../core/types.js";
import type { QueryNode } from "../query/ast.js";

export interface PullRequestRequest {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
}

/**
 * Port every tracker adapter implements. The pipeline only ever talks to
 * this interface — adding Jira/GitLab later means one new adapter, no core
 * changes.
 */
export interface BugTracker {
  readonly kind: TrackerKind;
  /** Human-readable target, e.g. "Azure DevOps (org/project)". */
  readonly label: string;

  /** Execute a parsed query and return fully-normalized bugs (newest/highest priority first). */
  queryBugs(query: QueryNode, opts: { max: number }): Promise<Bug[]>;

  /** Fetch a single bug by tracker-native id. */
  getBug(id: string): Promise<Bug>;

  /** Download one attachment to destPath (throws on failure). */
  downloadAttachment(attachment: BugAttachment, destPath: string): Promise<void>;

  /** Post a comment back on the bug (used after a fix or when repro fails). */
  addComment(id: string, text: string): Promise<void>;

  /** Open a PR for the fix branch. */
  createPullRequest(req: PullRequestRequest): Promise<{ url: string }>;

  /** Derive the clone URL from tracker config when repo.url is not set. */
  deriveRepoUrl(): string | null;
}
