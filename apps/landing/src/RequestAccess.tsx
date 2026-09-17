/**
 * The only way in.
 *
 * drymem is not self-serve: a server's sign-up succeeds exactly once, and every
 * organisation after that is provisioned by hand. So this form is not a
 * marketing device with a "we'll be in touch" that means nothing — it is the
 * actual queue, and somebody reads it.
 *
 * Which is why it says so, and why it asks what the team keeps re-explaining:
 * that answer is the one thing that makes a request easy to say yes to.
 */

import { useState } from "react";

const API = import.meta.env.VITE_DRYMEM_API ?? "";

type State = "idle" | "sending" | "sent" | "error";

export function RequestAccess() {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    const form = new FormData(event.currentTarget);
    setState("sending");
    setError("");
    try {
      const response = await fetch(`${API}/access-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          name: form.get("name"),
          company: form.get("company"),
          team_size: form.get("team_size"),
          about: form.get("about"),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          response.status === 429
            ? "That is a lot of requests from one place. Try again later."
            : (body?.detail ?? "That did not go through. Try again, or email us."),
        );
      }
      setState("sent");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <p className="text-lg font-semibold">Thanks — we have it.</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          A person reads these, not a queue. You will hear back at the address you gave, with a
          link to set your password.
        </p>
      </div>
    );
  }

  const field =
    "w-full rounded-lg border bg-card px-3 py-2.5 text-[0.9375rem] outline-none transition placeholder:text-muted-foreground focus:border-foreground";
  const label = "mb-1.5 block text-sm font-medium";

  return (
    <form onSubmit={submit} className="rounded-2xl border bg-card p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">
            Your name
          </label>
          <input className={field} id="name" name="name" maxLength={200} autoComplete="name" />
        </div>
        <div>
          <label className={label} htmlFor="email">
            Work email <span className="text-muted-foreground">(required)</span>
          </label>
          <input
            className={field}
            id="email"
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="email"
          />
        </div>
        <div>
          <label className={label} htmlFor="company">
            Company
          </label>
          <input className={field} id="company" name="company" maxLength={200} />
        </div>
        <div>
          <label className={label} htmlFor="team_size">
            How many engineers
          </label>
          <select className={field} id="team_size" name="team_size" defaultValue="">
            <option value="">—</option>
            <option>Just me</option>
            <option>2–5</option>
            <option>6–20</option>
            <option>21–100</option>
            <option>More than 100</option>
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label className={label} htmlFor="about">
          What does your team keep re-explaining to its agents?
        </label>
        <textarea
          className={`${field} min-h-28 resize-y`}
          id="about"
          name="about"
          maxLength={2000}
          placeholder="The thing you find yourself typing into a fresh session for the third time this week."
        />
      </div>

      {state === "error" && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-6 w-full rounded-lg bg-primary px-5 py-3 text-[0.9375rem] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60 sm:w-auto"
      >
        {state === "sending" ? "Sending…" : "Request a free trial"}
      </button>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        No card, no automated onboarding. We read every request and reply from a real address.
      </p>
    </form>
  );
}
