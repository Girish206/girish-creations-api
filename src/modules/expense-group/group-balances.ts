import { toCents } from "../../utils/money";
import { isSharedFund, type FundSplitRow } from "../savings-goal/fund-split";

export interface PersonRef {
  id: bigint;
  name: string | null;
  email: string | null;
}

export interface GroupExpenseRow {
  amount: string;
  paidBy: PersonRef;
  // Spent from a savings goal. A shared fund's expenses are settled through
  // the fund, so they count in the group's total but not its balances.
  savingsGoal?: { kind: string | null } | null;
  splitParticipants: { shareAmount: string; adminUser: PersonRef }[];
}

export interface GroupSettlementRow {
  amount: string;
  fromAdminUser: PersonRef;
  toAdminUser: PersonRef;
}

export interface MemberBalance {
  adminUserId: bigint;
  name: string;
  // What they paid out of pocket for the group's expenses.
  paidCents: number;
  // Their fair share: split portions, plus unsplit expenses they paid.
  shareCents: number;
  sentCents: number;
  receivedCents: number;
  // Groups linked to a shared fund: what they put into the fund, their part
  // of what was paid from it, and (for whoever keeps the fund) the money left
  // in it that they hold — negative when the fund was overspent.
  fundPutInCents: number;
  fundShareCents: number;
  fundHeldCents: number;
  // > 0: others still owe them this much. < 0: they still owe this much.
  pendingCents: number;
}

// A trip's shared fund, settled together with the trip: each person's fund
// split, and who keeps the fund's money.
export interface GroupFund {
  holder: PersonRef;
  split: FundSplitRow[];
}

// Where someone stands from the money alone, before any repayments.
export const owedFromMoney = (balance: MemberBalance) =>
  balance.paidCents - balance.shareCents + balance.fundPutInCents - balance.fundShareCents - balance.fundHeldCents;

export interface SuggestedTransfer {
  fromAdminUserId: bigint;
  fromName: string;
  toAdminUserId: bigint;
  toName: string;
  amountCents: number;
}

// Who pays whom: the first person owing clears the first person owed, and what's
// left of either moves on to the next. The order comes from the expenses alone,
// not from what's still pending, so a part payment only lowers its own row and
// nobody is moved on to paying someone else. Only changing an expense can change
// the pairs. The settle-up screen does the same (groupSettlement.ts on the client).
export function suggestTransfers(balances: MemberBalance[]): SuggestedTransfer[] {
  const fromExpenses = owedFromMoney;
  const byId = (a: MemberBalance, b: MemberBalance) =>
    a.adminUserId < b.adminUserId ? -1 : a.adminUserId > b.adminUserId ? 1 : 0;
  const creditors = balances
    .filter((balance) => balance.pendingCents > 0)
    .sort((a, b) => fromExpenses(b) - fromExpenses(a) || byId(a, b))
    .map((balance) => ({ ...balance, left: balance.pendingCents }));
  const debtors = balances
    .filter((balance) => balance.pendingCents < 0)
    .sort((a, b) => fromExpenses(a) - fromExpenses(b) || byId(a, b))
    .map((balance) => ({ ...balance, left: -balance.pendingCents }));

  const transfers: SuggestedTransfer[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const amountCents = Math.min(creditors[c].left, debtors[d].left);
    transfers.push({
      fromAdminUserId: debtors[d].adminUserId,
      fromName: debtors[d].name,
      toAdminUserId: creditors[c].adminUserId,
      toName: creditors[c].name,
      amountCents,
    });
    creditors[c].left -= amountCents;
    debtors[d].left -= amountCents;
    if (creditors[c].left === 0) c++;
    if (debtors[d].left === 0) d++;
  }
  return transfers;
}

// The most one person can repay another in a group: what's left on their row.
// Anything else would change who the others pay.
export function maxRepaymentCents(balances: MemberBalance[], fromId: bigint, toId: bigint) {
  const row = suggestTransfers(balances).find(
    (transfer) => transfer.fromAdminUserId === fromId && transfer.toAdminUserId === toId,
  );
  return row?.amountCents ?? 0;
}

// Worked out here rather than in the browser because expenses are private:
// each member only receives the ones they're part of, so a client-side sum
// would differ per person and could suggest the wrong repayments.
// With a linked fund, its money is netted in: put in counts like paying, a
// share of fund spending like any share, and whoever keeps the fund owes the
// group what's left in it (or is owed what it was overspent by).
export function summarizeGroup(
  expenses: GroupExpenseRow[],
  settlements: GroupSettlementRow[],
  fund: GroupFund | null = null,
) {
  const byId = new Map<bigint, MemberBalance>();
  const entry = (person: PersonRef) => {
    let balance = byId.get(person.id);
    if (!balance) {
      balance = {
        adminUserId: person.id,
        name: person.name || person.email || "Unknown member",
        paidCents: 0,
        shareCents: 0,
        sentCents: 0,
        receivedCents: 0,
        fundPutInCents: 0,
        fundShareCents: 0,
        fundHeldCents: 0,
        pendingCents: 0,
      };
      byId.set(person.id, balance);
    }
    return balance;
  };

  let totalCents = 0;
  for (const expense of expenses) {
    const amountCents = toCents(expense.amount);
    totalCents += amountCents;
    if (isSharedFund(expense.savingsGoal)) continue;
    entry(expense.paidBy).paidCents += amountCents;
    if (expense.splitParticipants.length > 0) {
      for (const participant of expense.splitParticipants) {
        entry(participant.adminUser).shareCents += toCents(participant.shareAmount);
      }
    } else {
      entry(expense.paidBy).shareCents += amountCents;
    }
  }

  if (fund) {
    for (const row of fund.split) {
      const balance = entry({ id: row.adminUserId, name: row.name, email: null });
      balance.fundPutInCents += row.putInCents;
      balance.fundShareCents += row.shareCents;
    }
    const leftCents = fund.split.reduce((sum, row) => sum + row.putInCents - row.shareCents, 0);
    if (fund.split.length > 0) entry(fund.holder).fundHeldCents += leftCents;
  }

  for (const settlement of settlements) {
    const cents = toCents(settlement.amount);
    entry(settlement.fromAdminUser).sentCents += cents;
    entry(settlement.toAdminUser).receivedCents += cents;
  }

  const balances = Array.from(byId.values());
  for (const balance of balances) {
    balance.pendingCents = owedFromMoney(balance) + balance.sentCents - balance.receivedCents;
  }
  // Biggest creditors first, then those who are square, then debtors.
  balances.sort((a, b) => b.pendingCents - a.pendingCents || a.name.localeCompare(b.name));
  return { balances, totalCents, expenseCount: expenses.length };
}
