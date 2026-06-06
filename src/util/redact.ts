/**
 * Secret redaction. Every credential the process learns about is registered
 * here, and every string that leaves the process (console, log files, error
 * messages, agent prompts) should pass through redact().
 */

const registered = new Set<string>();

export function registerSecret(secret: string | null | undefined): void {
  if (secret && secret.length >= 6) registered.add(secret);
}

/** Exposed for tests. */
export function clearSecrets(): void {
  registered.clear();
}

const PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  // "Authorization: Basic/Bearer xxx" in any captured output
  /((?:authorization|proxy-authorization)\s*[:=]\s*(?:basic|bearer)\s+)[^\s"',;]+/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const secret of registered) {
    out = out.split(secret).join("[REDACTED]");
    // PATs frequently appear base64- or URL-encoded; cover the common cases.
    const enc = encodeURIComponent(secret);
    if (enc !== secret) out = out.split(enc).join("[REDACTED]");
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match, prefix: unknown) =>
      typeof prefix === "string" && prefix.length > 0 ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return out;
}
