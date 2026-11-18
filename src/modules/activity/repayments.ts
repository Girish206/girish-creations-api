import { formatAmount, logActivity, namesOf } from "./activity.service";
import { sendNotices } from "./money-email";

interface Actor {
  id: bigint;
  isSuperAdmin: boolean;
}

// Logs a repayment being marked or removed, and tells the other side of it,
// so a debt can't be cleared or brought back without them knowing.
export async function recordRepayment(
  change: "added" | "removed",
  settlement: { amount: string; fromAdminUserId: bigint; toAdminUserId: bigint },
  admin: Actor,
  group?: { id: bigint; name: string },
) {
  const name = await namesOf([admin.id, settlement.fromAdminUserId, settlement.toAdminUserId]);
  const amount = formatAmount(settlement.amount);
  const where = group ? ` in ${group.name}` : " for daily splits";
  const pair = `${name(settlement.fromAdminUserId)} to ${name(settlement.toAdminUserId)}`;
  await logActivity({
    actorId: admin.id,
    action: change === "added" ? "settlement.added" : "settlement.removed",
    summary:
      change === "added"
        ? `Marked ${amount} as paid, ${pair}${where}`
        : `Removed a repayment of ${amount}, ${pair}${where}`,
    involved: [settlement.fromAdminUserId, settlement.toAdminUserId],
    expenseGroupId: group?.id ?? null,
  });
  await sendNotices([settlement.fromAdminUserId, settlement.toAdminUserId], admin.id, (recipient) => {
    const youPaid = recipient.id === settlement.fromAdminUserId;
    const other = name(youPaid ? settlement.toAdminUserId : settlement.fromAdminUserId);
    const actor = name(admin.id);
    let line: string;
    if (change === "added") {
      line = youPaid
        ? `${actor} marked the ${amount} you paid ${other}${where} as received.`
        : `${actor} recorded ${other} paying you ${amount}${where}.`;
    } else {
      line = youPaid
        ? `${actor} removed the ${amount} you paid ${other}${where}, so it counts as owed again.`
        : `${actor} removed ${other}'s repayment of ${amount}${where}, so it counts as owed to you again.`;
    }
    return {
      subject: change === "added" ? `Repayment of ${amount} recorded` : `Repayment of ${amount} removed`,
      lines: [line, "If that's not right, open Girish Creations to check."],
      footer: "You're receiving this because the repayment is between you and someone else.",
      reference: `repayment-${change}`,
    };
  });
}
