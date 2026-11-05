import type { InlineImage } from "./email";
import { GIRISH_CREATIONS_LOGO, RUNMITRA_LOGO } from "./email-logos";
import type { AuthApp } from "../types/express";

// The layouts behind every email: renderEmail for the welcome email, dressed in
// the brand of the app it's from, and renderSimpleEmail for everything else.
// Email clients are far behind browsers: Outlook ignores gradients and most CSS,
// so it's tables and inline styles, with a solid colour under every gradient.
// The name beside the logo is text, so the brand still shows if images are blocked.

export interface EmailBrand {
  name: string;
  // The two-tone logo, e.g. "Run" + "Mitra".
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
}

export const BRANDS: Record<AuthApp, EmailBrand> = {
  admin: {
    name: "Girish Creations",
    wordmark: ["Girish", "Creations"],
    tagline: "Portfolio &amp; Pocket",
    logo: GIRISH_CREATIONS_LOGO,
    headerGradient: "linear-gradient(120deg, #7c3aed 0%, #4f46e5 55%, #0284c7 100%)",
    headerColor: "#4f46e5",
    wordmarkAccent: "#a5f3fc",
    accent: "#4f46e5",
    codeBackground: "#eef2ff",
    codeBorder: "#c7d2fe",
  },
  cricket: {
    name: "RunMitra",
    wordmark: ["Run", "Mitra"],
    tagline: "Every ball. Every stat.",
    logo: RUNMITRA_LOGO,
    headerGradient: "linear-gradient(120deg, #3a1214 0%, #5a1d1c 55%, #7a2420 100%)",
    headerColor: "#5a1d1c",
    wordmarkAccent: "#ffcd00",
    accent: "#7a2420",
    codeBackground: "#fff8e1",
    codeBorder: "#ffe082",
  },
};

const LOGO_CID = "brand-logo";

// An email built with renderEmail has to carry this, or its logo won't show.
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

// Blocks of ready-made HTML: whoever builds one escapes what goes in it.
export const paragraph = (html: string) =>
  `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #374151">${html}</p>`;

export function codeBlock(brand: EmailBrand, code: string, caption: string) {
  return `<p style="margin: 0 0 16px">
  <span style="font-family: 'SF Mono', Menlo, Consolas, 'Courier New', monospace; font-size: 26px; font-weight: 700; letter-spacing: 4px; color: ${brand.accent}">${escapeHtml(code)}</span><br>
  <span style="font-size: 13px; color: #6b7280">${caption}</span>
</p>`;
}

export function button(brand: EmailBrand, label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 4px 0 20px">
  <tr>
    <td bgcolor="${brand.accent}" style="border-radius: 8px; background: ${brand.accent}">
      <a href="${escapeHtml(href)}" style="display: inline-block; padding: 12px 22px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

export const textLink = (brand: EmailBrand, label: string, href: string) =>
  `<a href="${escapeHtml(href)}" style="color: ${brand.accent}">${escapeHtml(label)}</a>`;

// Someone's own words, set apart from what we're saying.
export function quote(text: string) {
  const html = escapeHtml(text).replace(/\r?\n/g, "<br>");
  return `<p style="margin: 0 0 16px; padding-left: 12px; border-left: 3px solid #d1d5db; font-size: 15px; line-height: 1.6; color: #111827; word-break: break-word">${html}</p>`;
}

export const sectionHeading = (html: string) =>
  `<h2 style="margin: 24px 0 10px; font-size: 13px; line-height: 1.4; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #6b7280">${html}</h2>`;

// A title with a line about it, one under another.
export function featureList(brand: EmailBrand, items: { title: string; description: string }[]) {
  const rows = items
    .map(
      (item) => `<tr>
    <td width="20" valign="top" style="padding: 7px 0; font-size: 15px; line-height: 1.5; font-weight: 700; color: ${brand.accent}">&#10003;</td>
    <td style="padding: 7px 0; font-size: 15px; line-height: 1.5; color: #374151"><strong style="color: #111827">${item.title}</strong><br>${item.description}</td>
  </tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 8px">
  ${rows}
</table>`;
}

// Labelled details in a tinted panel.
export function detailsPanel(brand: EmailBrand, rows: { label: string; value: string }[]) {
  const cells = rows
    .map(
      (row) => `<tr>
    <td width="88" valign="top" style="padding: 5px 0; font-size: 13px; line-height: 1.5; color: #6b7280">${row.label}</td>
    <td style="padding: 5px 0; font-size: 14px; line-height: 1.5; color: #111827; word-break: break-word">${row.value}</td>
  </tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px">
  <tr>
    <td bgcolor="${brand.codeBackground}" style="padding: 12px 16px; background: ${brand.codeBackground}; border: 1px solid ${brand.codeBorder}; border-radius: 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  ${cells}
      </table>
    </td>
  </tr>
</table>`;
}

// Labelled details with nothing around them.
export function detailRows(rows: { label: string; value: string }[]) {
  const cells = rows
    .map(
      (row) => `<tr>
    <td width="110" valign="top" style="padding: 2px 0; font-size: 14px; line-height: 1.5; color: #6b7280">${row.label}</td>
    <td style="padding: 2px 0; font-size: 14px; line-height: 1.5; color: #111827; word-break: break-word">${row.value}</td>
  </tr>`,
    )
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 16px">
  ${cells}
</table>`;
}

// Ready-made cells under a row of headings, with thin rules between the rows.
export function dataTable(headings: string[], rows: { cells: string[]; emphasise?: boolean }[]) {
  const edge = "border-bottom: 1px solid #e5e7eb";
  const head = headings
    .map(
      (heading) =>
        `<th align="left" style="padding: 6px 8px 6px 0; ${edge}; font-size: 13px; font-weight: 600; color: #6b7280">${heading}</th>`,
    )
    .join("");
  const body = rows
    .map((row) => {
      const weight = row.emphasise ? "font-weight: 600; " : "";
      const cells = row.cells
        .map((cell) => `<td valign="top" style="padding: 6px 8px 6px 0; ${edge}; ${weight}font-size: 14px; line-height: 1.4; color: #111827">${cell}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 16px; border-collapse: collapse">
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
</table>`;
}

export const finePrint = (html: string) =>
  `<p style="margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: #6b7280">${html}</p>`;

export interface SimpleEmailLayout {
  title: string;
  // The grey line inboxes show beside the subject.
  preheader: string;
  body: string;
  // Why they got it, under the message.
  footer: string;
}

// Every email but the welcome: a plain message, with no logo, header or card.
export function renderSimpleEmail({ title, preheader, body, footer }: SimpleEmailLayout) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background: #ffffff; font-family: ${FONT}">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px">
  <tr>
    <td style="padding: 12px 16px">
      <h1 style="margin: 0 0 12px; font-size: 18px; line-height: 1.3; font-weight: 600; color: #111827">${escapeHtml(title)}</h1>
      ${body}
      <p style="margin: 16px 0 0; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 12px; line-height: 1.5; color: #6b7280">${footer}</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// The welcome email's layout, with the app's logo and header.
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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: ${FONT}">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background: #f3f4f6">
  <tr>
    <td align="center" style="padding: 24px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; border-radius: 16px; overflow: hidden; background: #ffffff">
        <tr>
          <td bgcolor="${brand.headerColor}" style="padding: 24px 28px; background: ${brand.headerColor}; background-image: ${brand.headerGradient}">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td width="52" height="52" align="center" valign="middle" bgcolor="#ffffff" style="width: 52px; height: 52px; background: #ffffff; border-radius: 12px">
                  <img src="cid:${LOGO_CID}" width="44" height="44" alt="${escapeHtml(brand.name)} logo" style="display: block; width: 44px; height: 44px; border: 0">
                </td>
                <td style="padding-left: 14px">
                  <div style="font-size: 22px; line-height: 1.2; font-weight: 800; letter-spacing: -0.3px; color: #ffffff">${escapeHtml(first)}<span style="color: ${brand.wordmarkAccent}">${escapeHtml(second)}</span></div>
                  <div style="margin-top: 2px; font-size: 13px; color: #f3f4f6">${brand.tagline}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="padding: 28px; background: #ffffff">
            <h1 style="margin: 0 0 14px; font-size: 21px; line-height: 1.3; font-weight: 700; color: #111827">${escapeHtml(title)}</h1>
            ${body}
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px">
        <tr>
          <td align="center" style="padding: 16px 20px 0; font-size: 12px; line-height: 1.5; color: #6b7280">${footer}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
