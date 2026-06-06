import { QueryError } from "../util/errors.js";
import {
  cmp,
  logical,
  QUERY_FIELDS,
  type CompareOp,
  type QueryField,
  type QueryNode,
} from "./ast.js";

/**
 * Recursive-descent parser for the bug query DSL.
 *
 *   query   := orExpr
 *   orExpr  := andExpr (OR andExpr)*
 *   andExpr := primary (AND primary)*
 *   primary := '(' query ')' | FIELD OP VALUE
 *   OP      := = != < <= > >= ~
 *   VALUE   := "quoted" | 'quoted' | bare-word
 *
 * Examples:
 *   priority=2 AND severity=2 AND assignee=me
 *   (priority<=2 OR severity=1) AND state=Active AND tag=regression
 */

const FIELD_ALIASES: Record<string, QueryField> = {
  priority: "priority",
  pri: "priority",
  p: "priority",
  severity: "severity",
  sev: "severity",
  assignee: "assignee",
  assigned: "assignee",
  assignedto: "assignee",
  "assigned-to": "assignee",
  state: "state",
  status: "state",
  tag: "tag",
  tags: "tag",
  label: "tag",
  title: "title",
  area: "area",
  areapath: "area",
  iteration: "iteration",
  sprint: "iteration",
  id: "id",
};

interface Token {
  kind: "ident" | "op" | "value" | "lparen" | "rparen" | "and" | "or";
  text: string;
  pos: number;
}

const OPS: CompareOp[] = ["!=", "<=", ">=", "=", "<", ">", "~"];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen", text: "(", pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", text: ")", pos: i });
      i++;
      continue;
    }
    const op = OPS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ kind: "op", text: op, pos: i });
      i++;
      if (op.length === 2) i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const end = input.indexOf(quote, i + 1);
      if (end === -1) {
        throw queryErrorAt(input, i, `unterminated ${quote}quoted${quote} string`);
      }
      tokens.push({ kind: "value", text: input.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    const match = input.slice(i).match(/^[^\s()=!<>~]+/);
    if (!match) {
      throw queryErrorAt(input, i, `unexpected character "${ch}"`);
    }
    const word = match[0];
    const lower = word.toLowerCase();
    if (lower === "and" || lower === "&&") {
      tokens.push({ kind: "and", text: word, pos: i });
    } else if (lower === "or" || lower === "||") {
      tokens.push({ kind: "or", text: word, pos: i });
    } else {
      tokens.push({ kind: "ident", text: word, pos: i });
    }
    i += word.length;
  }
  return tokens;
}

function queryErrorAt(input: string, pos: number, message: string): QueryError {
  const pointer = `${" ".repeat(pos)}^`;
  return new QueryError(`Query error at position ${pos}: ${message}\n  ${input}\n  ${pointer}`);
}

class Parser {
  private index = 0;

  constructor(
    private readonly input: string,
    private readonly tokens: Token[],
  ) {}

  parse(): QueryNode {
    const node = this.parseOr();
    const extra = this.peek();
    if (extra) {
      throw queryErrorAt(this.input, extra.pos, `unexpected "${extra.text}"`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token | undefined {
    return this.tokens[this.index++];
  }

  private parseOr(): QueryNode {
    const nodes = [this.parseAnd()];
    while (this.peek()?.kind === "or") {
      this.next();
      nodes.push(this.parseAnd());
    }
    return logical("or", nodes);
  }

  private parseAnd(): QueryNode {
    const nodes = [this.parsePrimary()];
    while (this.peek()?.kind === "and") {
      this.next();
      nodes.push(this.parsePrimary());
    }
    return logical("and", nodes);
  }

  private parsePrimary(): QueryNode {
    const token = this.peek();
    if (!token) {
      throw queryErrorAt(this.input, this.input.length, "expected a condition");
    }
    if (token.kind === "lparen") {
      this.next();
      const inner = this.parseOr();
      const close = this.next();
      if (!close || close.kind !== "rparen") {
        throw queryErrorAt(this.input, close?.pos ?? this.input.length, 'expected ")"');
      }
      return inner;
    }
    return this.parseComparison();
  }

  private parseComparison(): QueryNode {
    const fieldToken = this.next();
    if (!fieldToken || fieldToken.kind !== "ident") {
      throw queryErrorAt(
        this.input,
        fieldToken?.pos ?? this.input.length,
        `expected a field name (one of: ${QUERY_FIELDS.join(", ")})`,
      );
    }
    const field = FIELD_ALIASES[fieldToken.text.toLowerCase()];
    if (!field) {
      throw queryErrorAt(
        this.input,
        fieldToken.pos,
        `unknown field "${fieldToken.text}" (expected one of: ${QUERY_FIELDS.join(", ")})`,
      );
    }
    const opToken = this.next();
    if (!opToken || opToken.kind !== "op") {
      throw queryErrorAt(
        this.input,
        opToken?.pos ?? this.input.length,
        `expected an operator (=, !=, <, <=, >, >=, ~) after "${fieldToken.text}"`,
      );
    }
    const valueToken = this.next();
    if (!valueToken || (valueToken.kind !== "ident" && valueToken.kind !== "value")) {
      throw queryErrorAt(
        this.input,
        valueToken?.pos ?? this.input.length,
        `expected a value after "${fieldToken.text}${opToken.text}"`,
      );
    }
    return cmp(field, opToken.text as CompareOp, valueToken.text);
  }
}

export function parseQuery(input: string): QueryNode {
  const trimmed = input.trim();
  if (!trimmed) throw new QueryError("Query is empty.");
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new QueryError("Query is empty.");
  return new Parser(trimmed, tokens).parse();
}
