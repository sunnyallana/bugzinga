import { describe, expect, it } from "vitest";
import { compileGithubSearch } from "../src/query/github-search.js";
import { parseQuery } from "../src/query/parser.js";
import { QueryError } from "../src/util/errors.js";

const opts = {
  owner: "acme",
  repo: "rocket",
  labels: { priority: "priority:{n}", severity: "severity:{n}" },
};

describe("GitHub search compiler", () => {
  it("compiles the canonical query", () => {
    const q = compileGithubSearch(parseQuery("priority=2 AND severity=2 AND assignee=me"), opts);
    // labels containing ":" are quoted — the unambiguous GitHub search form
    expect(q).toBe(
      'repo:acme/rocket is:issue is:open label:"priority:2" label:"severity:2" assignee:@me',
    );
  });

  it("respects custom label formats", () => {
    const q = compileGithubSearch(parseQuery("priority=1"), {
      ...opts,
      labels: { priority: "P{n}", severity: "sev/{n}" },
    });
    expect(q).toContain("label:P1");
  });

  it("supports negation, plain labels, state, and title terms", () => {
    const q = compileGithubSearch(
      parseQuery('severity!=4 AND tag=bug AND state=closed AND title~"crash on save"'),
      opts,
    );
    expect(q).toContain('-label:"severity:4"');
    expect(q).toContain("label:bug");
    expect(q).toContain("state:closed");
    expect(q).toContain('"crash on save" in:title');
    expect(q).not.toContain("is:open");
  });

  it("rejects OR queries loudly", () => {
    expect(() => compileGithubSearch(parseQuery("priority=1 OR priority=2"), opts)).toThrowError(
      /cannot express OR/,
    );
  });

  it("rejects range operators on labels and ADO-only fields", () => {
    expect(() => compileGithubSearch(parseQuery("priority<=2"), opts)).toThrowError(QueryError);
    expect(() => compileGithubSearch(parseQuery('area="Web"'), opts)).toThrowError(
      /Azure DevOps-only/,
    );
  });
});
