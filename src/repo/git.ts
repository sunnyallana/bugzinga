import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../config/load.js";
import { GitError } from "../util/errors.js";
import { exec, type ExecResult } from "../util/exec.js";
import { ensureDir, slugify } from "../util/fsx.js";
import type { Logger } from "../util/logger.js";
import { redact } from "../util/redact.js";

export interface WorktreeInfo {
  dir: string;
  baseRef: string;
  fixBranch: string;
  reused: boolean;
}

/**
 * Owns the shared clone and the per-bug worktrees.
 *
 * Layout under repo.root (default ~/.bugzinga):
 *   repos/<slug>-<hash>/        one shared clone per repo URL
 *   worktrees/<workspaceId>/    one isolated worktree per bug
 *
 * Worktrees give every concurrent bug its own checkout (its own branch, its
 * own build outputs) while sharing one object store. Credentials come from
 * the user's git credential manager; we never embed tokens in URLs.
 */
export class RepoManager {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly repoUrl: string,
    private readonly log: Logger,
  ) {}

  private async git(args: string[], cwd?: string, timeoutMs = 600_000): Promise<ExecResult> {
    const result = await exec("git", args, {
      cwd,
      timeoutMs,
      env: { GIT_TERMINAL_PROMPT: "0" }, // fail fast instead of hanging on auth prompts
    });
    if (result.code !== 0) {
      throw new GitError(
        `git ${args.join(" ")} failed (exit ${result.code}): ${redact(
          (result.stderr || result.stdout).trim().slice(0, 2000),
        )}`,
      );
    }
    return result;
  }

  private async tryGit(args: string[], cwd?: string): Promise<ExecResult | null> {
    try {
      const result = await exec("git", args, {
        cwd,
        timeoutMs: 120_000,
        env: { GIT_TERMINAL_PROMPT: "0" },
      });
      return result.code === 0 ? result : null;
    } catch {
      return null;
    }
  }

  /** True when repoUrl points at an existing local working copy. */
  private isLocalRepo(): boolean {
    return existsSync(this.repoUrl) && existsSync(join(this.repoUrl, ".git"));
  }

  cloneDir(): string {
    if (this.isLocalRepo()) return this.repoUrl;
    const hash = createHash("sha256").update(this.repoUrl).digest("hex").slice(0, 8);
    const tail = this.repoUrl.replace(/\.git$/, "").split(/[/\\]/).filter(Boolean).slice(-2);
    return join(this.config.repo.root, "repos", `${slugify(tail.join("-"))}-${hash}`);
  }

  worktreeDir(workspaceId: string): string {
    return join(this.config.repo.root, "worktrees", slugify(workspaceId, 80));
  }

  fixBranchName(workspaceId: string): string {
    return `${this.config.delivery.branchPrefix}${slugify(workspaceId, 80)}`;
  }

  async ensureClone(): Promise<string> {
    const dir = this.cloneDir();
    if (existsSync(join(dir, ".git"))) {
      this.log.debug(`fetching ${this.repoUrl}`);
      const fetched = await this.tryGit(["fetch", "--all", "--prune"], dir);
      if (!fetched) this.log.warn("git fetch failed — continuing with the existing clone");
      return dir;
    }
    if (this.isLocalRepo()) {
      await this.tryGit(["fetch", "--all", "--prune"], dir);
      return dir;
    }
    ensureDir(join(this.config.repo.root, "repos"));
    this.log.info(`cloning ${this.repoUrl}`);
    await this.git(["clone", this.repoUrl, dir]);
    return dir;
  }

  /** Resolve the ref a fix branch should start from: the bug's branch when it exists, else the default branch. */
  private async resolveBaseRef(cloneDir: string, sourceBranch: string | null): Promise<string> {
    const candidates: string[] = [];
    if (sourceBranch) candidates.push(`origin/${sourceBranch}`, sourceBranch);
    candidates.push(`origin/${this.config.repo.defaultBranch}`, this.config.repo.defaultBranch, "HEAD");
    for (const ref of candidates) {
      if (await this.tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cloneDir)) {
        return ref;
      }
    }
    throw new GitError(`Could not resolve a base ref in ${cloneDir} (tried: ${candidates.join(", ")}).`);
  }

  async ensureWorktree(workspaceId: string, sourceBranch: string | null): Promise<WorktreeInfo> {
    const cloneDir = await this.ensureClone();
    const dir = this.worktreeDir(workspaceId);
    const fixBranch = this.fixBranchName(workspaceId);

    // Reuse a healthy existing worktree (resume case).
    if (existsSync(dir) && (await this.tryGit(["rev-parse", "--is-inside-work-tree"], dir))) {
      const baseRef = await this.resolveBaseRef(cloneDir, sourceBranch);
      return { dir, baseRef, fixBranch, reused: true };
    }
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    await this.tryGit(["worktree", "prune"], cloneDir);

    const baseRef = await this.resolveBaseRef(cloneDir, sourceBranch);
    ensureDir(join(this.config.repo.root, "worktrees"));

    const branchExists = await this.tryGit(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${fixBranch}`],
      cloneDir,
    );
    if (branchExists) {
      await this.git(["worktree", "add", dir, fixBranch], cloneDir);
    } else {
      await this.git(["worktree", "add", "-b", fixBranch, dir, baseRef], cloneDir);
    }
    this.log.info(`worktree ready: ${dir} (branch ${fixBranch} from ${baseRef})`);
    return { dir, baseRef, fixBranch, reused: false };
  }

  async hasChanges(worktreeDir: string): Promise<boolean> {
    const result = await this.git(["status", "--porcelain"], worktreeDir);
    return result.stdout.trim().length > 0;
  }

  async diffStat(worktreeDir: string): Promise<string> {
    const staged = await this.tryGit(["diff", "--stat", "HEAD"], worktreeDir);
    return staged?.stdout.trim() ?? "";
  }

  /** Stage and commit everything in the worktree. Returns false when there is nothing to commit. */
  async commitAll(worktreeDir: string, message: string): Promise<boolean> {
    if (!(await this.hasChanges(worktreeDir))) return false;
    await this.git(["add", "-A"], worktreeDir);
    const committed = await this.tryGit(["commit", "-m", message], worktreeDir);
    if (!committed) {
      // Likely no identity configured in this environment — supply a local one.
      await this.git(
        [
          "-c",
          "user.name=Bugzinga",
          "-c",
          "user.email=bugzinga@localhost",
          "commit",
          "-m",
          message,
        ],
        worktreeDir,
      );
    }
    return true;
  }

  async push(worktreeDir: string, branch: string): Promise<void> {
    await this.git(["push", "-u", "origin", branch], worktreeDir);
  }

  async removeWorktree(worktreeDir: string): Promise<void> {
    const cloneDir = this.cloneDir();
    await this.tryGit(["worktree", "remove", "--force", worktreeDir], cloneDir);
    if (existsSync(worktreeDir)) rmSync(worktreeDir, { recursive: true, force: true });
    await this.tryGit(["worktree", "prune"], cloneDir);
  }
}

export function resolveRepoUrl(config: ResolvedConfig, derived: string | null): string {
  const url = config.repo.url ?? derived;
  if (!url) {
    throw new GitError(
      "Cannot determine the repository URL. Set repo.url in bugzinga.config.json " +
        "(or, for Azure DevOps, set tracker.repository so it can be derived).",
    );
  }
  return url;
}
