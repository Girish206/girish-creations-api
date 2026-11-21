import { prisma } from "../../lib/prisma";
import { BadRequestError, ForbiddenError, HttpError } from "../../utils/httpError";
import { isEmailEnabled } from "../../lib/email";
import { formatAmount, logActivity, namesOf } from "./activity.service";
import { noticeRecipients, sendNotices } from "./money-email";

// A nudge to someone who owes money, from the person they owe. One per pair
// (and group) a day, so it stays a reminder and not spam.
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface ReminderInput {
  fromAdminUserId: bigint; // owes the money
  toAdminUserId: bigint; // is owed it
  amountCents: number; // still owed, worked out by the caller
  group?: { id: bigint; name: string } | null;
}

// How long until this pair can be reminded again, in ms (0 = now).
export function reminderWait(lastSentAt: Date | null, now = Date.now()) {
  if (!lastSentAt) return 0;
  return Math.max(0, lastSentAt.getTime() + REMINDER_COOLDOWN_MS - now);
}

export async function sendReminder(input: ReminderInput, admin: { id: bigint; isSuperAdmin: boolean }) {
  // Only the person owed (or a super admin) asks for their own money.
  if (!admin.isSuperAdmin && admin.id !== input.toAdminUserId) {
    throw ForbiddenError("Only the person who's owed can send a reminder");
  }
  if (input.amountCents <= 0) throw BadRequestError("Nothing is owed between these two people");
  if (!isEmailEnabled()) {
    throw new HttpError(503, "Email isn't set up on the server yet, so this can't be sent.", "EMAIL_OFF");
  }
  const last = await prisma.activityLog.findFirst({
    where: {
      action: "reminder.sent",
      expenseGroupId: input.group?.id ?? null,
      involvedAdminUserIds: { hasEvery: [input.fromAdminUserId, input.toAdminUserId] },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const wait = reminderWait(last?.createdAt ?? null);
  if (wait > 0) {
    const hours = Math.ceil(wait / (60 * 60 * 1000));
    throw BadRequestError(`They were reminded recently. You can remind them again in ${hours} hour${hours === 1 ? "" : "s"}.`);
  }
  const [recipient] = await noticeRecipients([input.fromAdminUserId], input.toAdminUserId);
  if (!recipient) throw BadRequestError("They have no email address, so they can't be reminded");

  const name = await namesOf([input.fromAdminUserId, input.toAdminUserId, admin.id]);
  const amount = formatAmount(input.amountCents / 100);
  const owed = name(input.toAdminUserId);
  const where = input.group ? ` for ${input.group.name}` : " for daily splits";
  await sendNotices([input.fromAdminUserId], input.toAdminUserId, () => ({
    subject: `Reminder: ${amount} to ${owed}`,
    lines: [
      `${owed} sent you a reminder: you still owe them ${amount}${where}.`,
      "Once you've paid, they can mark it as received in Girish Creations.",
    ],
    details: [{ label: "Still owed", value: amount }],
    footer: "You're receiving this because someone you owe money to sent a reminder.",
    reference: `reminder-${input.group?.id ?? "daily"}-${input.fromAdminUserId}`,
  }));
  await logActivity({
    actorId: admin.id,
    action: "reminder.sent",
    summary: `Reminded ${name(input.fromAdminUserId)} about ${amount} owed to ${owed}${where}`,
    involved: [input.fromAdminUserId, input.toAdminUserId],
    expenseGroupId: input.group?.id ?? null,
  });
}
