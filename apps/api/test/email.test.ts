/**
 * The emails, read without sending one.
 *
 * Every template here is HTML assembled by hand out of values a person chose —
 * an organisation's name, their own display name, a project key. That is the
 * shape of an injection, and it is also the shape of a layout that silently
 * falls apart. Neither shows up in a unit test of the route that sends it, so
 * the letters are built and inspected directly.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

type EmailModule = typeof import("../src/lib/email.js");
let email: EmailModule;

beforeAll(async () => {
  process.env.SERVICE_SECRET = "test-secret-at-least-sixteen";
  process.env.PUBLIC_URL = "http://127.0.0.1:8080";
  delete process.env.RESEND_API_KEY;
  vi.resetModules();
  email = await import("../src/lib/email.js");
});

const invite = (over: Partial<Parameters<EmailModule["inviteLetter"]>[0]> = {}) =>
  email.inviteLetter({
    to: "jose@acme.test",
    orgName: "Acme",
    invitedBy: "Miguel Rojas",
    projectKey: "github.com/acme/payments",
    role: "member",
    days: 7,
    url: "http://127.0.0.1:8080/#/invite/abc123",
    ...over,
  });

const reset = () =>
  email.resetLetter({ to: "jose@acme.test", url: "http://127.0.0.1:8080/#/reset/tok", minutes: 60 });

const changed = () =>
  email.passwordChangedLetter({
    to: "jose@acme.test",
    at: new Date("2026-09-17T14:32:00Z"),
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    resetUrl: "http://127.0.0.1:8080/#/forgot",
  });

describe("what every letter owes the reader", () => {
  it("says something in the inbox preview, and hides it in the body", () => {
    for (const letter of [invite(), reset(), changed()]) {
      // Without a preheader the client quotes the first text it finds, which is
      // the wordmark: every drymem email previewed as "drymem drymem".
      expect(letter.html).toMatch(/max-height:0;max-width:0;opacity:0;overflow:hidden/);
      expect(letter.subject.length).toBeGreaterThan(8);
    }
  });

  it("carries a plain-text half that names the same link", () => {
    expect(invite().text).toContain("http://127.0.0.1:8080/#/invite/abc123");
    expect(reset().text).toContain("http://127.0.0.1:8080/#/reset/tok");
    expect(changed().text).toContain("http://127.0.0.1:8080/#/forgot");
  });

  it("puts the link in a button and again in full, for a client that eats one", () => {
    const { html } = reset();
    expect(html).toContain('href="http://127.0.0.1:8080/#/reset/tok"');
    expect(html.match(/http:\/\/127\.0\.0\.1:8080\/#\/reset\/tok/g)?.length).toBeGreaterThan(1);
  });
});

describe("values a person chose", () => {
  it("escapes an organisation's name instead of running it as markup", () => {
    const { html, subject } = invite({ orgName: `Ben & Co <img src=x onerror="alert(1)">` });
    // The words survive as text; what must not survive is a tag, or a quote
    // that could close an attribute and start a new one.
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="');
    expect(html).toContain("&lt;img");
    expect(html).toContain("Ben &amp; Co");
    // The subject is not markup, so it keeps the characters as typed.
    expect(subject).toContain("Ben & Co");
  });

  it("escapes the inviter's display name too", () => {
    const { html } = invite({ invitedBy: `<script>x</script>` });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the invitation", () => {
  it("names who invited you, the org, the project and the role", () => {
    const { html } = invite();
    expect(html).toContain("Miguel Rojas");
    expect(html).toContain("github.com/acme/payments");
    expect(html).toContain("Member");
  });

  it("leaves out the project row when there is no project", () => {
    const { html, text } = invite({ projectKey: null });
    expect(html).not.toContain("Project");
    expect(text).not.toContain("Project:");
  });

  it("falls back to a sentence when nobody is named", () => {
    expect(invite({ invitedBy: null }).html).toContain("Someone");
  });

  it("says how long the link lasts, in both halves", () => {
    const letter = invite();
    expect(letter.html).toContain("expires in 7 days");
    expect(letter.text).toContain("expires in 7 days");
  });
});

describe("the reset", () => {
  it("says whose password, how long, and what happens if it was not you", () => {
    const { html, text } = reset();
    expect(html).toContain("jose@acme.test");
    expect(html).toContain("expires in 60 minutes");
    expect(html).toContain("nothing has changed");
    expect(text).toContain("expires in 60 minutes");
  });
});

describe("the password-changed notice", () => {
  it("dates it unambiguously and names the browser", () => {
    const { html, text } = changed();
    expect(html).toContain("17 September 2026");
    expect(html).toContain("UTC");
    expect(html).toContain("Chrome on macOS");
    expect(text).toContain("Chrome on macOS");
  });

  it("offers the way back in", () => {
    expect(changed().html).toContain("http://127.0.0.1:8080/#/forgot");
  });

  it("says something honest when the browser is unknown", () => {
    const letter = email.passwordChangedLetter({
      to: "jose@acme.test",
      at: new Date("2026-09-17T14:32:00Z"),
      userAgent: null,
      resetUrl: "http://127.0.0.1:8080/#/forgot",
    });
    expect(letter.html).toContain("an unrecognised browser");
  });
});

describe("with no key configured", () => {
  it("reports that it did not send, rather than throwing", async () => {
    const result = await email.sendReset({
      to: "jose@acme.test",
      url: "http://127.0.0.1:8080/#/reset/tok",
      minutes: 60,
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/RESEND_API_KEY/);
  });
});
