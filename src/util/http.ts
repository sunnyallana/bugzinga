import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TrackerError, toMessage } from "./errors.js";
import { ensureDir } from "./fsx.js";
import { redact } from "./redact.js";

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  jsonBody?: unknown;
  timeoutMs?: number;
  retries?: number;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function safeUrl(url: string): string {
  // Strip query strings — attachment URLs frequently carry SAS tokens.
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

function snippet(text: string, max = 300): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
  }
  return Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 250), 15_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransient(err: unknown): boolean {
  const msg = toMessage(err).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("socket")
  );
}

export async function httpRaw(url: string, opts: HttpOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  const headers: Record<string, string> = { ...opts.headers };
  let body: string | undefined;
  if (opts.jsonBody !== undefined) {
    body = JSON.stringify(opts.jsonBody);
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });

      // Azure DevOps answers an invalid PAT with 203 + an HTML sign-in page.
      if (res.status === 203) {
        throw new TrackerError(
          `Authentication failed for ${safeUrl(url)} — the server returned a sign-in page. Check that your PAT is valid, not expired, and has the required scopes.`,
        );
      }
      if (res.ok) return res;

      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await sleep(backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      const text = await res.text().catch(() => "");
      throw new TrackerError(
        `HTTP ${res.status} ${res.statusText} for ${safeUrl(url)}${
          text ? `: ${snippet(redact(text))}` : ""
        }`,
      );
    } catch (err) {
      if (err instanceof TrackerError) throw err;
      if (attempt < retries && isTransient(err)) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw new TrackerError(
        `Request failed for ${safeUrl(url)}: ${toMessage(err)}`,
        { cause: err },
      );
    }
  }
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await httpRaw(url, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const hint = text.trimStart().startsWith("<")
      ? " (received HTML — this usually means an authentication problem)"
      : "";
    throw new TrackerError(
      `Expected JSON from ${safeUrl(url)}${hint}: ${snippet(redact(text))}`,
    );
  }
}

export async function downloadToFile(
  url: string,
  destPath: string,
  headers?: Record<string, string>,
): Promise<void> {
  const res = await httpRaw(url, { headers, timeoutMs: 120_000 });
  const buffer = Buffer.from(await res.arrayBuffer());
  ensureDir(dirname(destPath));
  writeFileSync(destPath, buffer);
}
