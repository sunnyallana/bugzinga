import { describe, expect, it } from "vitest";
import { parseConfigText } from "../src/config/load.js";
import { ConfigError } from "../src/util/errors.js";

describe("config loading", () => {
  it("applies defaults to a minimal azure config", () => {
    const config = parseConfigText(
      JSON.stringify({
        tracker: { kind: "azure", organization: "acme", project: "Rocket", repository: "rocket" },
      }),
      "test.json",
    );
    expect(config.tracker.kind).toBe("azure");
    expect(config.agent.kind).toBe("claude");
    expect(config.agent.autonomy).toBe("edits");
    expect(config.pipeline.maxFixAttempts).toBe(5);
    expect(config.pipeline.reproRequired).toBe(true);
    expect(config.pipeline.concurrency).toBe(2);
    expect(config.pipeline.timeoutMinutes.fix).toBe(60);
    expect(config.delivery.autoCommit).toBe(true);
    expect(config.delivery.push).toBe(false);
    expect(config.delivery.branchPrefix).toBe("bugzinga/");
    expect(config.debugging.enabled).toBe(true);
    expect(config.repo.defaultBranch).toBe("main");
    expect(config.bugsRoot.length).toBeGreaterThan(0);
  });

  it("applies github label defaults and overrides", () => {
    const config = parseConfigText(
      JSON.stringify({
        tracker: { kind: "github", owner: "acme", repo: "rocket", labels: { priority: "P{n}" } },
        pipeline: { timeoutMinutes: { fix: 90 }, concurrency: 4 },
      }),
      null,
    );
    expect(config.tracker.kind).toBe("github");
    if (config.tracker.kind === "github") {
      expect(config.tracker.labels.priority).toBe("P{n}");
      expect(config.tracker.labels.severity).toBe("severity:{n}");
    }
    expect(config.pipeline.timeoutMinutes.fix).toBe(90);
    expect(config.pipeline.timeoutMinutes.reproduce).toBe(30);
    expect(config.pipeline.concurrency).toBe(4);
  });

  it("tolerates a UTF-8 BOM (Notepad / PowerShell Set-Content)", () => {
    const config = parseConfigText(
      `﻿${JSON.stringify({ tracker: { kind: "github", owner: "a", repo: "b" } })}`,
      "bom.json",
    );
    expect(config.tracker.kind).toBe("github");
  });

  it("resolves per-phase models, deterministicBaseline, and a single mcp server", () => {
    const config = parseConfigText(
      JSON.stringify({
        tracker: { kind: "github", owner: "a", repo: "b" },
        agent: { model: "opus", models: { baseline: "haiku", fix: "opus-max" } },
        pipeline: { deterministicBaseline: false },
        debugging: { enabled: true, mcp: { name: "pointbreak", command: "pb" } },
      }),
      null,
    );
    expect(config.agent.model).toBe("opus");
    expect(config.agent.models.baseline).toBe("haiku");
    expect(config.agent.models.fix).toBe("opus-max");
    expect(config.agent.models.reproduce).toBeUndefined();
    expect(config.pipeline.deterministicBaseline).toBe(false);
    expect(config.debugging.mcp).toEqual([{ name: "pointbreak", command: "pb", args: [] }]);
  });

  it("accepts a list of mcp servers and defaults to none", () => {
    const many = parseConfigText(
      JSON.stringify({
        tracker: { kind: "github", owner: "a", repo: "b" },
        debugging: {
          mcp: [
            { name: "playwright", command: "npx", args: ["@playwright/mcp@latest"] },
            { name: "pointbreak", command: "pb" },
          ],
        },
      }),
      null,
    );
    expect(many.debugging.mcp.map((s) => s.name)).toEqual(["playwright", "pointbreak"]);
    expect(many.debugging.mcp[0]?.args).toEqual(["@playwright/mcp@latest"]);

    const none = parseConfigText(
      JSON.stringify({ tracker: { kind: "github", owner: "a", repo: "b" } }),
      null,
    );
    expect(none.debugging.mcp).toEqual([]);
    expect(none.pipeline.deterministicBaseline).toBe(true);
    expect(none.agent.models).toEqual({});
  });

  it("rejects invalid JSON and bad schemas with readable errors", () => {
    expect(() => parseConfigText("{not json", "x.json")).toThrowError(ConfigError);
    expect(() =>
      parseConfigText(JSON.stringify({ tracker: { kind: "jira" } }), "x.json"),
    ).toThrowError(ConfigError);
    expect(() =>
      parseConfigText(
        JSON.stringify({
          tracker: { kind: "azure", organization: "a", project: "p" },
          agent: { kind: "copilot" },
        }),
        "x.json",
      ),
    ).toThrowError(/agent/);
  });
});
