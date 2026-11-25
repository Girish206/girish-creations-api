import type { InlineImage } from "./email";
import { GIRISH_CREATIONS_LOGO, POCKET_LOGO } from "./email-logos";

// The layout behind every email (renderEmail): the brand's header with its
// logo, the message on a white card, and a footer saying who it's from and why
// they got it. Each email carries its logo as an inline image (logoImages).
// Email clients are far behind browsers: Outlook ignores gradients and most CSS,
// so it's tables and inline styles, with a solid colour under every gradient.
// The name beside the logo is text, so the brand still shows if images are blocked.

export interface EmailBrand {
  name: string;
  // The two-tone logo, e.g. "Girish" + "Creations".
  wordmark: [string, string];
  tagline: string;
  logo: string;
  headerGradient: string;
  headerColor: string;
  wordmarkAccent: string;
  // Buttons and the code's colour. Dark enough to read on white.
  accent: string;
  codeBackground: string;
  codeBorder: string;
  // Behind the logo in the header: white for a colourful logo on a gradient,
  // the header's own colour for one made to sit on it.
  logoBackground: string;
  // The thin line under the header.
  stripe: string;
}

// Girish Creations: the portfolio site's emails (the contact form). The site's
// graphite and gold (portfolio/src/styles/brand.css), with its GC mark in gold
// as it shows on dark.
export const BRAND: EmailBrand = {
  name: "Girish Creations",
  wordmark: ["Girish", "Creations"],
  tagline: "Portfolio platform",
  logo: GIRISH_CREATIONS_LOGO,
  headerGradient: "linear-gradient(120deg, #25262b 0%, #17181c 60%, #0f1012 100%)",
  headerColor: "#17181c",
  wordmarkAccent: "#f5c66b",
  accent: "#9e6207",
  codeBackground: "#fdf6e9",
  codeBorder: "#f0d9ac",
  logoBackground: "#17181c",
  stripe: "#d9901a",
};

// Pocket (expenses, splits and savings): its sign-in codes, welcome, split-up
// and money emails. Graphite with the gold logo, as in the app; amber dark
// enough to read on white for buttons and codes.
export const POCKET_BRAND: EmailBrand = {
  name: "Pocket",
  wordmark: ["Pocket", ""],
  tagline: "Expenses, splits and savings",
  logo: POCKET_LOGO,
  headerGradient: "linear-gradient(120deg, #24262b 0%, #16171a 60%, #0f1012 100%)",
  headerColor: "#16171a",
  wordmarkAccent: "#f5c66b",
  accent: "#9e6207",
  codeBackground: "#fdf6e9",
  codeBorder: "#f0d9ac",
  logoBackground: "#16171a",
  stripe: "#d9901a",
};

const LOGO_CID = "brand-logo";

// Every email has to carry this, or its logo won't show.
export const logoImages = (brand: EmailBrand): InlineImage[] => [
  { cid: LOGO_CID, mimeType: "image/png", content: brand.logo },
];

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'Courier New', monospace";

// Greys used throughout (zinc): headings, text, quieter text, lines, panels.
const INK = "#18181b";
const TEXT = "#3f3f46";
const MUTED = "#71717a";
const LINE = "#e4e4e7";
const PANEL = "#fafafa";

// Blocks of ready-made HTML: whoever builds one escapes what goes in it.
export const paragraph = (html: string) =>
  `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.65; color: ${TEXT}">${html}</p>`;

// A one-time code, large and centred in a tinted box, easy to read and copy.
export function codeBlock(brand: EmailBrand, code: string, caption: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 8px 0 20px">
  <tr>
    <td align="center" bgcolor="${brand.codeBackground}" style="padding: 22px 16px 18px; background: ${brand.codeBackground}; border: 1px solid ${brand.codeBorder}; border-radius: 14px">
      <div style="font-family: ${MONO}; font-size: 34px; line-height: 1.1; font-weight: 700; letter-spacing: 10px; color: ${brand.accent}">${escapeHtml(code)}</div>
      <div style="margin-top: 10px; font-size: 13px; line-height: 1.4; color: ${MUTED}">${caption}</div>
    </td>
  </tr>
</table>`;
}

// A solid button that holds up in Outlook (a table cell, not a styled link).
export function button(brand: EmailBrand, label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 8px 0 24px">
  <tr>
    <td bgcolor="${brand.accent}" style="border-radius: 10px; background: ${brand.accent}">
      <a href="${escapeHtml(href)}" style="display: inline-block; padding: 13px 26px; font-size: 15px; line-height: 1.2; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

export const textLink = (brand: EmailBrand, label: string, href: string) =>
  `<a href="${escapeHtml(href)}" style="color: ${brand.accent}; font-weight: 600; text-decoration: none">${escapeHtml(label)} &rarr;</a>`;

// Someone's own words, set apart from what we're saying.
export function quote(text: string) {
  const html = escapeHtml(text).replace(/\r?\n/g, "<br>");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px">
  <tr>
    <td bgcolor="${PANEL}" style="padding: 14px 16px; background: ${PANEL}; border-left: 3px solid ${LINE}; border-radius: 0 10px 10px 0; font-size: 15px; line-height: 1.6; color: ${INK}; word-break: break-word">${html}</td>
  </tr>
</table>`;
}

export const sectionHeading = (html: string) =>
  `<h2 style="margin: 28px 0 10px; font-size: 12px; line-height: 1.4; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: ${MUTED}">${html}</h2>`;

// A title with a line about it, one under another, each with a tick.
export function featureList(brand: EmailBrand, items: { title: string; description: string }[]) {
  const rows = items
    .map(
      (item) => `<tr>
    <td width="30" valign="top" style="padding: 8px 0">
      <div style="width: 20px; height: 20px; border-radius: 10px; background: ${brand.codeBackground}; border: 1px solid ${brand.codeBorder}; text-align: center; font-size: 12px; line-height: 20px; font-weight: 700; color: ${brand.accent}">&#10003;</div>
    </td>
    <td style="padding: 8px 0; font-size: 15px; line-height: 1.5; color: ${TEXT}"><strong style="color: ${INK}">${item.title}</strong><br>${item.description}</td>
  </tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 8px">
  ${rows}
</table>`;
}

// Label/value rows in a bordered panel, with thin lines between them.
function panel(rows: { label: string; value: string }[], background: string, border: string, labelWidth: number) {
  const cells = rows
    .map((row, index) => {
      const rule = index > 0 ? `border-top: 1px solid ${border}; ` : "";
      return `<tr>
    <td width="${labelWidth}" valign="top" style="padding: 10px 12px 10px 0; ${rule}font-size: 13px; line-height: 1.5; color: ${MUTED}">${row.label}</td>
    <td valign="top" style="padding: 10px 0; ${rule}font-size: 14px; line-height: 1.5; font-weight: 600; color: ${INK}; word-break: break-word">${row.value}</td>
  </tr>`;
    })
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px">
  <tr>
    <td bgcolor="${background}" style="padding: 4px 18px; background: ${background}; border: 1px solid ${border}; border-radius: 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  ${cells}
      </table>
    </td>
  </tr>
</table>`;
}

// Labelled details in the brand's tinted panel.
export const detailsPanel = (brand: EmailBrand, rows: { label: string; value: string }[]) =>
  panel(rows, brand.codeBackground, brand.codeBorder, 96);

// Labelled details in a neutral panel.
export const detailRows = (rows: { label: string; value: string }[]) => panel(rows, PANEL, LINE, 120);

// Ready-made cells under a row of headings, in a bordered panel; an emphasised
// row (the reader's own) is tinted. A column marked in `numeric` (amounts) is
// right-aligned.
export function dataTable(headings: string[], rows: { cells: string[]; emphasise?: boolean }[], numeric: boolean[] = []) {
  const align = (index: number) => (numeric[index] ? "right" : "left");
  const head = headings
    .map(
      (heading, index) =>
        `<th align="${align(index)}" bgcolor="${PANEL}" style="padding: 10px 12px; background: ${PANEL}; border-bottom: 1px solid ${LINE}; font-size: 11px; line-height: 1.4; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: ${MUTED}">${heading}</th>`,
    )
    .join("");
  const body = rows
    .map((row, rowIndex) => {
      const rule = rowIndex < rows.length - 1 ? `border-bottom: 1px solid ${LINE}; ` : "";
      const tint = row.emphasise ? "#fffbeb" : "#ffffff";
      const weight = row.emphasise ? "font-weight: 600; " : "";
      const cells = row.cells
        .map(
          (cell, index) =>
            `<td align="${align(index)}" valign="top" bgcolor="${tint}" style="padding: 10px 12px; background: ${tint}; ${rule}${weight}font-size: 14px; line-height: 1.4; color: ${INK}">${cell}</td>`,
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px; border: 1px solid ${LINE}; border-radius: 12px; border-collapse: separate; overflow: hidden">
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
</table>`;
}

export const finePrint = (html: string) =>
  `<p style="margin: 0 0 16px; font-size: 13px; line-height: 1.55; color: ${MUTED}">${html}</p>`;

// "Regards, / Pocket" under the message.
export const signOff = (brand: EmailBrand, greeting = "Regards,") =>
  `<p style="margin: 24px 0 0; font-size: 15px; line-height: 1.6; color: ${TEXT}">${escapeHtml(greeting)}<br><strong style="color: ${INK}">${escapeHtml(brand.name)}</strong></p>`;

export interface EmailLayout {
  brand: EmailBrand;
  title: string;
  // The grey line inboxes show beside the subject.
  preheader: string;
  body: string;
  // Why they got it, under the card.
  footer: string;
}

export function renderEmail({ brand, title, preheader, body, footer }: EmailLayout) {
  const [first, second] = brand.wordmark;
  const year = new Date().getFullYear();
  // Padding after the preheader, so inboxes don't fill the preview with the
  // start of the email.
  const previewPad = "&#8203;&nbsp;".repeat(40);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background: #f4f4f5; font-family: ${FONT}; -webkit-text-size-adjust: 100%">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0">${escapeHtml(preheader)}${previewPad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f5" style="background: #f4f4f5">
  <tr>
    <td align="center" style="padding: 32px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; border: 1px solid ${LINE}; border-radius: 16px; overflow: hidden; background: #ffffff; border-collapse: separate">
        <tr>
          <td bgcolor="${brand.headerColor}" style="padding: 20px 32px; background: ${brand.headerColor}; background-image: ${brand.headerGradient}">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td width="44" height="44" align="center" valign="middle" bgcolor="${brand.logoBackground}" style="width: 44px; height: 44px; background: ${brand.logoBackground}; border-radius: 10px">
                  <img src="cid:${LOGO_CID}" width="36" height="36" alt="${escapeHtml(brand.name)} logo" style="display: block; width: 36px; height: 36px; border: 0">
                </td>
                <td style="padding-left: 12px">
                  <div style="font-size: 20px; line-height: 1.2; font-weight: 800; letter-spacing: -0.3px; color: #ffffff">${escapeHtml(first)}<span style="color: ${brand.wordmarkAccent}">${escapeHtml(second)}</span></div>
                  <div style="margin-top: 2px; font-size: 12px; line-height: 1.4; color: #d4d4d8">${brand.tagline}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td height="3" bgcolor="${brand.stripe}" style="height: 3px; line-height: 3px; font-size: 0; background: ${brand.stripe}">&nbsp;</td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="padding: 32px; background: #ffffff">
            <h1 style="margin: 0 0 16px; font-size: 22px; line-height: 1.3; font-weight: 700; letter-spacing: -0.2px; color: ${INK}">${escapeHtml(title)}</h1>
            ${body}
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px">
        <tr>
          <td align="center" style="padding: 20px 24px 0; font-size: 12px; line-height: 1.6; color: ${MUTED}">
            ${footer}
            <div style="margin-top: 10px; color: #a1a1aa">&copy; ${year} ${escapeHtml(brand.name)} &middot; ${brand.tagline}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
