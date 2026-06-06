import { QueryError } from "../util/errors.js";
import { queryMentions, type CompareNode, type QueryNode } from "./ast.js";

/** Azure DevOps WIQL compilation. */

const SEVERITY_LABELS: Record<number, string> = {
  1: "1 - Critical",
  2: "2 - High",
  3: "3 - Medium",
  4: "4 - Low",
};

const SEVERITY_NAMES: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function escapeWiql(value: string): string {
  return value.replace(/'/g, "''");
}

function severityNumber(value: string): number {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 4) return numeric;
  const named = SEVERITY_NAMES[value.toLowerCase()];
  if (named) return named;
  // Accept full labels like "2 - High".
  const match = value.match(/^\s*([1-4])\s*-/);
  if (match?.[1]) return Number(match[1]);
  throw new QueryError(
    `Invalid severity "${value}" — use 1-4 or critical/high/medium/low.`,
  );
}

function severitySetFor(op: string, n: number): number[] {
  const all = [1, 2, 3, 4];
  switch (op) {
    case "<":
      return all.filter((s) => s < n);
    case "<=":
      return all.filter((s) => s <= n);
    case ">":
      return all.filter((s) => s > n);
    case ">=":
      return all.filter((s) => s >= n);
    default:
      return [n];
  }
}

function compileSeverity(node: CompareNode): string {
  const field = "[Microsoft.VSTS.Common.Severity]";
  if (node.op === "~") {
    return `${field} CONTAINS '${escapeWiql(node.value)}'`;
  }
  const n = severityNumber(node.value);
  if (node.op === "=" || node.op === "!=") {
    const label = SEVERITY_LABELS[n];
    return `${field} ${node.op === "=" ? "=" : "<>"} '${label}'`;
  }
  const set = severitySetFor(node.op, n);
  if (set.length === 0) {
    throw new QueryError(`severity${node.op}${node.value} matches no severity (valid range is 1-4).`);
  }
  const labels = set.map((s) => `'${SEVERITY_LABELS[s]}'`).join(", ");
  return `${field} IN (${labels})`;
}

function compileCompare(node: CompareNode): string {
  const { field, op, value } = node;
  const esc = escapeWiql(value);
  switch (field) {
    case "priority": {
      const n = Number(value);
      if (!Number.isInteger(n)) {
        throw new QueryError(`Priority must be an integer, got "${value}".`);
      }
      if (op === "~") throw new QueryError("Operator ~ is not valid for priority.");
      return `[Microsoft.VSTS.Common.Priority] ${op === "!=" ? "<>" : op} ${n}`;
    }
    case "severity":
      return compileSeverity(node);
    case "assignee": {
      if (op !== "=" && op !== "!=") {
        throw new QueryError(`Operator ${op} is not valid for assignee (use = or !=).`);
      }
      const wiqlOp = op === "=" ? "=" : "<>";
      if (value.toLowerCase() === "me") return `[System.AssignedTo] ${wiqlOp} @Me`;
      if (value.toLowerCase() === "unassigned" || value === "") {
        return `[System.AssignedTo] ${wiqlOp} ''`;
      }
      return `[System.AssignedTo] ${wiqlOp} '${esc}'`;
    }
    case "state": {
      if (op === "~") return `[System.State] CONTAINS '${esc}'`;
      if (op !== "=" && op !== "!=") {
        throw new QueryError(`Operator ${op} is not valid for state.`);
      }
      return `[System.State] ${op === "=" ? "=" : "<>"} '${esc}'`;
    }
    case "tag": {
      if (op === "!=") return `[System.Tags] NOT CONTAINS '${esc}'`;
      return `[System.Tags] CONTAINS '${esc}'`;
    }
    case "title": {
      if (op === "=") return `[System.Title] = '${esc}'`;
      if (op === "~") return `[System.Title] CONTAINS '${esc}'`;
      throw new QueryError(`Operator ${op} is not valid for title (use = or ~).`);
    }
    case "area": {
      if (op === "=") return `[System.AreaPath] UNDER '${esc}'`;
      if (op === "!=") return `[System.AreaPath] NOT UNDER '${esc}'`;
      throw new QueryError(`Operator ${op} is not valid for area (use = or !=).`);
    }
    case "iteration": {
      if (value.toLowerCase() === "current" && op === "=") {
        return `[System.IterationPath] = @CurrentIteration`;
      }
      if (op === "=") return `[System.IterationPath] UNDER '${esc}'`;
      if (op === "!=") return `[System.IterationPath] NOT UNDER '${esc}'`;
      throw new QueryError(`Operator ${op} is not valid for iteration (use = or !=).`);
    }
    case "id": {
      const n = Number(value);
      if (!Number.isInteger(n)) throw new QueryError(`Work item id must be an integer, got "${value}".`);
      if (op === "~") throw new QueryError("Operator ~ is not valid for id.");
      return `[System.Id] ${op === "!=" ? "<>" : op} ${n}`;
    }
  }
}

export function compileWiqlWhere(node: QueryNode): string {
  if (node.type === "cmp") return compileCompare(node);
  const joiner = node.type === "and" ? " AND " : " OR ";
  const parts = node.nodes.map((child) =>
    child.type === "cmp" ? compileWiqlWhere(child) : `(${compileWiqlWhere(child)})`,
  );
  return parts.join(joiner);
}

const TERMINAL_STATES = ["Closed", "Done", "Removed", "Resolved", "Completed"];

/**
 * Full WIQL statement. Always scoped to Bug work items in the current
 * project; unless the query itself constrains state, terminal states are
 * excluded (no point re-fixing closed bugs).
 */
export function buildWiql(node: QueryNode): string {
  const clauses = [
    "[System.TeamProject] = @Project",
    "[System.WorkItemType] = 'Bug'",
    `(${compileWiqlWhere(node)})`,
  ];
  if (!queryMentions(node, "state")) {
    clauses.push(
      `[System.State] NOT IN (${TERMINAL_STATES.map((s) => `'${s}'`).join(", ")})`,
    );
  }
  return (
    `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ` +
    "ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC"
  );
}
