/**
 * Email, through Resend.
 *
 * Sending is best-effort by design. Every flow that sends also returns the link
 * to the caller when there is no key configured, because drymem runs on
 * laptops: a link an admin pastes into Slack beats an email that silently never
 * left. A send that fails is logged and the flow continues — an invitation that
 * exists with an unsent email is recoverable; one that was rolled back is not.
 *
 * `sent` in the result is the honest answer to "did we email them?", and every
 * screen that calls this uses it to decide what to tell the person.
 */

import { Resend } from "resend";

import { emailEnabled, env } from "../env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export interface Sent {
  sent: boolean;
  reason?: string;
}

const shell = (title: string, body: string, action: { href: string; label: string }) => `
<!doctype html>
<html><body style="margin:0;background:#0b0d10;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#111419;border:1px solid #232932;border-radius:12px;padding:32px">
        <tr><td style="padding-bottom:20px">
          <span style="font-size:18px;font-weight:600;color:#e8eaed">drymem</span>
        </td></tr>
        <tr><td style="font-size:18px;font-weight:600;color:#e8eaed;padding-bottom:12px">${title}</td></tr>
        <tr><td style="font-size:14px;line-height:1.6;color:#98a1ad;padding-bottom:24px">${body}</td></tr>
        <tr><td>
          <a href="${action.href}" style="display:inline-block;background:#f2a93b;color:#1a1305;font-size:14px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px">${action.label}</a>
        </td></tr>
        <tr><td style="font-size:12px;line-height:1.6;color:#7d8794;padding-top:24px;border-top:1px solid #232932;margin-top:24px">
          If the button does not work, paste this into your browser:<br>
          <span style="color:#98a1ad;word-break:break-all">${action.href}</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

async function send(to: string, subject: string, html: string, text: string): Promise<Sent> {
  if (!resend) return { sent: false, reason: "No RESEND_API_KEY is configured." };
  try {
    const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html, text });
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

export function sendInvite(opts: {
  to: string;
  orgName: string;
  invitedBy: string | null;
  projectKey: string | null;
  url: string;
}): Promise<Sent> {
  const who = opts.invitedBy ? `${opts.invitedBy} has invited you` : "You have been invited";
  const where = opts.projectKey
    ? ` and added you to <b style="color:#e8eaed">${opts.projectKey}</b>`
    : "";
  return send(
    opts.to,
    `Join ${opts.orgName} on drymem`,
    shell(
      `Join ${opts.orgName}`,
      `${who} to ${opts.orgName}'s shared memory on drymem${where}. Choose a password and you are in. This link works once and expires in a week.`,
      { href: opts.url, label: "Accept the invitation" },
    ),
    `${who} to ${opts.orgName} on drymem.\n\nAccept: ${opts.url}\n\nThis link works once and expires in a week.`,
  );
}

export function sendReset(opts: { to: string; url: string; minutes: number }): Promise<Sent> {
  return send(
    opts.to,
    "Reset your drymem password",
    shell(
      "Reset your password",
      `Somebody asked to reset the password for this address. If that was not you, nothing has changed and you can ignore this. The link expires in ${opts.minutes} minutes and works once.`,
      { href: opts.url, label: "Choose a new password" },
    ),
    `Reset your drymem password: ${opts.url}\n\nExpires in ${opts.minutes} minutes. If this was not you, ignore it — nothing has changed.`,
  );
}

export { emailEnabled };
