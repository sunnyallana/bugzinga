import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/util/html-to-md.js";

describe("htmlToMarkdown", () => {
  it("converts typical ADO repro steps", () => {
    const html =
      "<div>1. Open the <b>Dataflow</b> designer<br>2. Drag a &quot;REST source&quot; onto the canvas</div>" +
      "<ul><li>Expected: source added</li><li>Actual: <i>NullReferenceException</i></li></ul>";
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("1. Open the **Dataflow** designer");
    expect(markdown).toContain('2. Drag a "REST source" onto the canvas');
    expect(markdown).toContain("- Expected: source added");
    expect(markdown).toContain("- Actual: *NullReferenceException*");
  });

  it("collects embedded screenshots and keeps a markdown reference", () => {
    const html =
      '<p>See error:</p><img src="https://dev.azure.com/org/proj/_apis/wit/attachments/abc?fileName=err.png" alt="error dialog">';
    const { markdown, images } = htmlToMarkdown(html);
    expect(images).toEqual([
      "https://dev.azure.com/org/proj/_apis/wit/attachments/abc?fileName=err.png",
    ]);
    expect(markdown).toContain("![error dialog](https://dev.azure.com/org/proj/_apis/wit/attachments/abc?fileName=err.png)");
  });

  it("converts links, code, pre blocks, and headings", () => {
    const html =
      '<h2>Stack</h2><pre>at Foo.Bar()\nat Baz.Qux()</pre>' +
      '<p>Caused by <code>config.json</code> — see <a href="https://example.com/kb/1">KB-1</a></p>';
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("## Stack");
    expect(markdown).toContain("```\nat Foo.Bar()\nat Baz.Qux()\n```");
    expect(markdown).toContain("`config.json`");
    expect(markdown).toContain("[KB-1](https://example.com/kb/1)");
  });

  it("decodes entities including numeric ones and squeezes blank lines", () => {
    const { markdown } = htmlToMarkdown("<p>a &amp; b &#8594; c&nbsp;&#x2713;</p><p></p><p></p><p>d</p>");
    expect(markdown).toBe("a & b → c ✓\n\nd");
  });

  it("handles empty/null input", () => {
    expect(htmlToMarkdown(null).markdown).toBe("");
    expect(htmlToMarkdown("  ").images).toEqual([]);
  });

  it("converts simple tables to pipe-separated lines", () => {
    const { markdown } = htmlToMarkdown(
      "<table><tr><td>OS</td><td>Windows 11</td></tr><tr><td>Build</td><td>1.2.3</td></tr></table>",
    );
    expect(markdown).toContain("OS | Windows 11 |");
    expect(markdown).toContain("Build | 1.2.3 |");
  });
});
