/**
 * A recording of the product being used, end to end.
 *
 * The rehearsal proves drymem works; nobody can watch a list of ticks. This
 * drives the same populated stack at a human pace with a caption on screen,
 * and writes one video out — for a README, for a teammate, or for anyone who
 * would rather see it than read about it.
 *
 *   node tour.mjs <base-url> <admin-email> <member-email> <password> <project> <out-dir>
 *
 * Nothing here asserts. A scene that cannot run is skipped and named, because
 * a recording that stops halfway is worth less than one with a gap in it.
 */

import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [base, admin, member, password, project, out] = process.argv.slice(2);
if (!base || !admin || !member || !password || !project || !out) {
  console.error("usage: tour.mjs <base-url> <admin> <member> <password> <project> <out-dir>");
  process.exit(2);
}

const SIZE = { width: 1440, height: 900 };

/** A caption, drawn over the page, so the video explains itself. */
async function say(page, line) {
  await page.evaluate((text) => {
    let banner = document.getElementById("drymem-tour-caption");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "drymem-tour-caption";
      Object.assign(banner.style, {
        position: "fixed",
        left: "50%",
        bottom: "28px",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        padding: "10px 20px",
        borderRadius: "10px",
        background: "rgba(10,10,10,0.92)",
        color: "#fafafa",
        font: "500 15px/1.4 ui-sans-serif, system-ui, sans-serif",
        letterSpacing: "0.01em",
        boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        pointerEvents: "none",
        maxWidth: "80vw",
        textAlign: "center",
      });
      document.body.appendChild(banner);
    }
    banner.textContent = text;
  }, line);
  console.log(`· ${line}`);
}

const beat = (page, ms = 2200) => page.waitForTimeout(ms);

async function visit(page, hash, caption, wait = 2600) {
  await page.goto(`${base}#/${hash}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await say(page, caption);
  await beat(page, wait);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: SIZE,
  recordVideo: { dir: out, size: SIZE },
});
const page = await context.newPage();

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate((key) => localStorage.setItem("drymem.project", key), project);
  await page.reload({ waitUntil: "networkidle" });
  await say(page, "drymem — one memory a whole team's coding agents share");
  await beat(page, 2600);

  await say(page, "Signing in. Every account on the server was invited by an admin.");
  await page.fill("#email", admin);
  await page.waitForTimeout(500);
  await page.fill("#password", password);
  await beat(page, 1200);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/#\//, { timeout: 20_000 });
  await page.waitForTimeout(1600);

  await visit(page, "overview", "The overview: what this project has learned, and whether it is healthy.");
  await visit(page, "memories", "Memories. Written by agents while people worked, newest first.", 3000);

  // Open one, so the video shows a memory rather than a list of them.
  const row = page.locator("table tbody tr, [data-slot='table'] tbody tr").first();
  if (await row.count()) {
    await say(page, "Each one says who wrote it, when, and which project it belongs to.");
    await row.click();
    await page.waitForTimeout(2600);
  }

  await visit(page, "graph", "Decisions, and what followed from them.", 3200);
  await visit(page, "skills", "Skills: published once here, installed on every teammate's machine.", 3000);
  await visit(page, "members", "Members. An invitation is a link; they choose their own password.", 3000);

  await page.goto(`${base}#/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const serverTab = page.locator('[role="tab"]:has-text("Server")');
  if (await serverTab.count()) {
    await serverTab.click();
    await page.waitForTimeout(1400);
    await say(page, "Settings → Server: your Postgres, your Neo4j, your model. Nothing leaves the network.");
    await beat(page, 3600);
  }

  // The boundary, shown rather than asserted — and in the same page, so the
  // recording stays one continuous take instead of two files to stitch.
  await say(page, "Now the same server, signed in as somebody who is only a member.");
  await beat(page, 2400);
  await context.clearCookies();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.fill("#email", member);
  await page.fill("#password", password);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/#\//, { timeout: 20_000 });
  await page.waitForTimeout(1800);
  await say(page, "No audit trail, no server card. The API refuses them, so the console does not offer them.");
  await beat(page, 4200);

  await say(page, "That is drymem.   npx drymem@latest setup");
  await beat(page, 3600);
} finally {
  // Ask Playwright which file belongs to this page rather than guessing from
  // the directory: it names them by a random id, and a wrong guess ships the
  // wrong recording.
  const video = page.video();
  await page.close();
  await context.close();
  if (video) {
    const target = join(out, "drymem-tour.webm");
    await video.saveAs(target);
    await video.delete();
    console.log(`\nVideo: ${target}`);
  }
  await browser.close();
}
