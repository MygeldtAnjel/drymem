/**
 * The documentation, which is the repository's own markdown.
 *
 * Imported with `?raw` at build time so the page and the file cannot drift, and
 * so a contributor who fixes a doc has already fixed the site. The titles and
 * the order live here because a folder listing is not a reading order.
 */

import { useEffect, useMemo } from "react";

import gettingStarted from "@docs/ONBOARDING.md?raw";
import operations from "@docs/operations.md?raw";
import skillsFlow from "@docs/skills-flow.md?raw";

import { renderMarkdown } from "@/Markdown";

export interface Doc {
  slug: string;
  title: string;
  blurb: string;
  source: string;
}

export const DOCS: Doc[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    blurb: "Install it, connect a repository, and see the first memory come back.",
    source: gettingStarted,
  },
  {
    slug: "skills",
    title: "How skills reach an agent",
    blurb: "Publishing, review, and why skills are not committed to your repo.",
    source: skillsFlow,
  },
  {
    slug: "running-it",
    title: "Running drymem",
    blurb: "Backups, provisioning an organisation, email, and upgrades.",
    source: operations,
  },
];

export function Docs({ slug }: { slug: string }) {
  const doc = DOCS.find((d) => d.slug === slug) ?? DOCS[0]!;
  const { html, headings } = useMemo(() => renderMarkdown(doc.source), [doc.source]);

  // A hash route and an in-page anchor share one `#`, so the browser cannot
  // scroll to a heading on its own — the route swallows it. Done here instead.
  useEffect(() => {
    const anchor = window.location.hash.split("#")[2];
    if (!anchor) {
      window.scrollTo({ top: 0 });
      return;
    }
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth" });
  }, [slug]);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
      <aside className="mb-10 lg:mb-0">
        <nav className="lg:sticky lg:top-24">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Documentation
          </p>
          <ul className="flex flex-col gap-1 border-l">
            {DOCS.map((d) => (
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
                      className="text-sm text-muted-foreground transition hover:text-foreground"
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
          <a
            className="underline underline-offset-4"
            href="https://github.com/mygeldtanjel/drymem"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open an issue
          </a>{" "}
          — this page is the repository's own markdown, so a fix lands in both.
        </p>
      </article>
    </main>
  );
}
