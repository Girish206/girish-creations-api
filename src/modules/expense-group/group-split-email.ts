import type { EmailMessage } from "../../lib/email";
import {
  BRAND,
  dataTable,
  detailRows,
  escapeHtml,
  paragraph,
  renderSimpleEmail,
  sectionHeading,
  textLink,
} from "../../lib/email-layout";
import { maskEmail } from "../auth/auth-code";
import type { MemberBalance, SuggestedTransfer } from "./group-balances";

export interface SplitEmailGroup {
  id: bigint;
  name: string;
  totalCents: number;
  balances: MemberBalance[];
  transfers: SuggestedTransfer[];
}

export interface SplitEmailRecipient {
  id: bigint;
  email: string;
  name: string | null;
  // Can open the Money Hub, so the email can offer a link to it.
  canOpenApp: boolean;
}

export interface GroupPersonAccount {
  id: bigint;
  email: string | null;
  name: string | null;
  isActive: boolean;
  passwordHash: string | null;
  hasExpensesAccess: boolean;
}

// Who gets it, and who can't: no one without an address, or once deactivated.
export function splitEmailAudience(people: GroupPersonAccount[]) {
  const active = people.filter((person) => person.isActive);
  return {
    recipients: active.flatMap((person): SplitEmailRecipient[] =>
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
    ),
    noEmail: active.filter((person) => !person.email).map((person) => person.name || "Someone"),
  };
}

// Whole amounts stay compact ("₹500"), as they do in the app.
function formatCents(cents: number) {
  const digits = cents % 100 !== 0 ? 2 : 0;
  return (cents / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// A balance's name falls back to someone's address, which shouldn't go out in
// an email to everyone else in the group.
const safeName = (name: string) => (name.includes("@") ? maskEmail(name) : name);

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function balanceText(pendingCents: number) {
  if (pendingCents > 0) return `Gets ${formatCents(pendingCents)}`;
  if (pendingCents < 0) return `Owes ${formatCents(-pendingCents)}`;
  return "Settled";
}

// One per person. It shows what the settle-up screen shows, and never the
// individual expenses.
export function buildSplitEmail(
  group: SplitEmailGroup,
  recipient: SplitEmailRecipient,
  sentBy: string,
  appUrl?: string,
): EmailMessage {
  const brand = BRAND;
  const groupName = oneLine(group.name);
  const firstName = recipient.name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const sharedBy = safeName(sentBy);
  const intro =
    sharedBy === recipient.name?.trim() ? "Here is the group's split-up." : `${sharedBy} shared the group's split-up.`;
  const perHeadCents = group.balances.length > 0 ? Math.round(group.totalCents / group.balances.length) : 0;
  // Balances count repayments, so without this they wouldn't add up from the rest.
  const repaidCents = group.balances.reduce((sum, balance) => sum + balance.sentCents, 0);
  const details = [
    { label: "Group", value: groupName },
    { label: "Total expense", value: formatCents(group.totalCents) },
    { label: "Per head", value: formatCents(perHeadCents) },
    ...(repaidCents > 0 ? [{ label: "Repaid so far", value: formatCents(repaidCents) }] : []),
  ];
  const people = group.balances.map((balance) => ({
    isRecipient: balance.adminUserId === recipient.id,
    name: safeName(balance.name),
    paid: formatCents(balance.paidCents),
    share: formatCents(balance.shareCents),
    balance: balanceText(balance.pendingCents),
  }));
  const payments = group.transfers.map((transfer) => ({
    involvesRecipient: transfer.fromAdminUserId === recipient.id || transfer.toAdminUserId === recipient.id,
    from: safeName(transfer.fromName),
    to: safeName(transfer.toName),
    amount: formatCents(transfer.amountCents),
  }));
  const link = recipient.canOpenApp ? appUrl : undefined;

  return {
    fromName: brand.name,
    to: [{ address: recipient.email, name: recipient.name ?? undefined }],
    subject: `Split-up for ${groupName}`,
    clientReference: `group-split-${group.id}`,
    textBody: [
      greeting,
      "",
      intro,
      "",
      ...details.map((row) => `${row.label}: ${row.value}`),
      "",
      ...people.map((person) => `${person.name}: Paid ${person.paid}, Final share ${person.share}, ${person.balance}`),
      "",
      ...(payments.length
        ? ["Who pays whom:", ...payments.map((payment) => `${payment.from} pays ${payment.to} ${payment.amount}`)]
        : ["Everyone is settled."]),
      ...(link ? ["", `View in Girish Creations: ${link}`] : []),
      "",
      "Regards,",
      brand.name,
    ].join("\n"),
    htmlBody: renderSimpleEmail({
      preheader: `${groupName}: total expense ${formatCents(group.totalCents)}`,
      title: `Split-up for ${groupName}`,
      body: [
        paragraph(escapeHtml(greeting)),
        paragraph(escapeHtml(intro)),
        detailRows(details.map((row) => ({ label: row.label, value: escapeHtml(row.value) }))),
        dataTable(
          ["Name", "Paid", "Final share", "Balance"],
          people.map((person) => ({
            emphasise: person.isRecipient,
            cells: [person.name, person.paid, person.share, person.balance].map(escapeHtml),
          })),
        ),
        ...(payments.length
          ? [
              sectionHeading("Who pays whom"),
              dataTable(
                ["Pays", "Receives", "Amount"],
                payments.map((payment) => ({
                  emphasise: payment.involvesRecipient,
                  cells: [payment.from, payment.to, payment.amount].map(escapeHtml),
                })),
              ),
            ]
          : [paragraph("Everyone is settled.")]),
        ...(link ? [paragraph(textLink(brand, "View in Girish Creations", link))] : []),
        paragraph(`Regards,<br>${escapeHtml(brand.name)}`),
      ].join("\n"),
      footer: `You're receiving this because you're part of ${escapeHtml(groupName)}.`,
    }),
  };
}
