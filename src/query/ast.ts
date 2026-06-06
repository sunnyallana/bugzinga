/**
 * Bug-query AST. One small DSL — `priority=2 AND severity=2 AND assignee=me` —
 * compiled per tracker (WIQL for Azure DevOps, search qualifiers for GitHub).
 */

export type CompareOp = "=" | "!=" | "<" | "<=" | ">" | ">=" | "~";

export const QUERY_FIELDS = [
  "priority",
  "severity",
  "assignee",
  "state",
  "tag",
  "title",
  "area",
  "iteration",
  "id",
] as const;

export type QueryField = (typeof QUERY_FIELDS)[number];

export interface CompareNode {
  type: "cmp";
  field: QueryField;
  op: CompareOp;
  value: string;
}

export interface LogicalNode {
  type: "and" | "or";
  nodes: QueryNode[];
}

export type QueryNode = CompareNode | LogicalNode;

export function cmp(field: QueryField, op: CompareOp, value: string): CompareNode {
  return { type: "cmp", field, op, value };
}

/** n-ary, flattening constructor. */
export function logical(kind: "and" | "or", nodes: QueryNode[]): QueryNode {
  const flat: QueryNode[] = [];
  for (const node of nodes) {
    if (node.type === kind) flat.push(...node.nodes);
    else flat.push(node);
  }
  if (flat.length === 1 && flat[0]) return flat[0];
  return { type: kind, nodes: flat };
}

export function queryMentions(node: QueryNode, field: QueryField): boolean {
  if (node.type === "cmp") return node.field === field;
  return node.nodes.some((n) => queryMentions(n, field));
}

export function walkCompares(node: QueryNode, visit: (cmp: CompareNode) => void): void {
  if (node.type === "cmp") {
    visit(node);
    return;
  }
  for (const child of node.nodes) walkCompares(child, visit);
}

/**
 * If the query consists solely of `id = N` terms (joined any way), return the
 * ids so trackers can fetch them directly instead of searching. Otherwise null.
 */
export function extractIdOnlyQuery(node: QueryNode): string[] | null {
  const ids: string[] = [];
  let pure = true;
  walkCompares(node, (c) => {
    if (c.field === "id" && c.op === "=") ids.push(c.value);
    else pure = false;
  });
  return pure && ids.length > 0 ? ids : null;
}

export function formatQuery(node: QueryNode): string {
  if (node.type === "cmp") {
    const value = /[\s()]/.test(node.value) ? `"${node.value}"` : node.value;
    return `${node.field}${node.op}${value}`;
  }
  const joiner = node.type === "and" ? " AND " : " OR ";
  return node.nodes
    .map((n) => (n.type === "cmp" ? formatQuery(n) : `(${formatQuery(n)})`))
    .join(joiner);
}
