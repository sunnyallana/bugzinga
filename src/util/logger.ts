import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pc from "picocolors";
import { redact } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

let verboseEnabled = false;

export function setVerbose(on: boolean): void {
  verboseEnabled = on;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

const madeDirs = new Set<string>();

function appendLine(filePath: string, line: string): void {
  const dir = dirname(filePath);
  if (!madeDirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    madeDirs.add(dir);
  }
  appendFileSync(filePath, `${line}\n`, "utf8");
}

const SYMBOLS: Record<LogLevel | "success", string> = {
  debug: pc.dim("·"),
  info: pc.cyan("›"),
  warn: pc.yellow("!"),
  error: pc.red("✗"),
  success: pc.green("✓"),
};

/**
 * Console + optional JSONL-file logger. Everything passes through redact()
 * so credentials never reach a terminal or a log file.
 */
export class Logger {
  constructor(
    readonly scope: string,
    private readonly filePath: string | null = null,
  ) {}

  child(scope: string): Logger {
    return new Logger(this.scope ? `${this.scope}:${scope}` : scope, this.filePath);
  }

  withFile(filePath: string): Logger {
    return new Logger(this.scope, filePath);
  }

  debug(message: string): void {
    this.write("debug", message, !verboseEnabled);
  }

  info(message: string): void {
    this.write("info", message, false);
  }

  success(message: string): void {
    this.write("info", message, false, SYMBOLS.success);
  }

  warn(message: string): void {
    this.write("warn", message, false);
  }

  error(message: string): void {
    this.write("error", message, false);
  }

  /** Plain line without scope/symbol decoration (tables, banners). */
  raw(message: string): void {
    console.log(redact(message));
  }

  private write(
    level: LogLevel,
    message: string,
    fileOnly: boolean,
    symbol?: string,
  ): void {
    const clean = redact(message);
    if (!fileOnly) {
      const prefix = this.scope ? `${pc.dim(`[${this.scope}]`)} ` : "";
      const line = `${symbol ?? SYMBOLS[level]} ${prefix}${clean}`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    }
    if (this.filePath) {
      try {
        appendLine(
          this.filePath,
          JSON.stringify({
            ts: new Date().toISOString(),
            level,
            scope: this.scope,
            msg: clean,
          }),
        );
      } catch {
        // Logging must never take the pipeline down.
      }
    }
  }
}

export function createLogger(scope = "", filePath: string | null = null): Logger {
  return new Logger(scope, filePath);
}
