import { env } from "../../config/env";
import { EmailError, isEmailEnabled, sendEmail, type EmailMessage } from "../../lib/email";
import { BRAND, detailRows, escapeHtml, paragraph, renderSimpleEmail, textLink } from "../../lib/email-layout";
import { prisma } from "../../lib/prisma";

export interface NoticeRecipient {
  id: bigint;
  email: string;
  name: string | null;
  // Can open the Money Hub, so the email can link to it.
  canOpenApp: boolean;
}

export interface Notice {
  subject: string;
  // Plain sentences, shown as paragraphs.
  lines: string[];
  details?: { label: string; value: string }[];
  // Why they got it, under the email.
  footer: string;
  reference: string;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function buildNoticeEmail(notice: Notice, recipient: NoticeRecipient, appUrl?: string): EmailMessage {
  const firstName = recipient.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const lines = notice.lines.map(oneLine);
  const details = notice.details ?? [];
  const link = recipient.canOpenApp ? appUrl : undefined;
  return {
    fromName: BRAND.name,
    to: [{ address: recipient.email, name: recipient.name ?? undefined }],
    subject: oneLine(notice.subject),
    clientReference: notice.reference,
    textBody: [
      greeting,
      "",
      ...lines.flatMap((line) => [line, ""]),
      ...details.map((row) => `${row.label}: ${row.value}`),
      ...(link ? ["", `Open Girish Creations: ${link}`] : []),
      "",
      "Regards,",
      BRAND.name,
    ].join("\n"),
    htmlBody: renderSimpleEmail({
      preheader: lines[0] ?? notice.subject,
      title: oneLine(notice.subject),
      body: [
        paragraph(escapeHtml(greeting)),
        ...lines.map((line) => paragraph(escapeHtml(line))),
        ...(details.length
          ? [detailRows(details.map((row) => ({ label: row.label, value: escapeHtml(row.value) })))]
          : []),
        ...(link ? [paragraph(textLink(BRAND, "Open Girish Creations", link))] : []),
        paragraph(`Regards,<br>${escapeHtml(BRAND.name)}`),
      ].join("\n"),
      footer: escapeHtml(notice.footer),
    }),
  };
}

// Who can be emailed out of these people: active, with an address, and not
// the person who made the change (they know already).
export async function noticeRecipients(ids: bigint[], exceptId: bigint): Promise<NoticeRecipient[]> {
  const wanted = [...new Set(ids)].filter((id) => id !== exceptId);
  if (wanted.length === 0) return [];
  const people = await prisma.adminUser.findMany({
    where: { id: { in: wanted }, isActive: true },
    select: { id: true, email: true, name: true, passwordHash: true, hasExpensesAccess: true },
  });
  return people.flatMap((person) =>
    person.email
      ? [
          {
            id: person.id,
            email: person.email,
            name: person.name,
            canOpenApp: person.passwordHash !== null && person.hasExpensesAccess,
          },
        ]
      : [],
  );
}

// Lets people know about money that concerns them. A change has already been
// saved by now, so an email that can't go out is only logged.
export async function sendNotices(
  ids: bigint[],
  exceptId: bigint,
  noticeFor: (recipient: NoticeRecipient) => Notice | null,
) {
  if (!isEmailEnabled()) return;
  try {
    const recipients = await noticeRecipients(ids, exceptId);
    const messages = recipients.flatMap((recipient) => {
      const notice = noticeFor(recipient);
      return notice ? [buildNoticeEmail(notice, recipient, env.adminSignInUrl)] : [];
    });
    const results = await Promise.allSettled(messages.map((message) => sendEmail(message)));
    for (const result of results) {
      if (result.status === "rejected") {
        const error = result.reason as unknown;
        const reason = error instanceof EmailError ? `${error.code}: ${error.message}` : error;
        console.error("Couldn't send a Money Hub notice:", reason);
      }
    }
  } catch (error) {
    console.error("Couldn't send Money Hub notices:", error);
  }
}
