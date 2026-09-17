/**
 * The page somebody reads once, deciding whether to care.
 *
 * It opens on the problem rather than the product, because everyone who would
 * pay for this has already lived it: the agent that suggests the thing the team
 * ruled out in March, the third explanation of why the payment retry is where
 * it is. Naming that is the whole pitch; the feature list is only proof.
 */

import { Mark } from "@/Mark";
import { RequestAccess } from "@/RequestAccess";

const GITHUB = "https://github.com/mygeldtanjel/drymem";

/**
 * The console, in a window.
 *
 * A real screenshot of the real product, in the reader's own theme — two files
 * swapped by CSS rather than one that is wrong half the time. They come from a
 * seeded demo organisation, never from anybody's actual memories: a customer's
 * decisions are exactly the thing this product promises not to publish.
 */
function Screens() {
  return (
    <figure className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center gap-2 border-b bg-muted/60 px-4 py-3">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="ml-3 truncate rounded-md bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground">
          drymem.your-company.com
        </span>
      </div>
      <img
        src="/shots/memories-light.png"
        alt="The drymem console listing a project's memories, each with its kind, author and whether it is shared."
        width={2880}
        height={1800}
        className="block w-full dark:hidden"
      />
      <img
        src="/shots/memories-dark.png"
        alt=""
        width={2880}
        height={1800}
        className="hidden w-full dark:block"
      />
    </figure>
  );
}

function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mx-auto w-full max-w-5xl px-5 sm:px-8 ${className}`}>
      {children}
    </section>
  );
}

const STEPS = [
  {
    title: "Your agent writes down what it worked out",
    body: "At the end of a session it saves the decision, the bug it chased, the convention it found — in its own words, without being asked. One command installs the hooks that do it.",
  },
  {
    title: "The next session starts already knowing",
    body: "Whoever opens the project next — you, or somebody on the other side of the team — gets the relevant memories injected before they type anything.",
  },
  {
    title: "What you keep re-explaining becomes a skill",
    body: "drymem notices the subjects that come up again and again with nothing written for them, and drafts a skill from your own memory. You approve it; every agent on the project installs it.",
  },
];

const FACTS = [
  {
    title: "Private by default",
    body: "What you save is yours until you share it. Sharing copies it into the team's memory and says who vouched for it, and when.",
  },
  {
    title: "It runs on your model",
    body: "Point it at an Ollama on your own hardware. No transcript, no memory and no source ever reaches a third party.",
  },
  {
    title: "Secrets never land",
    body: "Everything passes a scrubber before it is stored. A pasted key is redacted; a private key fails the save loudly and is recorded.",
  },
  {
    title: "Answers you can check",
    body: "Ask a question and every claim points at the memory it came from, with the person who wrote it. Nothing matches, nothing is invented.",
  },
  {
    title: "Works where you already are",
    body: "Claude Code through hooks and MCP, plus a console for reading, searching and deciding what the team shares.",
  },
  {
    title: "Yours to run",
    body: "One docker compose on your own box. Postgres and a knowledge graph, the API the only published port.",
  },
];

/**
 * The questions a buyer actually asks, answered without hedging.
 *
 * Every one of these came up in a real conversation about the product, and the
 * two that are refusals — no self-serve, no hosted model — are here precisely
 * because finding them out on the pricing page after signing up is worse.
 */
const FAQ = [
  {
    q: "Does my code leave the building?",
    a: "No. drymem stores what your agent writes down about the work — decisions, bugfixes, conventions — not the repository. It runs on your own hardware and talks to a model you point it at, usually an Ollama on the same network. Nothing is sent to us.",
  },
  {
    q: "What if somebody pastes a secret into a memory?",
    a: "Everything passes a scrubber before it is stored. Keys and tokens are redacted and the redaction is recorded; a private key block fails the save loudly, because a leaked key needs a human to know about it rather than a quiet substitution.",
  },
  {
    q: "Which agents does it work with?",
    a: "Claude Code today, through session hooks and an MCP server — that is where automatic capture and context injection actually work. The client is a thin HTTP shim, so anything that speaks MCP can read and write the same memory.",
  },
  {
    q: "Is everything I save visible to my team?",
    a: "No. Every memory starts private to whoever wrote it. Sharing is a deliberate act that copies it into the team's memory and records who vouched for it and when. Nothing is shared by default.",
  },
  {
    q: "Can I self-host it?",
    a: "That is the only way it runs today: one docker compose, Postgres and a knowledge graph, with the API as the sole published port. A trial gets you the images, the docs and a hand with the first setup.",
  },
  {
    q: "Why can I not just sign up?",
    a: "Because a memory product is worthless until it has a week of memory in it, and the first week is where that goes wrong. Every organisation is opened by hand so somebody watches yours land. It also means we answer your email.",
  },
];

export function Home() {
  return (
    <main className="pb-24">
      {/* ---- hero ------------------------------------------------------------- */}
      <Section className="pt-16 pb-14 sm:pt-28 sm:pb-20">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-brand" />
          Free trial, by request
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-[3.25rem] sm:leading-[1.08]">
          Your coding agents keep re-learning what your team already decided.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
          drymem gives a team one memory their agents read and write — decisions, bugfixes,
          conventions — so the next session starts where the last one finished. And when something
          keeps coming up, it turns into a skill every agent installs.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="#request"
            className="rounded-lg bg-primary px-5 py-3 text-[0.9375rem] font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Request a free trial
          </a>
          <a
            href="#/docs/getting-started"
            className="rounded-lg border bg-card px-5 py-3 text-[0.9375rem] font-medium transition hover:border-foreground"
          >
            Read the docs
          </a>
        </div>
      </Section>

      {/* ---- the product, before any more words ------------------------------- */}
      <Section className="pb-14">
        <Screens />
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          Everything the team's agents have written down, with who wrote it and whether it is
          theirs alone or the team's.
        </p>
      </Section>

      {/* ---- the problem, concretely ------------------------------------------ */}
      <Section className="py-14">
        <div className="rounded-2xl border bg-card p-7 sm:p-10">
          <p className="text-lg leading-8 sm:text-xl sm:leading-9">
            “We settled this in March.” Your agent doesn't know that. It reads the code, not the
            argument behind it — so it proposes the thing you ruled out, and somebody explains the
            reasoning for the fourth time.
          </p>
          <p className="mt-5 text-[0.9375rem] leading-7 text-muted-foreground">
            The reasoning isn't written down anywhere an agent can reach. It is in a thread, a
            call, and three people's heads. drymem is the place it goes instead.
          </p>
        </div>
      </Section>

      {/* ---- how it works ----------------------------------------------------- */}
      <Section id="how" className="py-14">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <div className="mb-3 font-mono text-sm text-brand">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="text-base font-semibold">{step.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-7 text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 overflow-x-auto rounded-2xl border bg-muted/40 p-5 sm:p-6">
          <p className="mb-3 text-sm font-medium">Setting it up, in full:</p>
          <pre className="font-mono text-[0.8125rem] leading-6">
            <code>{`cd ~/your-project\nnpx drymem@latest setup`}</code>
          </pre>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Signs this machine in through your browser, installs the session hooks and the MCP
            server, and pulls the skills the project uses. Once per repository.
          </p>
        </div>
      </Section>

      {/* ---- what you get ----------------------------------------------------- */}
      <Section id="what" className="py-14">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          What that buys you
        </h2>
        <div className="mt-10 grid gap-x-10 gap-y-9 sm:grid-cols-2">
          {FACTS.map((fact) => (
            <div key={fact.title}>
              <h3 className="text-base font-semibold">{fact.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-7 text-muted-foreground">{fact.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ---- questions --------------------------------------------------------- */}
      <Section id="faq" className="py-14">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Questions we get asked
        </h2>
        <dl className="mt-10 grid gap-x-12 gap-y-9 sm:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="text-base font-semibold">{item.q}</dt>
              <dd className="mt-2 text-[0.9375rem] leading-7 text-muted-foreground">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* ---- request ---------------------------------------------------------- */}
      <Section id="request" className="scroll-mt-24 py-14">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ask for a free trial
          </h2>
          <p className="mt-4 text-[0.9375rem] leading-7 text-muted-foreground">
            There is no self-serve signup yet, on purpose: every organisation is set up by hand so
            we can watch the first week go well. Tell us what you are trying to fix and we will
            open one.
          </p>
        </div>
        <div className="max-w-2xl">
          <RequestAccess />
        </div>
      </Section>
    </main>
  );
}

export function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-2.5">
          <Mark className="size-6 text-foreground" />
          <span className="text-sm font-semibold tracking-tight">drymem</span>
          <span className="text-sm text-muted-foreground">
            · shared memory and skills for coding agents
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
          <a className="hover:text-foreground" href="#/docs/getting-started">
            Docs
          </a>
          <a className="hover:text-foreground" href={GITHUB} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a className="hover:text-foreground" href="#request">
            Request access
          </a>
        </nav>
      </div>
    </footer>
  );
}
