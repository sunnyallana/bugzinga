/**
 * Focused HTML → Markdown conversion for tracker rich-text fields (Azure
 * DevOps repro steps / system info / descriptions are stored as HTML).
 * Handles the constructs those editors actually emit; collects embedded
 * image URLs so screenshots can be downloaded alongside the bug.
 */

export interface HtmlConversion {
  markdown: string;
  images: string[];
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

export function htmlToMarkdown(html: string | null | undefined): HtmlConversion {
  if (!html || !html.trim()) return { markdown: "", images: [] };

  const images: string[] = [];
  let s = html.replace(/\r\n?/g, "\n");

  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");

  // Images — capture URLs for download, keep a markdown reference inline.
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = attr(tag, "src");
    if (!src) return "";
    images.push(src);
    const alt = attr(tag, "alt") ?? "screenshot";
    return `\n![${alt}](${src})\n`;
  });

  // Links.
  s = s.replace(
    /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, dq: string | undefined, sq: string | undefined, inner: string) => {
      const href = dq ?? sq ?? "";
      const text = inner.replace(/<[^>]+>/g, "").trim() || href;
      return `[${text}](${href})`;
    },
  );

  // Code blocks before inline formatting so their contents stay verbatim.
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body: string) => {
    const code = decodeEntities(body.replace(/<[^>]+>/g, "")).replace(/^\n+|\n+$/g, "");
    return `\n\`\`\`\n${code}\n\`\`\`\n`;
  });

  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Structure.
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n${"#".repeat(Number(n))} `);
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<\/li>/gi, "");
  s = s.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|table|tr)>/gi, "\n");
  s = s.replace(/<\/t[dh]>/gi, " | ");

  // Strip whatever is left, decode, tidy whitespace.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { markdown: s, images };
}
