import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(root, "dist", "cli", "index.js");

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

describe("bugzinga --version", () => {
  // The bug surfaces only in the built artifact, so ensure dist exists before running.
  beforeAll(() => {
    if (!existsSync(cliPath)) execSync("npm run build", { cwd: root, stdio: "inherit" });
  }, 120_000);

  it("reports the packaged version, not the 0.0.0 fallback", () => {
    const output = execFileSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" }).trim();
    expect(output).toBe(packageVersion());
    expect(output).not.toBe("0.0.0");
  });
});
