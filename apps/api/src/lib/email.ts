/**
 * The three emails drymem sends, and the one way it sends them.
 *
 * Sending is best-effort by design. Every flow that sends also returns the link
 * to the caller when there is no key configured, because drymem runs on
 * laptops: a link an admin pastes into Slack beats an email that silently never
 * left. A send that fails is logged and the flow continues — an invitation that
 * exists with an unsent email is recoverable; one that was rolled back is not.
 *
 * `sent` in the result is the honest answer to "did we email them?", and every
 * screen that calls this uses it to decide what to tell the person.
 *
 * How they look lives in `email-layout.ts`. Nothing here writes a `<table>`,
 * and nothing there knows what an invitation is.
 */

import { readFileSync } from "node:fs";

import { Resend } from "resend";

import { emailEnabled, env } from "../env.js";
import {
  button,
  code,
  esc,
  fallback,
  heading,
  MARK_CID,
  note,
  panel,
  paragraph,
  render,
  steps,
  text,
} from "./email-layout.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * The mark, read once and sent with every letter.
 *
 * Two kilobytes on each message, against a letterhead that cannot break: see
 * `MARK_CID`. Read at import so a missing asset is one line in the log at boot
 * rather than a surprise inside a send.
 */
export const mark = (() => {
  try {
    const content = readFileSync(new URL("../../assets/mark.png", import.meta.url));
    return { filename: "mark.png", content, contentId: MARK_CID, contentType: "image/png" };
  } catch (error) {
    console.warn(`email mark missing, letters will go out without it: ${String(error)}`);
    return null;
  }
})();

export interface Sent {
  sent: boolean;
  reason?: string;
}

/**
 * One email, built but not yet sent.
 *
 * Building is separated from sending so both halves can be looked at without a
 * key and without a network: `scripts/email-preview.mjs` renders them into a
 * browser, and the tests assert on them. A template nobody can see before it
 * reaches somebody's inbox is a template nobody checks.
 */
export interface Letter {
  subject: string;
  html: string;
  text: string;
}

async function send(to: string, letter: Letter): Promise<Sent> {
  if (!resend) return { sent: false, reason: "No RESEND_API_KEY is configured." };
  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
      ...(mark ? { attachments: [mark] } : {}),
    });
    if (error) {
      console.warn(`email to ${to} refused: ${error.message}`);
      return { sent: false, reason: error.message };
    }
    return { sent: true };
  } catch (error) {
    // Never fail the caller's flow for this. The link still exists.
    console.warn(`email to ${to} failed: ${String(error)}`);
    return { sent: false, reason: String(error) };
  }
}

export function link(path: string): string {
  return `${env.PUBLIC_URL.replace(/\/+$/, "")}/#/${path.replace(/^\/+/, "")}`;
}

/** Unambiguous on purpose: a security email read in another country still says when. */
const when = (at: Date) =>
  `${at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })} at ${at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;

/** A user agent is for recognising your own browser, not for parsing. */
const device = (agent: string | null | undefined): string => {
  const ua = (agent ?? "").trim();
  if (!ua) return "an unrecognised browser";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "a browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
};

/**
 * Welcome — the only email that exists because of what the product is.
 *
 * drymem has no activation step: an invitation link is already proof that
 * somebody holds the mailbox, and the one signup a server ever accepts is made
 * by the person installing it, sitting in front of it. What a new account does
 * need is the step the web app cannot do for them. Signing in to a browser
 * connects nothing; the memory reaches an agent only once `drymem login` and
 * `drymem setup` have run on the machine the agent runs on.
 *
 * So this is not a greeting with a product tour in it. It is the two commands,
 * in the place people keep things they need again on a second machine.
 */
export interface WelcomeOpts {
  to: string;
  orgName: string;
  appUrl: string;
  /** The owner made the organisation; a member was let into one. */
  owner: boolean;
}

export function welcomeLetter(opts: WelcomeOpts): Letter {
  // One command, not two: `setup` signs the machine in through the browser when
  // it has no token yet (apps/cli/src/setup.ts), so telling people to `login`
  // first sends them through a step they have already done. Nothing is
  // installed globally either — the hooks it writes call `npx drymem` too, so
  // the package has to be runnable that way regardless.
  const run = "npx drymem@latest setup";
  const opening = opts.owner
    ? `You created <b>${esc(opts.orgName)}</b> on drymem and you own it.`
    : `Your account at <b>${esc(opts.orgName)}</b> is ready.`;
  const getting = [
    {
      title: "Open a repository you work in",
      body: `Any project with a git remote. That remote is what decides which memory this is.`,
    },
    {
      title: "Run one command",
      body: `${code(run)} — it signs this machine in through your browser, installs the session hooks and the MCP server, and pulls the skills this project uses. Nothing to install first.`,
    },
    {
      title: "Carry on as normal",
      body: "From then on every session starts with what the team already knows, and ends by writing back what it worked out. Nothing to remember.",
    },
  ];

  return {
    subject: opts.owner
      ? "Your drymem organisation is ready"
      : `Welcome to ${opts.orgName} on drymem`,
    html: render({
      title: opts.owner ? "Your drymem organisation is ready" : `Welcome to ${opts.orgName}`,
      preheader: "Two commands connect your coding agent to the team's memory.",
      rows: [
        heading(opts.owner ? `${opts.orgName} is set up` : `Welcome to ${opts.orgName}`),
        paragraph(
          `${opening} Signing in here is half of it — the memory only reaches your coding agent once this machine is connected.`,
        ),
        paragraph("<b>Three things to start:</b>"),
        steps(getting),
        button(opts.appUrl, "Open drymem"),
        note(
          opts.owner
            ? "Invite the rest of the team from Members, and pick which skills each project runs."
            : "What you save is private to you until you share it with the team.",
        ),
      ].join(""),
      footnote: opts.owner
        ? "You got this because you created an organisation on this drymem server."
        : `You got this because you accepted an invitation to ${esc(opts.orgName)}.`,
    }),
    text: text([
      opts.owner
        ? `You created ${opts.orgName} on drymem and you own it.`
        : `Your account at ${opts.orgName} on drymem is ready.`,
      ``,
      `Signing in here is half of it — the memory only reaches your coding agent`,
      `once this machine is connected. In a repository you work in, run:`,
      ``,
      `  ${run}`,
      ``,
      `That signs this machine in through your browser, installs the session`,
      `hooks and the MCP server, and pulls the skills this project uses.`,
      `Nothing to install first.`,
      ``,
      `Open drymem: ${opts.appUrl}`,
    ]),
  };
}

export const sendWelcome = (opts: WelcomeOpts): Promise<Sent> => send(opts.to, welcomeLetter(opts));

/**
 * Somebody asked for an account.
 *
 * The only letter that goes to the operator rather than to a user, and the only
 * one whose job is to be read within a day: the landing page promises an answer
 * from a person, and nothing else in the product will mention that a request is
 * sitting there. It carries the whole request so a decision can be made from
 * the phone, without opening the queue.
 */
export interface AccessRequestedOpts {
  email: string;
  name: string | null;
  company: string | null;
  about: string | null;
  teamSize: string | null;
}

export function accessRequestedLetter(opts: AccessRequestedOpts): Letter {
  const who = opts.name?.trim() || opts.email;
  const rows: Array<[string, string]> = [["Email", opts.email]];
  if (opts.name) rows.push(["Name", opts.name]);
  if (opts.company) rows.push(["Company", opts.company]);
  if (opts.teamSize) rows.push(["Team size", opts.teamSize]);

  return {
    subject: `drymem access request: ${who}`,
    html: render({
      title: "Someone asked for access to drymem",
      preheader: `${who}${opts.company ? ` at ${opts.company}` : ""} asked for an account.`,
      rows: [
        heading("Someone asked for access"),
        panel(rows),
        ...(opts.about
          ? [paragraph(`<b>What they want it for</b><br>${esc(opts.about)}`)]
          : []),
        paragraph(
          `To let them in, provision the organisation and they will set their own password from the sign-in page:`,
        ),
        paragraph(
          code(`drymem-admin org-create "Their Company" --owner ${opts.email}`),
        ),
      ].join(""),
      footnote: "You got this because you run this drymem server.",
    }),
    text: text([
      `Someone asked for access to drymem.`,
      ``,
      `Email: ${opts.email}`,
      ...(opts.name ? [`Name: ${opts.name}`] : []),
      ...(opts.company ? [`Company: ${opts.company}`] : []),
      ...(opts.teamSize ? [`Team size: ${opts.teamSize}`] : []),
      ...(opts.about ? [``, `What they want it for:`, opts.about] : []),
      ``,
      `To let them in:`,
      `  drymem-admin org-create "Their Company" --owner ${opts.email}`,
    ]),
  };
}

/**
 * The operator's copy. `to` is decided by the caller, which knows who owns this
 * server; `ACCESS_REQUESTS_TO` overrides it when the person who runs the box is
 * not the person who reads the requests.
 */
export const sendAccessRequested = (to: string, opts: AccessRequestedOpts): Promise<Sent> =>
  send(env.ACCESS_REQUESTS_TO?.trim() || to, accessRequestedLetter(opts));

export interface InviteOpts {
  to: string;
  orgName: string;
  invitedBy: string | null;
  projectKey: string | null;
  role: string;
  days: number;
  url: string;
}

export function inviteLetter(opts: InviteOpts): Letter {
  const who = opts.invitedBy ?? "Someone";
  const rows: Array<[string, string]> = [["Organisation", opts.orgName]];
  if (opts.invitedBy) rows.push(["Invited by", opts.invitedBy]);
  if (opts.projectKey) rows.push(["Project", opts.projectKey]);
  rows.push(["Role", opts.role === "admin" ? "Admin" : "Member"]);

  return {
    subject: `Join ${opts.orgName} on drymem`,
    html: render({
      title: `Join ${opts.orgName} on drymem`,
      preheader: `${who} invited you to ${opts.orgName}. The link works once and expires in ${opts.days} days.`,
      rows: [
        heading(`Join ${opts.orgName} on drymem`),
        paragraph(
          `<b>${esc(who)}</b> invited you to <b>${esc(
            opts.orgName,
          )}</b> on drymem — where the team's coding agents keep what they learn, and read it back. Choose a password and you are in.`,
        ),
        panel(rows),
        button(opts.url, "Accept the invitation"),
        note(`This link works once and expires in ${opts.days} days.`),
        fallback(opts.url),
      ].join(""),
      footnote: `You got this because somebody at ${esc(
        opts.orgName,
      )} invited this address. Nothing is created until you accept.`,
    }),
    text: text([
      `${who} invited you to ${opts.orgName} on drymem.`,
      ``,
      `Organisation: ${opts.orgName}`,
      ...(opts.projectKey ? [`Project: ${opts.projectKey}`] : []),
      `Role: ${opts.role === "admin" ? "Admin" : "Member"}`,
      ``,
      `Accept the invitation:`,
      opts.url,
      ``,
      `This link works once and expires in ${opts.days} days. Nothing is created until you accept.`,
    ]),
  };
}

export const sendInvite = (opts: InviteOpts): Promise<Sent> => send(opts.to, inviteLetter(opts));

export interface ResetOpts {
  to: string;
  url: string;
  minutes: number;
}

export function resetLetter(opts: ResetOpts): Letter {
  return {
    subject: "Reset your drymem password",
    html: render({
      title: "Reset your drymem password",
      preheader: `The link works once and expires in ${opts.minutes} minutes.`,
      rows: [
        heading("Reset your password"),
        paragraph(
          `Somebody asked to reset the password for <b>${esc(
            opts.to,
          )}</b>. Choose a new one and you will be signed straight in.`,
        ),
        button(opts.url, "Choose a new password"),
        note(`This link works once and expires in ${opts.minutes} minutes.`),
        fallback(opts.url),
      ].join(""),
      footnote:
        "If this was not you, ignore this email — nothing has changed and the link expires on its own.",
    }),
    text: text([
      `Reset your drymem password.`,
      ``,
      `Somebody asked to reset the password for ${opts.to}.`,
      ``,
      `Choose a new password:`,
      opts.url,
      ``,
      `This link works once and expires in ${opts.minutes} minutes.`,
      `If this was not you, ignore this email — nothing has changed.`,
    ]),
  };
}

export const sendReset = (opts: ResetOpts): Promise<Sent> => send(opts.to, resetLetter(opts));

/**
 * The one email nobody asks for.
 *
 * A password changing is the moment an account is taken, and the owner's only
 * warning is a message they did not expect. It goes to the address, not to the
 * session, precisely because whoever is holding the session may not be them.
 */
export interface PasswordChangedOpts {
  to: string;
  at: Date;
  userAgent: string | null | undefined;
  resetUrl: string;
}

export function passwordChangedLetter(opts: PasswordChangedOpts): Letter {
  return {
    subject: "Your drymem password was changed",
    html: render({
      title: "Your drymem password was changed",
      preheader: "If that was you, there is nothing to do. If it was not, act now.",
      rows: [
        heading("Your password was changed"),
        paragraph(
          `The password for <b>${esc(
            opts.to,
          )}</b> has just been changed. Every other signed-in browser was signed out.`,
        ),
        panel([
          ["When", when(opts.at)],
          ["Where", device(opts.userAgent)],
        ]),
        paragraph("If that was you, there is nothing to do."),
        button(opts.resetUrl, "It was not me — reset it"),
        fallback(opts.resetUrl),
      ].join(""),
      footnote:
        "If you did not change this password, reset it now and tell whoever owns your drymem organisation.",
    }),
    text: text([
      `Your drymem password was changed.`,
      ``,
      `Account: ${opts.to}`,
      `When: ${when(opts.at)}`,
      `Where: ${device(opts.userAgent)}`,
      ``,
      `Every other signed-in browser was signed out.`,
      `If that was you, there is nothing to do.`,
      ``,
      `If it was not you, reset the password now:`,
      opts.resetUrl,
    ]),
  };
}

export const sendPasswordChanged = (opts: PasswordChangedOpts): Promise<Sent> =>
  send(opts.to, passwordChangedLetter(opts));

export { emailEnabled };
