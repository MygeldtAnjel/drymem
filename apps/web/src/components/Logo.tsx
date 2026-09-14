/**
 * The mark: a black cat.
 *
 * Drawn rather than fetched, so it needs no request, scales to any size and
 * inherits the surface it sits on. The head is a single filled path; the eyes
 * are the only lit thing in it, in the same amber the product uses for its one
 * accent — the light in the console is the cat looking back at you.
 */

import { cn } from "@/lib/utils";

export function CatMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} role="img" aria-label="drymem">
      <title>drymem</title>
      <path
        d="M6.4 3.4 L11.3 11.4 C13.5 10.2 18.5 10.2 20.7 11.4 L25.6 3.4 L26.6 13.9
           C28.8 16.6 28.8 21.4 26.1 24.5 C23.4 27.7 19.7 29.3 16 29.3
           C12.3 29.3 8.6 27.7 5.9 24.5 C3.2 21.4 3.2 16.6 5.4 13.9 Z"
        fill="currentColor"
      />
      {/* Almond eyes, the one lit thing in the mark. */}
      <path
        d="M11.6 16.6 C12.9 16.6 13.8 17.8 13.8 19 C13.8 20.2 12.9 21.2 11.6 21.2
           C10.3 21.2 9.4 20.2 9.4 19 C9.4 17.8 10.3 16.6 11.6 16.6 Z
           M20.4 16.6 C21.7 16.6 22.6 17.8 22.6 19 C22.6 20.2 21.7 21.2 20.4 21.2
           C19.1 21.2 18.2 20.2 18.2 19 C18.2 17.8 19.1 16.6 20.4 16.6 Z"
        fill="var(--primary)"
      />
      {/* Slit pupils. Without them the eyes read as an owl's. */}
      <path
        d="M11.6 17.4 C12 17.4 12.3 18.1 12.3 19 C12.3 19.9 12 20.5 11.6 20.5
           C11.2 20.5 10.9 19.9 10.9 19 C10.9 18.1 11.2 17.4 11.6 17.4 Z
           M20.4 17.4 C20.8 17.4 21.1 18.1 21.1 19 C21.1 19.9 20.8 20.5 20.4 20.5
           C20 20.5 19.7 19.9 19.7 19 C19.7 18.1 20 17.4 20.4 17.4 Z"
        fill="var(--background)"
      />
      {/* Nose and whisker-line: enough face to read at 20px, no more. */}
      <path d="M16 22.6 L14.7 24.3 H17.3 Z" fill="var(--primary)" opacity="0.5" />
    </svg>
  );
}

/** The mark plus the word, for the sidebar and the sign-in plate. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <CatMark className="size-7 text-foreground" />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">drymem</span>
    </span>
  );
}

/**
 * GitHub's mark.
 *
 * Drawn here because lucide dropped brand icons, and the alternative — a
 * package for one path — is a dependency to audit forever. `currentColor` so it
 * follows the button it sits in, in either theme.
 */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={className ?? "size-4"}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
