import { createWriteStream } from "node:fs";
import { dirname } from "node:path";
import type { AgentKind } from "../core/types.js";
import { exec, findExecutable } from "../util/exec.js";
import { ensureDir } from "../util/fsx.js";
import { redact } from "../util/redact.js";
import {
  pointerPrompt,
  type AgentAvailability,
  type AgentRunResult,
  type AgentTask,
  type CodingAgent,
} from "./types.js";

export abstract class BaseAgent implements CodingAgent {
  abstract readonly kind: AgentKind;
  abstract readonly displayName: string;
  abstract readonly binary: string;

  /** Build the CLI args for this agent. May write auxiliary files (e.g. MCP config). */
  protected abstract buildArgs(task: AgentTask, prompt: string): string[];

  async isAvailable(): Promise<AgentAvailability> {
    const path = findExecutable(this.binary);
    if (!path) return { available: false, path: null, version: null };
    try {
      const result = await exec(this.binary, ["--version"], { timeoutMs: 30_000 });
      const version = result.stdout.trim().split(/\r?\n/)[0] ?? null;
      return { available: result.code === 0, path, version };
    } catch {
      return { available: false, path, version: null };
    }
  }

  async run(task: AgentTask): Promise<AgentRunResult> {
    const args = [...this.buildArgs(task, pointerPrompt(task.promptFile)), ...task.extraArgs];

    ensureDir(dirname(task.transcriptFile));
    const transcript = createWriteStream(task.transcriptFile, { flags: "a" });
    transcript.write(
      `\n===== ${new Date().toISOString()} ${this.binary} (timeout ${Math.round(task.timeoutMs / 60000)}m) =====\n`,
    );

    try {
      const result = await exec(this.binary, args, {
        cwd: task.cwd,
        timeoutMs: task.timeoutMs,
        onOutput: (chunk) => transcript.write(redact(chunk)),
        env: { NO_COLOR: "1", FORCE_COLOR: "0", CI: "true" },
      });
      transcript.write(
        `\n===== exit ${result.code}${result.timedOut ? " (TIMED OUT)" : ""} after ${Math.round(result.durationMs / 1000)}s =====\n`,
      );
      return {
        ok: result.code === 0 && !result.timedOut,
        exitCode: result.code,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        outputTail: redact((result.stdout + "\n" + result.stderr).slice(-4000)),
      };
    } finally {
      transcript.end();
    }
  }
}
