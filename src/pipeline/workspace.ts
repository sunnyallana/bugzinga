import { existsSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { renderBugMarkdown, type Bug } from "../core/bug.js";
import { PHASE_ARTIFACTS, type BugState, type PhaseId } from "../core/types.js";
import type { BugTracker } from "../trackers/types.js";
import { toMessage } from "../util/errors.js";
import {
  ensureDir,
  readJsonIfExists,
  readTextIfExists,
  writeFileAtomic,
  writeJsonAtomic,
} from "../util/fsx.js";
import type { Logger } from "../util/logger.js";

/**
 * The per-bug workspace under bugsRoot (default C:\Bugs\<id>) — deliberately
 * the same layout the fix-bug Claude skills use, so the two systems can read
 * each other's artifacts:
 *
 *   bug.md / bug.json        imported bug context
 *   screenshots/             downloaded attachments
 *   repro.md                 reproduce phase
 *   issue.md                 investigate phase   (bug-investigator contract)
 *   existing-warnings.md     baseline phase      (build-verifier contract)
 *   proposal.md              propose phase
 *   fix-attempts.md          fix phase           (bug-fixer attempt log)
 *   validation.md            validate phase
 *   what-was-done.md         report phase        (bug-reporter contract)
 *   fix-failed.md            written when the fix phase gives up
 *   state.json               pipeline state (resume/status)
 *   logs/                    prompts + agent transcripts per phase
 */
export class Workspace {
  constructor(
    readonly bugsRoot: string,
    readonly workspaceId: string,
  ) {}

  get dir(): string {
    return join(this.bugsRoot, this.workspaceId);
  }

  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  get screenshotsDir(): string {
    return this.path("screenshots");
  }

  get logsDir(): string {
    return this.path("logs");
  }

  get statePath(): string {
    return this.path("state.json");
  }

  artifactPath(phase: PhaseId): string {
    return this.path(PHASE_ARTIFACTS[phase]);
  }

  ensure(): void {
    ensureDir(this.dir);
    ensureDir(this.screenshotsDir);
    ensureDir(this.logsDir);
  }

  readState(): BugState | null {
    try {
      return readJsonIfExists<BugState>(this.statePath);
    } catch {
      return null; // corrupt state — caller starts fresh
    }
  }

  writeState(state: BugState): void {
    state.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.statePath, state);
  }

  readArtifact(phase: PhaseId): string | null {
    return readTextIfExists(this.artifactPath(phase));
  }

  /** Move a stale artifact aside before a retry so old verdicts can't leak. */
  archiveArtifact(phase: PhaseId, attempt: number): void {
    const src = this.artifactPath(phase);
    if (!existsSync(src)) return;
    const dest = this.path("logs", `${PHASE_ARTIFACTS[phase]}.attempt-${attempt}`);
    try {
      renameSync(src, dest);
    } catch {
      // best effort — worst case the agent overwrites it
    }
  }

  static list(bugsRoot: string): Workspace[] {
    if (!existsSync(bugsRoot)) return [];
    return readdirSync(bugsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => new Workspace(bugsRoot, entry.name))
      .filter((ws) => existsSync(ws.statePath));
  }
}

/** Parse the last `BUGZINGA_VERDICT: <value>` line of an artifact. */
export function parseVerdict(text: string | null): string | null {
  if (!text) return null;
  const matches = [...text.matchAll(/^\s*BUGZINGA_VERDICT:\s*([A-Za-z][A-Za-z-]*)\s*$/gm)];
  const last = matches[matches.length - 1];
  return last?.[1]?.toLowerCase() ?? null;
}

function uniqueFileName(used: Set<string>, rawName: string): string {
  const safe = rawName.replace(/[^\w.-]+/g, "_") || "attachment";
  let candidate = safe;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) {
    candidate = `${i}-${safe}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Materialize a bug into its workspace: download attachments, write
 * bug.json + bug.md. Idempotent — re-import refreshes context but never
 * touches pipeline artifacts or state.
 */
export async function importBugToWorkspace(
  bug: Bug,
  tracker: BugTracker,
  bugsRoot: string,
  log: Logger,
): Promise<Workspace> {
  const ws = new Workspace(bugsRoot, bug.workspaceId);
  ws.ensure();

  const used = new Set<string>();
  for (const attachment of bug.attachments) {
    const name = uniqueFileName(used, attachment.name);
    const dest = join(ws.screenshotsDir, name);
    const relative = join("screenshots", name);
    if (existsSync(dest)) {
      attachment.localPath = relative;
      continue;
    }
    try {
      await tracker.downloadAttachment(attachment, dest);
      attachment.localPath = relative;
      log.debug(`downloaded ${relative}`);
    } catch (err) {
      log.warn(`could not download attachment "${attachment.name}": ${toMessage(err)}`);
    }
  }

  writeJsonAtomic(ws.path("bug.json"), bug);
  writeFileAtomic(ws.path("bug.md"), renderBugMarkdown(bug));
  return ws;
}
