import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { escapeCmdArgument, escapeCmdCommand, exec, findExecutable } from "../src/util/exec.js";

const tmp = mkdtempSync(join(tmpdir(), "bugzinga-exec-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("findExecutable", () => {
  it("finds node on PATH", () => {
    const path = findExecutable("node");
    expect(path).toBeTruthy();
  });

  it("returns null for nonsense", () => {
    expect(findExecutable("definitely-not-a-real-binary-xyz")).toBeNull();
  });
});

describe("cmd escaping", () => {
  it("quotes arguments and escapes embedded quotes and metacharacters", () => {
    expect(escapeCmdArgument("plain")).toBe('^"plain^"');
    expect(escapeCmdArgument('say "hi"')).toBe('^"say^ \\^"hi\\^"^"');
    expect(escapeCmdArgument("a&b")).toBe('^"a^&b^"');
  });

  it("escapes command path metacharacters", () => {
    expect(escapeCmdCommand("C:\\Program Files\\x.cmd")).toBe("C:\\Program^ Files\\x.cmd");
  });
});

describe("exec", () => {
  it("runs a command and captures output", async () => {
    const result = await exec("node", ["-e", "console.log('out'); console.error('err')"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("out");
    expect(result.stderr).toContain("err");
    expect(result.timedOut).toBe(false);
  });

  it("passes stdin", async () => {
    const result = await exec(
      "node",
      ["-e", "process.stdin.pipe(process.stdout)"],
      { stdin: "ping" },
    );
    expect(result.stdout).toBe("ping");
  });

  it("kills on timeout and reports it", async () => {
    const result = await exec("node", ["-e", "setTimeout(() => {}, 60000)"], {
      timeoutMs: 1500,
    });
    expect(result.timedOut).toBe(true);
  }, 15_000);

  it.runIf(process.platform === "win32")("runs .cmd shims through cmd.exe", async () => {
    const shim = join(tmp, "echoer.cmd");
    // %1 keeps the surrounding quotes (using %~1 would re-expose & to cmd).
    writeFileSync(shim, "@echo off\r\necho got:%1\r\n");
    const result = await exec(shim, ["hello world & more"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('got:"hello world & more"');
  });
});
