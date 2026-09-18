/**
 * Two pages and a hash, which is all a static site needs.
 *
 * No router dependency: the whole site is a home page and a handful of
 * documents, and `#/docs/<slug>` is legible in a URL bar and survives being
 * dropped on any static host without server-side rewrites.
 */

import { useEffect, useState } from "react";

import { Docs } from "@/Docs";
import { Moon, Sun } from "@/Icons";
import { Footer, Home } from "@/Home";
import { Mark } from "@/Mark";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

/**
 * The reader's own setting, remembered.
 *
 * Defaults to whatever the operating system says rather than to the design's
 * preference — somebody reading at night did not ask for a white page.
 */
function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("drymem-theme");
      if (saved) return saved === "dark";
    } catch {
      // Private windows throw rather than return null. The default is fine.
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("drymem-theme", dark ? "dark" : "light");
    } catch {
      // Not remembering a preference is survivable; crashing over it is not.
    }
  }, [dark]);

  return [dark, () => setDark((d) => !d)];
}

export function App() {
  const hash = useHashRoute();
  const [dark, toggleTheme] = useTheme();
  const docs = /^#\/docs\/?([a-z-]*)(?:#(.*))?$/.exec(hash);

  // An in-page anchor arriving in the URL — someone opening a shared
  // `…/#request` — is scrolled to here. The browser tries it on load and gives
  // up, because at that moment React has not painted the section yet.
  useEffect(() => {
    if (docs) return;
    const id = hash.replace(/^#/, "");
    if (!id) return;
    const target = document.getElementById(id);
    // Instant, not smooth: arriving on a shared link should land on the section,
    // not animate the reader past three thousand pixels of a page they did not
    // ask for. Clicking an anchor still glides, through CSS scroll-behavior.
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: "instant" }));
  }, [hash, docs]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
          <a href="#/" className="flex items-center gap-2.5">
            <Mark className="size-7 text-foreground" />
            <span className="text-[0.9375rem] font-semibold tracking-tight">drymem</span>
          </a>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="#/docs/getting-started"
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Docs
            </a>
            <a
              href="https://github.com/mygeldtanjel/drymem"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground sm:block"
            >
              GitHub
            </a>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
              title={dark ? "Switch to light theme" : "Switch to dark theme"}
              className="grid size-9 place-items-center rounded-lg border text-muted-foreground transition hover:border-foreground hover:text-foreground"
            >
              {dark ? <Sun /> : <Moon />}
            </button>
            <a
              href="#/docs/self-hosting"
              className="ml-1 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Install
            </a>
          </nav>
        </div>
      </header>

      <div className="flex-1">
        {docs ? <Docs slug={docs[1] || "getting-started"} anchor={docs[2] ?? ""} /> : <Home />}
      </div>

      <Footer />
    </div>
  );
}
