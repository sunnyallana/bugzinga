import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Bug } from "../src/core/bug.js";
import { newBugState } from "../src/pipeline/machine.js";
import { importBugToWorkspace, parseVerdict, Workspace } from "../src/pipeline/workspace.js";
import type { BugTracker } from "../src/trackers/types.js";
import { createLogger } from "../src/util/logger.js";

const tmp = mkdtempSync(join(tmpdir(), "bugzinga-ws-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("parseVerdict", () => {
  it("parses the last verdict line, case-tolerant on whitespace", () => {
    expect(parseVerdict("...\nBUGZINGA_VERDICT: reproduced\n")).toBe("reproduced");
    expect(parseVerdict("BUGZINGA_VERDICT: Fixed")).toBe("fixed");
    expect(
      parseVerdict("BUGZINGA_VERDICT: not-reproduced\nlater...\n  BUGZINGA_VERDICT: reproduced  "),
    ).toBe("reproduced");
  });

  it("returns null when absent or malformed", () => {
    expect(parseVerdict(null)).toBeNull();
    expect(parseVerdict("no verdict here")).toBeNull();
    expect(parseVerdict("BUGZINGA_VERDICT:")).toBeNull();
  });
});

describe("Workspace", () => {
  it("persists and reloads state atomically", () => {
    const ws = new Workspace(tmp, "777");
    ws.ensure();
    const bug = { workspaceId: "777" } as unknown as Bug;
    const state = newBugState({ ...sampleBug(), workspaceId: "777" }, "claude");
    void bug;
    ws.writeState(state);
    const loaded = ws.readState();
    expect(loaded?.workspaceId).toBe("777");
    expect(loaded?.phases.reproduce.status).toBe("pending");
  });

  it("archives artifacts out of the way", () => {
    const ws = new Workspace(tmp, "778");
    ws.ensure();
    writeFileSync(ws.artifactPath("fix"), "old\nBUGZINGA_VERDICT: fixed\n");
    ws.archiveArtifact("fix", 1);
    expect(existsSync(ws.artifactPath("fix"))).toBe(false);
    expect(existsSync(ws.path("logs", "fix-attempts.md.attempt-1"))).toBe(true);
  });

  it("lists only directories that contain state.json", () => {
    const stray = new Workspace(tmp, "stray");
    stray.ensure(); // no state written
    const listed = Workspace.list(tmp).map((w) => w.workspaceId);
    expect(listed).toContain("777");
    expect(listed).not.toContain("stray");
  });
});

function sampleBug(): Bug {
  return {
    tracker: "azure",
    id: "777",
    workspaceId: "777",
    url: "https://x",
    title: "sample",
    state: "Active",
    description: "d",
    reproSteps: "r",
    environment: "e",
    priority: 2,
    severity: 2,
    severityLabel: "2 - High",
    assignee: "me",
    tags: [],
    branch: null,
    foundIn: null,
    areaPath: null,
    iterationPath: null,
    createdAt: null,
    updatedAt: null,
    attachments: [
      { name: "shot.png", url: "https://x/a", kind: "image", localPath: null },
      { name: "shot.png", url: "https://x/b", kind: "image", localPath: null },
      { name: "bad.png", url: "https://x/fails", kind: "image", localPath: null },
    ],
    comments: [],
  };
}

describe("importBugToWorkspace", () => {
  it("downloads attachments with de-duplicated names and tolerates failures", async () => {
    const bug = sampleBug();
    bug.workspaceId = "779";
    const fakeTracker = {
      kind: "azure",
      label: "fake",
      queryBugs: async () => [],
      getBug: async () => bug,
      addComment: async () => {},
      createPullRequest: async () => ({ url: "" }),
      deriveRepoUrl: () => null,
      downloadAttachment: async (att: { url: string }, dest: string) => {
        if (att.url.endsWith("fails")) throw new Error("403");
        writeFileSync(dest, "png-bytes");
      },
    } as unknown as BugTracker;

    const ws = await importBugToWorkspace(bug, fakeTracker, tmp, createLogger("test"));
    expect(existsSync(ws.path("bug.md"))).toBe(true);
    expect(existsSync(ws.path("bug.json"))).toBe(true);
    expect(existsSync(ws.path("screenshots", "shot.png"))).toBe(true);
    expect(existsSync(ws.path("screenshots", "2-shot.png"))).toBe(true);
    expect(bug.attachments[0]?.localPath).toBe(join("screenshots", "shot.png"));
    expect(bug.attachments[1]?.localPath).toBe(join("screenshots", "2-shot.png"));
    expect(bug.attachments[2]?.localPath).toBeNull();
  });
});
