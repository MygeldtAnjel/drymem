/**
 * Write every email to disk, so they can be looked at before they are sent.
 *
 *   pnpm --filter @drymem/api run email:preview [outDir]
 *   RESEND_API_KEY=… pnpm --filter @drymem/api run email:preview -- --send you@example.com
 *
 * An email is the one screen in the product with no dev server, no hot reload
 * and no way back once it has gone out. This renders each one with plausible
 * content — a long org name, a project key, a real user agent — and writes the
 * HTML and the plain-text half side by side.
 *
 * A browser is not an inbox, though: Gmail rewrites the markup, Outlook lays it
 * out with Word, and a phone is the only place the narrow layout is real. With
 * `--send` every letter goes to one address, subject-tagged, so the last check
 * happens where people actually read them.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Rendering an email needs no secrets, but it imports the module that validates
// them. Standing one in satisfies the check without pretending to configure a
// server — nothing here opens a socket.
process.env.SERVICE_SECRET ??= "email-preview-not-a-real-secret";

const { inviteLetter, passwordChangedLetter, resetLetter, welcomeLetter } = await import(
  "../src/lib/email.js"
);
type Letter = Awaited<ReturnType<typeof resetLetter>>;

const argv = process.argv.slice(2);
const sendTo = argv.includes("--send") ? argv[argv.indexOf("--send") + 1] : undefined;
const out = resolve(argv.find((a) => !a.startsWith("--") && a !== sendTo) ?? "email-preview");
const base = "https://drymem.example.com/#";

const letters: Array<[string, Letter]> = [
  [
    "welcome-owner",
    welcomeLetter({
      to: "miguel@ciudadela.example",
      orgName: "Ciudadela & Co",
      appUrl: `${base}/`,
      owner: true,
    }),
  ],
  [
    "welcome-member",
    welcomeLetter({
      to: "jose@acme.test",
      orgName: "Ciudadela & Co",
      appUrl: `${base}/`,
      owner: false,
    }),
  ],
  [
    "invite",
    inviteLetter({
      to: "jose@acme.test",
      orgName: "Ciudadela & Co",
      invitedBy: "Miguel Rojas",
      projectKey: "github.com/ciudadela/payments-api",
      role: "member",
      days: 7,
      url: `${base}/invite/4f3c8a1e9b7d2065f1a84c3e7b90d5a2`,
    }),
  ],
  [
    "invite-admin-no-project",
    inviteLetter({
      to: "ops@acme.test",
      orgName: "Acme",
      invitedBy: null,
      projectKey: null,
      role: "admin",
      days: 7,
      url: `${base}/invite/0a1b2c3d4e5f60718293a4b5c6d7e8f9`,
    }),
  ],
  [
    "reset",
    resetLetter({
      to: "miguel@ciudadela.example",
      url: `${base}/reset/8d2f0b6a4c1e9375f8a2b0c4d6e1f739`,
      minutes: 60,
    }),
  ],
  [
    "password-changed",
    passwordChangedLetter({
      to: "miguel@ciudadela.example",
      at: new Date("2026-09-17T14:32:00Z"),
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
      resetUrl: `${base}/forgot`,
    }),
  ],
];

mkdirSync(out, { recursive: true });
for (const [name, letter] of letters) {
  writeFileSync(join(out, `${name}.html`), letter.html);
  writeFileSync(join(out, `${name}.txt`), `Subject: ${letter.subject}\n\n${letter.text}`);
  console.log(`${name}  ${letter.subject}`);
}
console.log(`\n${letters.length} written to ${out}`);

if (sendTo) {
  if (!process.env.RESEND_API_KEY) {
    console.error("\n--send needs RESEND_API_KEY in the environment.");
    process.exit(1);
  }
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM ?? "drymem <onboarding@resend.dev>";
  console.log(`\nsending to ${sendTo} as ${from}`);
  for (const [name, letter] of letters) {
    // Tagged, because four of these arriving at once is otherwise indistinguishable
    // from the real thing landing in a real inbox by mistake.
    const { data, error } = await resend.emails.send({
      from,
      to: sendTo,
      subject: `[preview] ${letter.subject}`,
      html: letter.html,
      text: letter.text,
    });
    console.log(error ? `  ${name}: refused — ${error.message}` : `  ${name}: sent ${data?.id}`);
  }
}
