import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";
import { ExecError } from "./errors.js";

const IS_WINDOWS = process.platform === "win32";

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stdin?: string;
  /** Streamed for every chunk — use to tee agent transcripts to a file. */
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  /** Max bytes of stdout/stderr retained in the result (tail). Default 2 MiB. */
  maxBuffer?: number;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  command: string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function candidatesFor(base: string): string[] {
  if (!IS_WINDOWS) return [base];
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const out: string[] = [];
  if (extname(base)) out.push(base);
  for (const ext of exts) out.push(base + ext.toLowerCase());
  if (!extname(base)) out.push(base);
  return out;
}

/** Resolve an executable on PATH (honouring PATHEXT on Windows). */
export function findExecutable(name: string, extraDirs: string[] = []): string | null {
  if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    for (const candidate of candidatesFor(resolve(name))) {
      if (isFile(candidate)) return candidate;
    }
    return null;
  }
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of [...extraDirs, ...pathDirs]) {
    for (const candidate of candidatesFor(join(dir, name))) {
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * cmd.exe metacharacter escaping (the cross-spawn algorithm). Needed because
 * npm-installed CLIs (claude, cursor-agent, codex) are .cmd shims on Windows
 * and must be launched via `cmd.exe /d /s /c`.
 */
export function escapeCmdArgument(arg: string): string {
  let out = arg.replace(/(\\*)"/g, '$1$1\\"');
  out = out.replace(/(\\*)$/, "$1$1");
  out = `"${out}"`;
  return out.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
}

export function escapeCmdCommand(command: string): string {
  return command.replace(/([()\][%!^"`<>&|;, *?])/g, "^$1");
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (IS_WINDOWS) {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } catch {}
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}

/**
 * Run a command without a shell (args passed verbatim), with timeout,
 * process-tree kill, capped output capture, and .cmd shim support.
 */
export function exec(
  command: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const resolved = findExecutable(command) ?? command;
  const useCmdShim = IS_WINDOWS && /\.(cmd|bat)$/i.test(resolved);
  const file = useCmdShim ? (process.env.ComSpec ?? "cmd.exe") : resolved;
  const finalArgs = useCmdShim
    ? [
        "/d",
        "/s",
        "/c",
        `"${[escapeCmdCommand(resolved), ...args.map(escapeCmdArgument)].join(" ")}"`,
      ]
    : args;
  const display = `${command} ${args.join(" ")}`.trim();
  const cap = opts.maxBuffer ?? 2 * 1024 * 1024;
  const started = Date.now();

  return new Promise<ExecResult>((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(file, finalArgs, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: useCmdShim,
        detached: !IS_WINDOWS,
      });
    } catch (err) {
      rejectPromise(new ExecError(`Failed to spawn "${display}"`, { cause: err }));
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const append = (current: string, chunk: string): string => {
      const next = current + chunk;
      return next.length > cap ? next.slice(next.length - cap) : next;
    };

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, opts.timeoutMs)
      : null;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = append(stdout, chunk);
      opts.onOutput?.(chunk, "stdout");
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = append(stderr, chunk);
      opts.onOutput?.(chunk, "stderr");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      rejectPromise(new ExecError(`Failed to run "${display}": ${err.message}`, { cause: err }));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolvePromise({
        code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
        command: display,
      });
    });

    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin);
    }
    child.stdin?.end();
  });
}
