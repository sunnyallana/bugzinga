import { describe, expect, it } from "vitest";
import { parseQuery } from "../src/query/parser.js";
import { buildWiql, compileWiqlWhere } from "../src/query/wiql.js";
import { QueryError } from "../src/util/errors.js";

describe("WIQL compiler", () => {
  it("compiles the canonical query", () => {
    const where = compileWiqlWhere(parseQuery("priority=2 AND severity=2 AND assignee=me"));
    expect(where).toBe(
      "[Microsoft.VSTS.Common.Priority] = 2 AND [Microsoft.VSTS.Common.Severity] = '2 - High' AND [System.AssignedTo] = @Me",
    );
  });

  it("maps severity names and numeric ranges", () => {
    expect(compileWiqlWhere(parseQuery("severity=critical"))).toBe(
      "[Microsoft.VSTS.Common.Severity] = '1 - Critical'",
    );
    expect(compileWiqlWhere(parseQuery("severity<=2"))).toBe(
      "[Microsoft.VSTS.Common.Severity] IN ('1 - Critical', '2 - High')",
    );
    expect(() => compileWiqlWhere(parseQuery("severity>4"))).toThrowError(QueryError);
  });

  it("compiles OR groups with parentheses", () => {
    const where = compileWiqlWhere(parseQuery("(priority=1 OR priority=2) AND state=Active"));
    expect(where).toBe(
      "([Microsoft.VSTS.Common.Priority] = 1 OR [Microsoft.VSTS.Common.Priority] = 2) AND [System.State] = 'Active'",
    );
  });

  it("compiles tags, title contains, area UNDER, and escapes quotes", () => {
    expect(compileWiqlWhere(parseQuery("tag=regression"))).toBe(
      "[System.Tags] CONTAINS 'regression'",
    );
    expect(compileWiqlWhere(parseQuery('title~"can\'t save"'))).toBe(
      "[System.Title] CONTAINS 'can''t save'",
    );
    expect(compileWiqlWhere(parseQuery('area="App\\Web"'))).toBe(
      "[System.AreaPath] UNDER 'App\\Web'",
    );
  });

  it("builds a full statement scoped to Bug work items, excluding terminal states", () => {
    const wiql = buildWiql(parseQuery("priority=2"));
    expect(wiql).toContain("SELECT [System.Id] FROM WorkItems");
    expect(wiql).toContain("[System.TeamProject] = @Project");
    expect(wiql).toContain("[System.WorkItemType] = 'Bug'");
    expect(wiql).toContain("[System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved', 'Completed')");
    expect(wiql).toContain("ORDER BY [Microsoft.VSTS.Common.Priority] ASC");
  });

  it("omits the default state filter when the query constrains state", () => {
    const wiql = buildWiql(parseQuery("priority=2 AND state=Resolved"));
    expect(wiql).not.toContain("NOT IN");
    expect(wiql).toContain("[System.State] = 'Resolved'");
  });
});
