import type { EmailMessage } from "../../lib/email";
import { BRANDS, button, escapeHtml, finePrint, logoImages, paragraph, quote, renderEmail } from "../../lib/email-layout";

export interface ContactEmailInput {
  id: bigint;
  name: string;
  email: string;
  subject: string;
  message: string;
}

// To the portfolio's owner. It comes from our own address, since mail claiming
// to be from the visitor's would fail spam checks, and replying goes straight
// to the visitor. Everything in `contact` is typed by an anonymous visitor.
export function buildContactEmail(contact: ContactEmailInput, owner: { address: string; name: string }): EmailMessage {
  const brand = BRANDS.admin;
  const subject = contact.subject.replace(/\s+/g, " ").trim();
  const firstName = owner.name.trim().split(/\s+/)[0];
  const replyLink = `mailto:${encodeURIComponent(contact.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(`Re: ${subject}`)}`;
  return {
    fromName: brand.name,
    to: [owner],
    replyTo: { address: contact.email, name: contact.name },
    subject: `New portfolio message: ${subject}`,
    inlineImages: logoImages(brand),
    clientReference: `contact-${contact.id}`,
    textBody: [
      `Hi ${firstName},`,
      "",
      `${contact.name} (${contact.email}) sent a message through your portfolio.`,
      "",
      `Subject: ${subject}`,
      "",
      contact.message,
      "",
      "Reply to this email to answer them. The message is also saved in your admin panel.",
      "",
      "- Girish Creations",
    ].join("\n"),
    htmlBody: renderEmail({
      brand,
      title: "You have a new message",
      preheader: `${contact.name}: ${subject}`,
      body: [
        paragraph(`Hi ${escapeHtml(firstName)},`),
        paragraph(
          `<strong>${escapeHtml(contact.name)}</strong> (${escapeHtml(contact.email)}) sent a message through your portfolio.`,
        ),
        paragraph(`<strong>Subject:</strong> ${escapeHtml(subject)}`),
        quote(brand, contact.message),
        button(brand, `Reply to ${contact.name}`, replyLink),
        finePrint("You can also just reply to this email. The message is saved in your admin panel too."),
      ].join("\n"),
      footer: "You're getting this because someone used the contact form on your portfolio.",
    }),
  };
}
