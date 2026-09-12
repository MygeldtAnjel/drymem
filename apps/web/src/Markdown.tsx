/**
 * Memory bodies and skill drafts are markdown an agent wrote: headings,
 * bullets, fenced code, file paths. Rendered here rather than pulling a library
 * in, because the subset is small, known, and the styling is the point.
 *
 * Everything is escaped before any markup is produced — the content is written
 * by a model summarising a session, which is exactly the sort of text that ends
 * up containing angle brackets.
 *
 * The classes are emitted inline rather than through a global `.prose` rule.
 * A global rule in a separate stylesheet is how this file silently lost every
 * one of its styles once: the stylesheet was replaced and nothing failed, it
 * just rendered as flat text.
 */

/*
 * Quotes matter here, not just angle brackets: the link rule below writes a
 * URL into an href, so an unescaped `"` closes the attribute and lets agent-
 * written text inject its own.
 */
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const CLASS = {
  h2: "mt-6 mb-2 text-base font-semibold first:mt-0",
  h3: "mt-5 mb-1.5 text-sm font-semibold first:mt-0",
  h4: "mt-4 mb-1 text-sm font-medium text-muted-foreground first:mt-0",
  p: "my-2 leading-relaxed first:mt-0 last:mb-0",
  ul: "my-2 ml-5 flex list-disc flex-col gap-1 marker:text-muted-foreground",
  ol: "my-2 ml-5 flex list-decimal flex-col gap-1 marker:text-muted-foreground",
  li: "pl-1 leading-relaxed",
  // `break-words` because a memory is full of long identifiers and URLs, and
  // one of them must never be able to widen the column it sits in.
  code: "rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem] break-words",
  pre: "my-3 overflow-x-auto rounded-lg border bg-muted/40 p-3",
  preCode: "font-mono text-xs whitespace-pre",
  blockquote: "my-3 border-l-2 border-primary/60 pl-3 text-muted-foreground",
  hr: "my-4 border-0 border-t",
  a: "text-primary underline underline-offset-4 hover:no-underline break-words",
} as const;

function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, `<code class="${CLASS.code}">$1</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    // No quotes, no angle brackets, no backslashes in the URL — the escape
    // above already neutralises them, and this keeps anything odd out of href.
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s"'<>\\&]+)\)/g,
      `<a class="${CLASS.a}" href="$2" target="_blank" rel="noopener noreferrer">$1</a>`,
    );
}

/**
 * True when `lines` contains a closing fence after `from`.
 *
 * An unclosed fence is treated as ordinary text rather than swallowing the rest
 * of the document. CommonMark says the opposite, but the input here is written
 * by a model: one stray backtick line turning an entire skill into a single
 * unreadable code block is a far worse failure than a visible ``` in the prose.
 */
function closes(lines: string[], from: number): boolean {
  return lines.slice(from + 1).some((line) => line.trimStart().startsWith("```"));
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let fence: string[] | null = null;
  const flush = (buffer: string[]) =>
    `<pre class="${CLASS.pre}"><code class="${CLASS.preCode}">${escape(buffer.join("\n"))}</code></pre>`;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  /*
   * Consecutive text lines are one paragraph, not one paragraph each.
   *
   * Memory bodies are hard-wrapped at 80 columns, and emitting a `<p>` per line
   * printed them as a ragged column of one-line blocks with a gap between every
   * line — the single thing that made the page look unfinished. A newline
   * inside a paragraph is a soft break in CommonMark, and joining with a space
   * is what a soft break means.
   */
  let para: string[] = [];
  const closePara = () => {
    if (para.length === 0) return;
    out.push(`<p class="${CLASS.p}">${inline(para.join(" "))}</p>`);
    para = [];
  };
  const close = () => {
    closePara();
    closeList();
  };

  lines.forEach((raw, i) => {
    if (raw.trimStart().startsWith("```")) {
      if (fence) {
        out.push(flush(fence));
        fence = null;
        return;
      }
      if (closes(lines, i)) {
        close();
        fence = [];
        return;
      }
      // Falls through and is rendered as the literal text it is.
    }
    if (fence) {
      fence.push(raw);
      return;
    }

    const line = raw.trim();
    if (!line) {
      close();
      return;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      close();
      const level = Math.min(heading[1]!.length + 1, 4);
      const cls = level === 2 ? CLASS.h2 : level === 3 ? CLASS.h3 : CLASS.h4;
      out.push(`<h${level} class="${cls}">${inline(heading[2]!)}</h${level}>`);
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      close();
      out.push(`<hr class="${CLASS.hr}" />`);
      return;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list !== "ul") {
        close();
        out.push(`<ul class="${CLASS.ul}">`);
        list = "ul";
      }
      closePara();
      out.push(`<li class="${CLASS.li}">${inline(bullet[1]!)}</li>`);
      return;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (list !== "ol") {
        close();
        out.push(`<ol class="${CLASS.ol}">`);
        list = "ol";
      }
      closePara();
      out.push(`<li class="${CLASS.li}">${inline(numbered[1]!)}</li>`);
      return;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      close();
      out.push(`<blockquote class="${CLASS.blockquote}">${inline(quote[1]!)}</blockquote>`);
      return;
    }

    closeList();
    para.push(line);
  });

  if (fence !== null) out.push(flush(fence));
  close();

  return (
    // `min-w-0` so a long unbroken token scrolls its own `pre` instead of
    // widening the dialog or the card it lives in.
    <div className="min-w-0 text-sm" dangerouslySetInnerHTML={{ __html: out.join("\n") }} />
  );
}
