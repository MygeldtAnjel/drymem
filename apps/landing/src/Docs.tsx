/**
 * The documentation, written for the people who use drymem.
 *
 * These used to be the repository's own markdown, imported with `?raw` so the
 * page and the file could not drift. That was the wrong trade. `docs/` is an
 * engineering record: it argues with itself, cites decision numbers, and says
 * things like "we tried it and it was wrong for four reasons" — which is
 * exactly right in a repository and reads, on a public page, like publishing
 * an internal thread. Nobody evaluating a product wants our changes of mind.
 *
 * So the site has its own pages, written as documentation, and `docs/` stays
 * what it is. Where they overlap, this is the one a customer reads.
 */

import { useEffect, useMemo, useRef } from "react";

import cli from "@content/cli.md?raw";
import console_ from "@content/console.md?raw";
import gettingStarted from "@content/getting-started.md?raw";
import selfHosting from "@content/self-hosting.md?raw";
import skills from "@content/skills.md?raw";

import { renderMarkdown } from "@/Markdown";

export interface Doc {
  slug: string;
  title: string;
  blurb: string;
  source: string;
  /** The sidebar heading this sits under. */
  group: string;
}

export const DOCS: Doc[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    blurb: "Connect a repository and see the first memory come back.",
    source: gettingStarted,
    group: "Start here",
  },
  {
    slug: "console",
    title: "The console",
    blurb: "Every screen in the web console, and what it is for.",
    source: console_,
    group: "Start here",
  },
  {
    slug: "skills",
    title: "Skills",
    blurb: "Where they come from, how they reach a machine, and what is checked first.",
    source: skills,
    group: "Start here",
  },
  {
    slug: "cli",
    title: "Command reference",
    blurb: "Every command, what it does, and when you would reach for it.",
    source: cli,
    group: "Reference",
  },
  {
    slug: "self-hosting",
    title: "Self-hosting",
    blurb: "Running drymem on your own hardware: backups, email, upgrades.",
    source: selfHosting,
    group: "Reference",
  },
];

/** The sidebar's own order, which a flat list stops carrying past three pages. */
const GROUPS = [...new Set(DOCS.map((d) => d.group))];

export function Docs({ slug, anchor }: { slug: string; anchor: string }) {
  const doc = DOCS.find((d) => d.slug === slug) ?? DOCS[0]!;
  const { html, headings } = useMemo(() => renderMarkdown(doc.source), [doc.source]);

  /*
   * A hash route and an in-page anchor share one `#`, so the browser cannot
   * scroll to a heading on its own — the route swallows the whole fragment.
   *
   * `anchor` is a dependency, not just `slug`: clicking a second heading in the
   * same document leaves the slug alone, so an effect keyed on the slug runs
   * once and then never again. That is why every link under "On this page"
   * worked exactly one time, and only for the first one clicked.
   */
  const landed = useRef(false);
  useEffect(() => {
    // Arriving on a link jumps; clicking one here glides. The same call with
    // `smooth` on first load scrolls from the top of a document that is still
    // being laid out, and frequently arrives nowhere.
    const behavior = landed.current ? "smooth" : "instant";
    landed.current = true;

    if (!anchor) {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    // The heading is in a document that has just re-rendered; wait for paint.
    const frame = requestAnimationFrame(() =>
      document.getElementById(anchor)?.scrollIntoView({ behavior, block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [slug, anchor]);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
      <aside className="mb-10 lg:mb-0">
        <nav className="lg:sticky lg:top-24">
          {GROUPS.map((group) => (
            <div key={group} className="mb-6">
              <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group}
              </p>
              <ul className="flex flex-col gap-1 border-l">
                {DOCS.filter((d) => d.group === group).map((d) => (
                  <li key={d.slug}>
                    <a
                      href={`#/docs/${d.slug}`}
                      aria-current={d.slug === doc.slug ? "page" : undefined}
                      className={`-ml-px block border-l-2 py-1.5 pl-4 text-sm transition ${
                        d.slug === doc.slug
                          ? "border-foreground font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {headings.length > 1 && (
            <>
              <p className="mt-8 mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                On this page
              </p>
              <ul className="flex flex-col gap-1.5">
                {headings.map((h) => (
                  <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
                    <a
                      href={`#/docs/${doc.slug}#${h.id}`}
                      aria-current={h.id === anchor ? "location" : undefined}
                      className={`text-sm transition ${
                        h.id === anchor
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>
      </aside>

      <article className="min-w-0">
        <p className="mb-6 text-sm text-muted-foreground">{doc.blurb}</p>
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <hr className="mt-14 border-0 border-t" />
        <p className="mt-6 text-sm text-muted-foreground">
          Something wrong or missing here?{" "}
          <a className="underline underline-offset-4" href="#/#request">
            Tell us
          </a>{" "}
          — a page that does not answer the question you arrived with is a bug.
        </p>
      </article>
    </main>
  );
}
