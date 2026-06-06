import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ERROR_PATTERN,
  matchLines,
  runDeterministicBaseline,
  WARNING_PATTERN,
} from "../src/pipeline/baseline.js";

const tmp = mkdtempSync(join(tmpdir(), "bugzinga-baseline-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("deterministic baseline", () => {
  it("extracts unique warning/error lines", () => {
    const output = [
      "compiling…",
      "warning CS0168: unused variable",
      "warning CS0168: unused variable", // duplicate
      "error TS2304: cannot find name",
      "Build FAILED.",
      "all good here",
    ].join("\n");
    expect(matchLines(output, WARNING_PATTERN)).toEqual(["warning CS0168: unused variable"]);
    expect(matchLines(output, ERROR_PATTERN)).toEqual([
      "error TS2304: cannot find name",
      "Build FAILED.",
    ]);
  });

  it("writes a complete baseline for a passing build and records tests informationally", async () => {
    const artifactPath = join(tmp, "ok.md");
    const verdict = await runDeterministicBaseline({
      bugId: "T-OK",
      buildCommand: "echo warning: deprecated api",
      testCommand: "echo 1 failed of 10",
      cwd: tmp,
      artifactPath,
      timeoutMs: 60_000,
    });
    expect(verdict).toBe("complete");
    const text = readFileSync(artifactPath, "utf8");
    expect(text).toContain("# Baseline Build Report: T-OK");
    expect(text).toContain("warning: deprecated api");
    expect(text).toContain("Test Baseline");
    expect(text).toContain("1 failed of 10");
    expect(text.trimEnd().endsWith("BUGZINGA_VERDICT: complete")).toBe(true);
  });

  it("returns build-broken on a failing build and skips the test run", async () => {
    const artifactPath = join(tmp, "broken.md");
    const verdict = await runDeterministicBaseline({
      bugId: "T-BROKEN",
      buildCommand: "exit 7",
      testCommand: "echo should-not-run",
      cwd: tmp,
      artifactPath,
      timeoutMs: 60_000,
    });
    expect(verdict).toBe("build-broken");
    const text = readFileSync(artifactPath, "utf8");
    expect(text).not.toContain("should-not-run");
    expect(text).toContain("deterministicBaseline");
    expect(text.trimEnd().endsWith("BUGZINGA_VERDICT: build-broken")).toBe(true);
  });
});
