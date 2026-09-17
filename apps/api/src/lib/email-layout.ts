/**
 * The letterhead: how a drymem email looks, with no idea what any of them say.
 *
 * Email is not the web. Three constraints shape everything below, and each one
 * is the reason for something that would otherwise look like a mistake:
 *
 * - **Tables, not layout.** Outlook renders HTML with Word. Flexbox, grid and
 *   div layout collapse; nested tables with role="presentation" do not.
 * - **Inline styles.** Many clients strip a style block, so every rule that
 *   must survive is inlined. The one in the head carries only what cannot be
 *   inlined — media queries — and everything in it is a progressive extra.
 * - **Nothing is fetched.** Clients block remote images, and a mark that
 *   resolves to a broken icon is worse than no mark. The one image here is the
 *   mark, and it travels with the message as an inline attachment, so the
 *   email makes no request at all: nothing to block, nothing to break on an
 *   install nobody outside can reach, and no way to report that it was read.
 *
 * That last one decides the cat. The product's mark is a drawn SVG (the black
 * head with the amber almond eyes in `apps/web/src/components/Logo.tsx`), and
 * Gmail strips inline SVG to nothing — so the letterhead carries an emoji.
 * It is the black cat, U+1F408 U+200D U+2B1B, because ours is a black cat and
 * the plain cat face renders ginger on every platform that draws it. That one
 * is a whole cat in profile rather than a face, so it is set larger than the
 * wordmark — at text size the detail collapses into a smudge.
 *
 * The palette is the app's own (`apps/web/src/index.css`) warmed a shade for
 * paper: light by default, with the app's dark values behind a media query.
 * Light-first is the safer half of that pair — clients that force their own
 * dark mode mangle a light design predictably and a dark one unpredictably.
 */

/**
 * The app's own tokens (`apps/web/src/index.css`), and nothing invented.
 *
 * The console is greyscale: an off-white ground, hairline rules, near-black for
 * anything that matters, and the primary action is the ground inverted. Amber
 * is `--brand`, but the CSS is explicit that it is for "the logo, the active
 * nav rail and nothing that has to be read at 12px" — so it appears here in
 * neither a band, a button, nor a link. An email that arrives in colours the
 * product does not use is a letter from somebody else.
 *
 * The mark is the one image, and it earns it. `CatMark` is drawn and takes
 * `currentColor`; Gmail strips inline SVG, an emoji cannot be recoloured, and
 * Unicode has no black cat *face* at all — the black cat is whole-body only. So
 * the real mark is attached as a PNG and the strip goes near-black behind it,
 * which is how the favicon already reads: a dark tile, a lit cat. Its `alt` is
 * deliberately empty — the wordmark sits beside it in text, so a client that
 * refuses it loses decoration and a screen reader does not say the name twice.
 */

/** Light: the app's `:root`. Contrast is against the card. */
const light = {
  page: "#fafafa", // --background
  card: "#ffffff", // --card
  border: "#e5e5e5", // --border
  heading: "#0a0a0a", // --foreground, 19.80:1
  /* Body sits between foreground and muted-foreground: 15px of prose in
     near-black reads heavy, and in muted-foreground it reads faint. */
  text: "#454545", // 9.17:1
  meta: "#666666", // --muted-foreground, 5.74:1
  button: "#0a0a0a", // --primary
  buttonText: "#ffffff", // --primary-foreground, 19.80:1
  panel: "#f5f5f5", // --muted
};

/** Dark: the app's `.dark`. The primary action inverts rather than staying black. */
const dark = {
  page: "#0a0a0a",
  card: "#0f0f0f",
  border: "#232323",
  heading: "#ededed", // 16.37:1
  text: "#c9c9c9", // 11.0:1
  meta: "#a1a1a1", // 7.42:1
  button: "#ededed", // --primary
  buttonText: "#0a0a0a", // 16.91:1
  panel: "#171717", // --muted
};

/**
 * The mark's strip: near-black in both schemes, like the favicon's own tile
 * (a `#0b0d10` rounded square with the cat lit on it). Greyscale, so it stays
 * inside the console's palette, and dark enough that the wordmark beside the
 * cat can be white in a light email and a dark one alike.
 */
const HEADER = "#0a0a0a";

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif,'Apple Color Emoji','Segoe UI Emoji'";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

/**
 * Anything that reaches a template from a person — an org name, a project key,
 * a display name — is interpolated into HTML, so it is escaped here rather than
 * trusted at each call site. An org called `Ben & Co <ops>` should read as
 * itself, not disappear into a broken tag.
 */
/**
 * The mark rides along with the message, as an inline attachment.
 *
 * Fetching it from `PUBLIC_URL` looked tidier and was wrong twice over: a
 * laptop install serves it on 127.0.0.1, where the recipient's client gets
 * nothing and draws a broken-image icon in the letterhead — worse than no mark
 * — and a fetched image is a request that reports when the mail was opened.
 * `cid:` costs about two kilobytes and has neither problem.
 */
export const MARK_CID = "drymem-mark";

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The line the inbox shows next to the subject. Without one, clients quote
 * whatever text comes first — for us the wordmark, so every drymem email
 * previewed as "drymem drymem". The entities pad the preview so the body does
 * not leak in after the sentence ends.
 */
const preheaderOf = (text: string) =>
  `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${esc(
    text,
  )}${"&#8199;&#65279;&#847;".repeat(40)}</div>`;

export const heading = (text: string) => `
      <tr><td class="dm-h1" style="font-family:${FONT};font-size:22px;line-height:1.3;font-weight:600;color:${light.heading};padding:0 0 14px">${esc(
        text,
      )}</td></tr>`;

/** Body copy. The only place that takes HTML, for the emphasis a sentence needs. */
export const paragraph = (html: string) => `
      <tr><td class="dm-text" style="font-family:${FONT};font-size:15px;line-height:1.65;color:${light.text};padding:0 0 18px">${html}</td></tr>`;

/** A command or a filename, inline in a sentence. */
export const code = (value: string) =>
  `<span class="dm-code" style="font-family:${MONO};font-size:13px;color:${light.heading};background:${light.panel};border:1px solid ${light.border};border-radius:5px;padding:2px 6px;white-space:nowrap">${esc(
    value,
  )}</span>`;

/**
 * The action.
 *
 * A table with bgcolor rather than VML: a roundrect buys rounded corners in
 * Outlook 2016 at the price of a second copy of every colour, which then has to
 * be kept in step with the dark-mode block. Square corners in one desktop
 * client is the cheaper miss.
 */
export const button = (href: string, label: string) => `
      <tr><td style="padding:6px 0 22px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="dm-btn-wrap"><tr>
          <td class="dm-btn" bgcolor="${light.button}" style="border-radius:8px;border:1px solid ${light.button};mso-padding-alt:14px 26px">
            <a class="dm-btn-a" href="${href}" style="display:inline-block;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${light.buttonText};text-decoration:none;padding:14px 26px;border-radius:8px">${esc(
              label,
            )}</a>
          </td>
        </tr></table>
      </td></tr>`;

/**
 * What to do, in order.
 *
 * Numbered rather than bulleted because these are steps with a sequence, and a
 * reader who has done the first one needs to find the second at a glance. The
 * numeral carries the accent; the title carries the weight.
 */
export const steps = (items: Array<{ title: string; body: string }>) => `
      <tr><td style="padding:0 0 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
          .map(
            (item, i) => `
          <tr>
            <td valign="top" class="dm-strong" style="font-family:${FONT};font-size:13px;font-weight:700;line-height:1.5;color:${light.heading};padding:0 12px 16px 0;width:18px">${i + 1}</td>
            <td valign="top" style="padding:0 0 16px">
              <div class="dm-strong" style="font-family:${FONT};font-size:15px;font-weight:600;line-height:1.5;color:${light.heading};padding-bottom:3px">${esc(
                item.title,
              )}</div>
              <div class="dm-text" style="font-family:${FONT};font-size:14px;line-height:1.6;color:${light.text}">${item.body}</div>
            </td>
          </tr>`,
          )
          .join("")}
        </table>
      </td></tr>`;

/** Facts worth setting apart from the prose: who invited you, which project. */
export const panel = (rows: Array<[string, string]>) => `
      <tr><td style="padding:0 0 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dm-panel" style="background:${light.panel};border:1px solid ${light.border};border-radius:10px">
          <tr><td style="padding:14px 16px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows
              .map(
                ([key, value], i) => `
              <tr>
                <td class="dm-meta" style="font-family:${FONT};font-size:13px;line-height:1.5;color:${light.meta};padding:${i ? "6px" : "0"} 12px 0 0;white-space:nowrap">${esc(key)}</td>
                <td class="dm-strong" style="font-family:${FONT};font-size:13px;line-height:1.5;font-weight:600;color:${light.heading};padding:${i ? "6px" : "0"} 0 0;text-align:right">${esc(value)}</td>
              </tr>`,
              )
              .join("")}
            </table>
          </td></tr>
        </table>
      </td></tr>`;

/** Small print under the action: how long the link lives, how often it works. */
export const note = (text: string) => `
      <tr><td class="dm-meta" style="font-family:${FONT};font-size:13px;line-height:1.6;color:${light.meta};padding:0 0 18px">${esc(
        text,
      )}</td></tr>`;

/**
 * The link in full.
 *
 * Every client that mangles a button still shows text, and a person who does
 * not trust a button in an email is right to want to read the address first.
 */
export const fallback = (href: string) => `
      <tr><td class="dm-rule" style="border-top:1px solid ${light.border};padding:18px 0 0">
        <div class="dm-meta" style="font-family:${FONT};font-size:12px;line-height:1.6;color:${light.meta}">If the button does not work, paste this into your browser:</div>
        <div style="font-family:${MONO};font-size:12px;line-height:1.6;word-break:break-all"><a class="dm-link" href="${href}" style="color:${light.heading};text-decoration:underline">${esc(
          href,
        )}</a></div>
      </td></tr>`;

export interface Layout {
  /** The `<title>`, and the fallback preview in clients that ignore preheaders. */
  title: string;
  /** The line beside the subject in the inbox list. */
  preheader: string;
  /** `heading`/`paragraph`/`steps`/`button`/… rows, in order. */
  rows: string;
  /** The last word, under the card: what to do if this was not you. */
  footnote: string;
}

export function render({ title, preheader, rows, footnote }: Layout): string {
  return `<!doctype html>
<html lang="en" style="color-scheme:light dark;supported-color-schemes:light dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
  /* Apple Mail, iOS, Outlook for macOS honour this. Gmail's apps invert on
     their own terms whatever we say, which light-first survives. */
  @media (prefers-color-scheme: dark) {
    .dm-page    { background: ${dark.page} !important; }
    .dm-card    { background: ${dark.card} !important; border-color: ${dark.border} !important; }
    .dm-panel   { background: ${dark.panel} !important; border-color: ${dark.border} !important; }
    .dm-code    { background: ${dark.panel} !important; border-color: ${dark.border} !important; color: ${dark.heading} !important; }
    .dm-rule    { border-color: ${dark.border} !important; }
    .dm-h1, .dm-strong { color: ${dark.heading} !important; }
    .dm-text    { color: ${dark.text} !important; }
    .dm-text b, .dm-text strong { color: ${dark.heading} !important; }
    .dm-meta    { color: ${dark.meta} !important; }
    .dm-link    { color: ${dark.heading} !important; }
    /* On dark the strip and the page are the same near-black, so the card
       needs a line to start somewhere. */
    .dm-pad-t   { border-bottom: 1px solid ${dark.border} !important; }
    .dm-btn     { background: ${dark.button} !important; border-color: ${dark.button} !important; }
    .dm-btn-a   { color: ${dark.buttonText} !important; }
  }
  @media only screen and (max-width: 480px) {
    .dm-pad     { padding: 26px 22px !important; }
    .dm-pad-t   { padding: 18px 22px !important; }
    .dm-h1      { font-size: 20px !important; }
    /* A thumb is a blunt instrument: the action goes full width. The anchor
       turns into a block and keeps an automatic width — a block already fills
       its cell, and a 100% width on top of 26px of padding pushed the label
       off the right edge of the button. */
    .dm-btn-wrap, .dm-btn { width: 100% !important; }
    .dm-btn-a { display: block !important; width: auto !important; padding-left: 10px !important; padding-right: 10px !important; text-align: center !important; }
  }
</style>
</head>
<body class="dm-page" style="margin:0;padding:0;width:100%;background:${light.page};-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%">
${preheaderOf(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dm-page" style="background:${light.page}">
  <tr><td align="center" style="padding:32px 12px 40px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;margin:0 auto">

      <tr><td class="dm-card" style="background:${light.card};border:1px solid ${light.border};border-radius:14px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr><td class="dm-pad-t" bgcolor="${HEADER}" style="background:${HEADER};border-radius:13px 13px 0 0;padding:18px 30px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="vertical-align:middle;line-height:0"><img src="cid:${MARK_CID}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border:0;outline:none"></td>
              <td style="padding-left:10px;vertical-align:middle"><span style="font-family:${FONT};font-size:16px;font-weight:600;letter-spacing:-0.01em;color:#ffffff">drymem</span></td>
            </tr></table>
          </td></tr>

          <tr><td class="dm-pad" style="padding:30px 30px 26px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}
            </table>
          </td></tr>
        </table>
      </td></tr>

      <tr><td class="dm-meta" style="font-family:${FONT};font-size:12px;line-height:1.7;color:${light.meta};padding:18px 6px 0">
        ${footnote}<br>
        drymem &middot; shared memory and skills for coding agents
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/**
 * The plain-text half.
 *
 * Not a downgrade — some people read only this, and a spam filter reads it to
 * check the two halves say the same thing. Every line is written, never
 * stripped out of the HTML.
 */
export const text = (lines: string[]): string =>
  `${lines.join("\n").trim()}\n\n--\ndrymem — shared memory and skills for coding agents\n`;
