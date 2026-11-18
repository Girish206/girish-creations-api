import { BadRequestError } from "../../utils/httpError";
import { toCents } from "../../utils/money";

export interface SplitShare {
  adminUserId: bigint;
  shareAmount: string;
}

// The people sharing an expense equally, nobody twice. The payer is listed
// first when they're sharing it (the first few people absorb any leftover
// paise), and may be left out, for an expense they covered for the others.
// A "split" with nobody but the payer in it is no split at all.
export function normalizeSplit(adminUserIds: bigint[], payerId: bigint): bigint[] {
  const unique = [...new Set(adminUserIds)];
  const ids = unique.includes(payerId) ? [payerId, ...unique.filter((id) => id !== payerId)] : unique;
  return ids.length === 0 || (ids.length === 1 && ids[0] === payerId) ? [] : ids;
}

// Splits `amount` (a decimal string) equally across `adminUserIds`, in
// integer cents, distributing any leftover cent(s) one-by-one to the first
// few participants so the shares always sum to exactly `amount`.
export function computeEqualShares(amount: string, adminUserIds: bigint[]): SplitShare[] {
  const totalCents = toCents(amount);
  const count = adminUserIds.length;
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;

  return adminUserIds.map((adminUserId, index) => {
    const cents = baseCents + (index < remainder ? 1 : 0);
    return { adminUserId, shareAmount: (cents / 100).toFixed(2) };
  });
}

// A custom split must add up to the expense exactly. Nobody may appear twice,
// zero shares are dropped (that person just isn't sharing it), and if only the
// payer is left it's no split at all. The payer may be left out, for an
// expense they covered entirely for someone else.
export function resolveCustomShares(shares: SplitShare[], amount: string, payerId: bigint): SplitShare[] {
  const ids = shares.map((share) => share.adminUserId);
  if (new Set(ids).size !== ids.length) {
    throw BadRequestError("Each person can only have one share of an expense");
  }
  const totalCents = shares.reduce((sum, share) => sum + toCents(share.shareAmount), 0);
  if (totalCents !== toCents(amount)) {
    throw BadRequestError(
      `The shares add up to ${(totalCents / 100).toFixed(2)}, but the expense is ${toCents(amount) / 100 === 0 ? "0.00" : (toCents(amount) / 100).toFixed(2)}`,
    );
  }
  const kept = shares.filter((share) => toCents(share.shareAmount) > 0);
  return kept.length === 1 && kept[0].adminUserId === payerId ? [] : kept;
}
