import { afterEach, describe, expect, it } from "vitest";
import { clearSecrets, redact, registerSecret } from "../src/util/redact.js";

afterEach(() => clearSecrets());

describe("redact", () => {
  it("redacts registered secrets everywhere, including url-encoded forms", () => {
    registerSecret("s3cr3t-pat-value");
    expect(redact("Authorization uses s3cr3t-pat-value here")).not.toContain("s3cr3t-pat-value");
    registerSecret("a b/c secret");
    expect(redact(`url?token=${encodeURIComponent("a b/c secret")}`)).not.toContain("a%20b%2Fc");
  });

  it("redacts well-known token shapes without registration", () => {
    expect(redact("token ghp_0123456789abcdefghij0123456789abcdef")).toContain("[REDACTED]");
    expect(redact("github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).toContain("[REDACTED]");
    const auth = redact("authorization: Bearer abc.def.ghi rest");
    expect(auth).toContain("authorization: Bearer [REDACTED]");
    expect(auth).not.toContain("abc.def.ghi");
  });

  it("ignores short strings (too risky to blanket-replace)", () => {
    registerSecret("ab");
    expect(redact("absolutely")).toBe("absolutely");
  });
});
