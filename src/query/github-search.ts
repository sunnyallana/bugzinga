import { QueryError } from "../util/errors.js";
import { walkCompares, type CompareNode, type QueryNode } from "./ast.js";

/** GitHub issue-search compilation. */

export interface GithubSearchOptions {
  owner: string;
  repo: string;
  /** Label format strings with a {n} placeholder, e.g. "priority:{n}" or "P{n}". */
  labels: { priority: string; severity: string };
}

function quoteQualifierValue(value: string): string {
  return /[\s:]/.test(value) ? `"${value}"` : value;
}

function labelTerm(format: string, value: string, negated: boolean): string {
  const label = format.replace("{n}", value);
  return `${negated ? "-" : ""}label:${quoteQualifierValue(label)}`;
}

function compileTerm(node: CompareNode, opts: GithubSearchOptions): string {
  const { field, op, value } = node;
  const unsupportedOp = (allowed: string): never => {
    throw new QueryError(
      `GitHub search cannot express ${field}${op}${value} — labels are exact strings. Use ${allowed}.`,
    );
  };
  switch (field) {
    case "priority":
      if (op !== "=" && op !== "!=") return unsupportedOp("= or !=");
      return labelTerm(opts.labels.priority, value, op === "!=");
    case "severity":
      if (op !== "=" && op !== "!=") return unsupportedOp("= or !=");
      return labelTerm(opts.labels.severity, value, op === "!=");
    case "assignee": {
      if (op !== "=" && op !== "!=") return unsupportedOp("= or !=");
      const target = value.toLowerCase() === "me" ? "@me" : value;
      if (value.toLowerCase() === "unassigned") return "no:assignee";
      return `${op === "!=" ? "-" : ""}assignee:${target}`;
    }
    case "state": {
      if (op !== "=" && op !== "!=") return unsupportedOp("= or !=");
      const normalized = value.toLowerCase() === "active" ? "open" : value.toLowerCase();
      if (normalized !== "open" && normalized !== "closed") {
        throw new QueryError(`GitHub issue state must be open or closed, got "${value}".`);
      }
      const effective = op === "!=" ? (normalized === "open" ? "closed" : "open") : normalized;
      return `state:${effective}`;
    }
    case "tag":
      if (op !== "=" && op !== "!=" && op !== "~") return unsupportedOp("= or !=");
      return `${op === "!=" ? "-" : ""}label:${quoteQualifierValue(value)}`;
    case "title":
      if (op !== "~" && op !== "=") return unsupportedOp("~ (contains)");
      return `${quoteQualifierValue(value)} in:title`;
    case "id":
      throw new QueryError(
        "GitHub search cannot filter by issue number — run `bugzinga fix <number>` or `bugzinga import --id <number>` instead.",
      );
    case "area":
    case "iteration":
      throw new QueryError(
        `Field "${field}" is Azure DevOps-only. GitHub queries support: priority, severity, assignee, state, tag, title.`,
      );
  }
}

/**
 * GitHub's issue search has no OR across qualifiers, so only pure-AND queries
 * compile. We fail loudly rather than silently returning the wrong bug set.
 */
export function compileGithubSearch(node: QueryNode, opts: GithubSearchOptions): string {
  const hasOr = (n: QueryNode): boolean =>
    n.type === "or" ? true : n.type === "and" ? n.nodes.some(hasOr) : false;
  if (hasOr(node)) {
    throw new QueryError(
      "GitHub issue search cannot express OR conditions. Split the query and run bugzinga once per branch of the OR.",
    );
  }

  const terms: string[] = [];
  walkCompares(node, (c) => terms.push(compileTerm(c, opts)));

  const base = [`repo:${opts.owner}/${opts.repo}`, "is:issue"];
  const mentionsState = terms.some((t) => t.startsWith("state:"));
  if (!mentionsState) base.push("is:open");
  return [...base, ...terms].join(" ");
}
