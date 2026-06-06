import { describe, expect, it } from "vitest";
import { attachmentKind, parseAdoSeverity, renderBugMarkdown, type Bug } from "../src/core/bug.js";
import { branchFromArtifactUrl } from "../src/trackers/azure.js";
import {
  extractAttachmentUrls,
  extractBranchFromBody,
  extractIssueSection,
  labelNumber,
  ENVIRONMENT_SECTION,
  REPRO_SECTION,
} from "../src/trackers/github.js";

describe("azure helpers", () => {
  it("decodes branch from a vstfs Git ref artifact link", () => {
    const url =
      "vstfs:///Git/Ref/4f2e1a%2F9b8c7d%2FGBfeature%2Flogin-redesign";
    expect(branchFromArtifactUrl(url)).toBe("feature/login-redesign");
  });

  it("returns null for non-ref artifacts", () => {
    expect(branchFromArtifactUrl("vstfs:///Git/PullRequestId/abc%2F123")).toBeNull();
    expect(branchFromArtifactUrl("https://example.com")).toBeNull();
  });

  it("parses ADO severity labels", () => {
    expect(parseAdoSeverity("2 - High")).toEqual({ num: 2, label: "2 - High" });
    expect(parseAdoSeverity("1 - Critical").num).toBe(1);
    expect(parseAdoSeverity(null)).toEqual({ num: null, label: null });
  });
});

describe("github helpers", () => {
  const body = [
    "Something crashes.",
    "",
    "### Steps to reproduce",
    "1. Open the app",
    "2. Click save",
    "",
    "### Environment",
    "- OS: Windows 11",
    "- Version: 2.4.1",
    "",
    "**Branch**",
    "release/2.4",
    "",
    "![crash](https://github.com/user-attachments/assets/abcd-1234)",
    '<img src="https://user-images.githubusercontent.com/1/err.png">',
  ].join("\n");

  it("extracts repro and environment sections", () => {
    expect(extractIssueSection(body, REPRO_SECTION)).toBe("1. Open the app\n2. Click save");
    expect(extractIssueSection(body, ENVIRONMENT_SECTION)).toContain("OS: Windows 11");
  });

  it("extracts the branch from a Branch section or inline mention", () => {
    expect(extractBranchFromBody(body)).toBe("release/2.4");
    expect(extractBranchFromBody("seen on branch: hotfix/save-crash today")).toBe(
      "hotfix/save-crash",
    );
    expect(extractBranchFromBody("no branch here")).toBeNull();
  });

  it("extracts attachment urls with synthesized names", () => {
    const urls = extractAttachmentUrls(body);
    expect(urls).toHaveLength(2);
    expect(urls[0]?.url).toBe("https://github.com/user-attachments/assets/abcd-1234");
    expect(urls[0]?.name).toMatch(/\.png$/);
    expect(urls[1]?.name).toBe("err.png");
  });

  it("reverses label formats", () => {
    expect(labelNumber("priority:{n}", "priority:2")).toBe(2);
    expect(labelNumber("P{n}", "P1")).toBe(1);
    expect(labelNumber("priority:{n}", "severity:2")).toBeNull();
    expect(labelNumber("sev/{n}", "SEV/3")).toBe(3);
  });

  it("classifies attachments", () => {
    expect(attachmentKind("shot.PNG")).toBe("image");
    expect(attachmentKind("trace.log")).toBe("file");
  });
});

describe("renderBugMarkdown", () => {
  const bug: Bug = {
    tracker: "azure",
    id: "48213",
    workspaceId: "48213",
    url: "https://dev.azure.com/acme/Proj/_workitems/edit/48213",
    title: "Save crashes | with pipes",
    state: "Active",
    description: "It crashes.",
    reproSteps: "1. Save\n2. Boom",
    environment: "Windows 11, build 2.4",
    priority: 2,
    severity: 2,
    severityLabel: "2 - High",
    assignee: "Sunny Shaban",
    tags: ["regression", "ui"],
    branch: "feature/save",
    foundIn: "2.4.0-rc1",
    areaPath: "Proj\\Web",
    iterationPath: "Proj\\Sprint 12",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-05T00:00:00Z",
    attachments: [
      { name: "err.png", url: "https://x/err", kind: "image", localPath: "screenshots\\err.png" },
      { name: "trace.log", url: "https://x/trace", kind: "file", localPath: null },
    ],
    comments: [{ author: "QA Bob", date: "2026-06-02", text: "Repros every time." }],
  };

  it("renders a complete deterministic document", () => {
    const md = renderBugMarkdown(bug);
    expect(md).toContain("# Bug 48213: Save crashes | with pipes");
    expect(md).toContain("| Branch produced on | feature/save |");
    expect(md).toContain("| Severity | 2 - High |");
    expect(md).toContain("## Repro Steps");
    expect(md).toContain("## Environment");
    expect(md).toContain("screenshots\\err.png");
    expect(md).toContain("(not downloaded)");
    expect(md).toContain("**QA Bob** (2026-06-02):");
  });

  it("omits empty fields", () => {
    const minimal: Bug = {
      ...bug,
      branch: null,
      foundIn: null,
      tags: [],
      attachments: [],
      comments: [],
      reproSteps: null,
      environment: null,
    };
    const md = renderBugMarkdown(minimal);
    expect(md).not.toContain("Branch produced on");
    expect(md).not.toContain("## Repro Steps");
    expect(md).toContain("_None_");
  });
});
