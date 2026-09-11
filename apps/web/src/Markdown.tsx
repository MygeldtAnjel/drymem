/**
 * Memory bodies are markdown an agent wrote: headings, bullets, fenced code,
 * file paths. Rendered here rather than pulling a library in, because the
 * subset is small, known, and the styling is the point.
 *
 * Everything is escaped before any markup is produced — the content is written
 * by an agent summarising a session, which is exactly the sort of text that
 * ends up containing angle brackets.
 */

/*
 * Quotes matter here, not just angle brackets: the link rule below writes a
 * URL into an href, so an unescaped `"` closes the attribute and lets agent-
 * written text inject its own. The content is a summary of a session, which is
 * exactly the text most likely to contain both.
 */
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    // No quotes, no angle brackets, no backslashes in the URL — the escape above
    // already neutralises them, and this keeps anything odd out of the href.
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s"'<>\\&]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let fence: string[] | null = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    if (raw.trimStart().startsWith("```")) {
      if (fence) {
        out.push(`<pre><code>${escape(fence.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        closeList();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(raw);
      continue;
    }

    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(heading[1]!.length + 1, 6);
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    if (line === "---") {
      closeList();
      out.push("<hr />");
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(numbered[1]!)}</li>`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1]!)}</blockquote>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  if (fence) out.push(`<pre><code>${escape(fence.join("\n"))}</code></pre>`);
  closeList();

  return <div className="prose" dangerouslySetInnerHTML={{ __html: out.join("\n") }} />;
}
