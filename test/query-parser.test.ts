import { describe, expect, it } from "vitest";
import { formatQuery, type CompareNode, type LogicalNode } from "../src/query/ast.js";
import { parseQuery } from "../src/query/parser.js";
import { QueryError } from "../src/util/errors.js";

describe("parseQuery", () => {
  it("parses the canonical query", () => {
    const node = parseQuery("priority=2 AND severity=2 AND assignee=me") as LogicalNode;
    expect(node.type).toBe("and");
    expect(node.nodes).toHaveLength(3);
    expect(node.nodes[0]).toEqual({ type: "cmp", field: "priority", op: "=", value: "2" });
    expect(node.nodes[2]).toEqual({ type: "cmp", field: "assignee", op: "=", value: "me" });
  });

  it("parses a single comparison", () => {
    expect(parseQuery("severity<=2")).toEqual({
      type: "cmp",
      field: "severity",
      op: "<=",
      value: "2",
    });
  });

  it("supports OR with parentheses and precedence (AND binds tighter)", () => {
    const node = parseQuery("priority=1 OR priority=2 AND severity=1") as LogicalNode;
    expect(node.type).toBe("or");
    expect(node.nodes).toHaveLength(2);
    expect((node.nodes[1] as LogicalNode).type).toBe("and");

    const grouped = parseQuery("(priority=1 OR priority=2) AND severity=1") as LogicalNode;
    expect(grouped.type).toBe("and");
    expect((grouped.nodes[0] as LogicalNode).type).toBe("or");
  });

  it("supports quoted values with spaces", () => {
    const node = parseQuery('area="Web\\UI Components" AND title~"null reference"') as LogicalNode;
    expect((node.nodes[0] as CompareNode).value).toBe("Web\\UI Components");
    expect((node.nodes[1] as CompareNode).op).toBe("~");
  });

  it("accepts field aliases and case-insensitive keywords", () => {
    const node = parseQuery("pri=2 and sev=1 AND assignedTo=me AND label=regression") as LogicalNode;
    const fields = node.nodes.map((n) => (n as CompareNode).field);
    expect(fields).toEqual(["priority", "severity", "assignee", "tag"]);
  });

  it("rejects unknown fields with a position pointer", () => {
    expect(() => parseQuery("priority=2 AND severty=2")).toThrowError(QueryError);
    expect(() => parseQuery("priority=2 AND severty=2")).toThrowError(/unknown field "severty"/);
  });

  it("rejects dangling operators and empty queries", () => {
    expect(() => parseQuery("priority=")).toThrowError(/expected a value/);
    expect(() => parseQuery("priority 2")).toThrowError(/expected an operator/);
    expect(() => parseQuery("   ")).toThrowError(/empty/i);
    expect(() => parseQuery("(priority=2")).toThrowError(/expected "\)"/);
  });

  it("round-trips through formatQuery", () => {
    const text = 'priority=2 AND (severity=1 OR severity=2) AND assignee=me';
    expect(formatQuery(parseQuery(text))).toBe(
      "priority=2 AND (severity=1 OR severity=2) AND assignee=me",
    );
  });
});
