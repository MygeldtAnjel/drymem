/**
 * Light, dark, or whatever the machine is set to.
 *
 * Three states rather than two. "System" is the honest default — someone who
 * has told their OS they want dark at night has already answered this question,
 * and making them answer it again per app is the thing that annoys people.
 *
 * The class goes on `<html>` so the first paint is right. `applyTheme` is
 * called once from a script before React mounts; doing it in an effect gives a
 * white flash on every load for the people who least want one.
 */

export type Theme = "light" | "dark" | "system";

const KEY = "drymem.theme";

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private windows and blocked storage both throw. The default is fine.
  }
  return "system";
}

/**
 * `globalThis`, not `window`.
 *
 * They are the same object in a browser, and `window` is a ReferenceError
 * everywhere else — a test runner, a worker, a prerender. Reaching for the one
 * that always exists costs nothing.
 */
const media = (query: string): MediaQueryList | null =>
  typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(query) : null;

const DARK = "(prefers-color-scheme: dark)";

/** What the theme resolves to right now, once "system" has been asked. */
export function resolve(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return media(DARK)?.matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", resolve(theme) === "dark");
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not being able to remember it is not a reason to refuse to apply it.
  }
  applyTheme(theme);
}

/**
 * Follow the machine while the choice is "system".
 *
 * Returns the unsubscribe, and does nothing at all for an explicit choice —
 * someone who picked light does not want their laptop overriding them at dusk.
 */
export function watchSystem(theme: Theme, onChange: () => void): () => void {
  const query = theme === "system" ? media(DARK) : null;
  if (!query) return () => {};
  const handler = () => {
    applyTheme("system");
    onChange();
  };
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}
