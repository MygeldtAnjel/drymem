/**
 * The docs are the repository's own markdown, rendered.
 *
 * Imported from `docs/` at build time rather than copied, so the page a reader
 * sees and the file a contributor edits are the same file. A docs site that
 * keeps its own copy is a docs site that is wrong within a month.
 *
 * Everything is escaped before any markup is produced. These files are ours
 * today, but "it is our own content" is exactly the assumption that makes a
 * renderer unsafe the day it is pointed at something else.
 */

import { DIAGRAMS } from "@/diagrams";

const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const C = {
  h1: "mt-0 mb-4 text-3xl font-semibold tracking-tight",
  h2: "mt-12 mb-3 scroll-mt-24 text-xl font-semibold tracking-tight",
  h3: "mt-8 mb-2 scroll-mt-24 text-base font-semibold",
  h4: "mt-6 mb-2 text-sm font-semibold text-muted-foreground",
  p: "my-4 leading-7 text-[0.9375rem]",
  ul: "my-4 ml-5 flex list-disc flex-col gap-2 marker:text-muted-foreground",
  ol: "my-4 ml-5 flex list-decimal flex-col gap-2 marker:text-muted-foreground",
  li: "pl-1 leading-7 text-[0.9375rem]",
  code: "rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem] break-words",
  pre: "my-5 overflow-x-auto rounded-xl border bg-muted/50 p-4",
  preCode: "font-mono text-[0.8125rem] leading-6 whitespace-pre",
  quote: "my-5 border-l-2 border-brand/60 pl-4 text-muted-foreground",
  hr: "my-10 border-0 border-t",
  a: "font-medium underline underline-offset-4 decoration-border hover:decoration-foreground",
  table: "my-5 w-full border-collapse text-left text-sm",
  th: "border-b px-3 py-2 font-semibold",
  td: "border-b px-3 py-2 align-top text-muted-foreground",
} as const;

/** Heading text with its inline markers removed, for anywhere that is not HTML. */
const plain = (text: string) =>
  text.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");

/** A heading's anchor, so the sidebar can link to it and a URL can be shared. */
export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, `<code class="${C.code}">$1</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-foreground">$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em class="italic">$2</em>')
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_m, label: string, href: string) =>
        // Only http(s) and in-page anchors survive; a `javascript:` URL in a
        // document is the one link that must never become an href.
        /^(https?:\/\/|#|\/)/.test(href)
          ? `<a class="${C.a}" href="${href}"${href.startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`
          : label,
    );
}

/** Headings found on the way through, for the page's own contents list. */
export interface Heading {
  level: 2 | 3;
  text: string;
  id: string;
}

export function renderMarkdown(source: string): { html: string; headings: Heading[] } {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const headings: Heading[] = [];
  let i = 0;

  const paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    out.push(`<p class="${C.p}">${inline(paragraph.join(" "))}</p>`);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code. The language is kept off the page: a label nobody reads,
    // on every block, in a document that is mostly shell. The exception is
    // `diagram:<id>`, which swaps the block's ASCII art for a drawing.
    if (line.startsWith("```")) {
      flush();
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i]!), (i += 1);
      i += 1;
      const drawn = lang.startsWith("diagram:") ? DIAGRAMS[lang.slice(8)] : undefined;
      out.push(
        drawn
          ? `<figure class="my-7 overflow-x-auto rounded-xl border bg-card p-5 sm:p-6">${drawn}</figure>`
          : `<pre class="${C.pre}"><code class="${C.preCode}">${escape(body.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      const id = slug(text);
      // The contents list is text, not markup: a heading written `### \`setup\``
      // renders as code in the body and must not arrive in the sidebar wearing
      // its backticks.
      if (level === 2 || level === 3) headings.push({ level, text: plain(text), id });
      const cls = level === 1 ? C.h1 : level === 2 ? C.h2 : level === 3 ? C.h3 : C.h4;
      out.push(`<h${level} id="${id}" class="${cls}">${inline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push(`<hr class="${C.hr}">`);
      i += 1;
      continue;
    }

    // Tables: a header row, a divider, then body rows.
    if (line.includes("|") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? "")) {
      flush();
      const cells = (row: string) =>
        row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|")) body.push(cells(lines[i]!)), (i += 1);
      out.push(
        `<div class="overflow-x-auto"><table class="${C.table}"><thead><tr>${head
          .map((c) => `<th class="${C.th}">${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .map(
            (row) =>
              `<tr>${row.map((c) => `<td class="${C.td}">${inline(c)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? /^\s*\d+\.\s+(.*)$/.exec(lines[i]!) : /^\s*[-*]\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        const parts = [m[1]!];
        i += 1;
        // A wrapped continuation line belongs to the item above it.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*[-*\d]/.test(lines[i]!)) {
          parts.push(lines[i]!.trim());
          i += 1;
        }
        items.push(`<li class="${C.li}">${inline(parts.join(" "))}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"} class="${ordered ? C.ol : C.ul}">${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    if (line.startsWith(">")) {
      flush();
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) {
        body.push(lines[i]!.replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote class="${C.quote}">${inline(body.join(" "))}</blockquote>`);
      continue;
    }

    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }
  flush();
  return { html: out.join("\n"), headings };
}
