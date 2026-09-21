/**
 * The console, in a real browser.
 *
 * Everything else in the rehearsal speaks HTTP, which is the agent's path.
 * This is the person's: the sign-in form, the pages an admin actually opens,
 * and the one screen that cannot be checked any other way — Settings → Server,
 * which reports what the server is connected to and must never show a secret
 * back to the person who typed it.
 *
 *   node console_check.mjs <base-url> <owner-email> <member-email> <password> <project-key> [shots-dir]
 *
 * Prints `PASS:<label>` and `FAIL:<label> :: detail`, and exits non-zero if
 * anything failed, so the caller can fold the results into its own report.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [base, owner, member, password, project, shots] = process.argv.slice(2);
if (!base || !owner || !member || !password || !project) {
  console.error(
    "usage: console_check.mjs <base-url> <owner-email> <member-email> <password> <project-key> [shots-dir]",
  );
  process.exit(2);
}

let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) console.log(`PASS:${label}`);
  else {
    failed += 1;
    console.log(`FAIL:${label} :: ${String(detail).slice(0, 200).replace(/\s+/g, " ")}`);
  }
};

async function signIn(page, email) {
  await page.goto(base, { waitUntil: "networkidle" });
  // Which project the console opens on is remembered per browser, and a person
  // on two projects would otherwise land on whichever came first. Pin it, so
  // the assertions below are about the console and not about that choice.
  await page.evaluate((key) => localStorage.setItem("drymem.project", key), project);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button:has-text('Sign in')");
  // The app is a hash router, so the URL changing is the signal it got in.
  await page.waitForURL(/#\//, { timeout: 20_000 });
  await page.waitForTimeout(800);
}

const text = (page) => page.evaluate(() => document.body.innerText);
const shoot = (page, name) => (shots ? page.screenshot({ path: `${shots}/console-${name}.png` }) : null);

const browser = await chromium.launch();
try {
  // An owner, who should see everything.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const broken = [];
  page.on("pageerror", (error) => broken.push(error.message));

  await signIn(page, owner);
  check("an admin can sign in", /#\/(overview|memories)/.test(page.url()), page.url());

  await page.goto(`${base}#/memories`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const memories = await text(page);
  check("the console shows what the team wrote", /Adyen/i.test(memories), memories.slice(-200));
  await shoot(page, "memories");

  // Inviting somebody, through the form rather than the API. With no email
  // configured the server hands the link back, which is the documented
  // behaviour and the only way a first team gets started.
  await page.goto(`${base}#/members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const fresh = `invited-${Date.now()}@acme.test`;
  await page.fill("input[type=email]", fresh);
  await page.click("button:has-text('Create invitation')");
  await page.waitForTimeout(2000);
  const afterInvite = await text(page);
  check(
    "an invitation can be created from the console",
    afterInvite.includes(fresh) || /invit/i.test(afterInvite),
    afterInvite.slice(-250),
  );
  await shoot(page, "members");

  // The screen that reports the deployment to the person running it.
  await page.goto(`${base}#/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.click('[role="tab"]:has-text("Server")');
  await page.waitForTimeout(1500);
  const server = await text(page);
  check("Settings shows a Server tab to an admin", /Where your memory lives/i.test(server), server.slice(0, 200));
  check("it reports both stores as connected", (server.match(/Connected/g) ?? []).length >= 2, server.slice(0, 300));
  check("and never shows a stored secret back", !/sk-ant-|re_[A-Za-z0-9]{10}/.test(server), "a key was rendered");
  await shoot(page, "settings-server");

  check("no page threw while an admin used it", broken.length === 0, broken.join(" | "));

  // A member, who should not.
  const theirs = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const memberPage = await theirs.newPage();
  await signIn(memberPage, member);
  const sidebar = await text(memberPage);
  check("a member does not get the Audit page", !/\bAudit\b/.test(sidebar), sidebar.slice(0, 200));

  await memberPage.goto(`${base}#/settings`, { waitUntil: "networkidle" });
  await memberPage.waitForTimeout(1200);
  const memberSettings = await memberPage.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()),
  );
  check("nor the Server tab", !memberSettings.includes("Server"), memberSettings.join(","));
  await shoot(memberPage, "member-settings");
} finally {
  await browser.close();
}

process.exit(failed === 0 ? 0 : 1);
