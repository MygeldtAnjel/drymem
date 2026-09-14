/**
 * Reading a SKILL.md's header.
 *
 * Its own module because it is pure text and nothing else: `seed.ts` opens a
 * database connection the moment it is imported, and a function that parses a
 * string should not need Postgres to be up in order to be tested.
 */

/**
 * The `description:` line, which is the one line a person reads in the
 * catalogue before installing something on everyone's laptop.
 *
 * YAML quotes a value containing a colon, and a skill description almost always
 * has one — so the quotes and their escapes have to come off, or every card
 * starts with a stray `"` and prints `\"review since X\"` mid-sentence.
 */
export function descriptionOf(content: string): string {
  const close = content.indexOf("\n---", 4);
  const head = content.startsWith("---") && close > 0 ? content.slice(4, close) : "";
  const raw = (/^description\s*:\s*(.+)$/m.exec(head)?.[1] ?? "").trim();

  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.endsWith(quote) && raw.length > 1) {
    const inner = raw.slice(1, -1);
    return (quote === '"' ? inner.replace(/\\(["\\])/g, "$1") : inner.replace(/''/g, "'"))
      .trim()
      .slice(0, 2000);
  }
  return raw.slice(0, 2000);
}
