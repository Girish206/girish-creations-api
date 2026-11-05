import { toCents } from "../../utils/money";

export interface PersonRef {
  id: bigint;
  name: string | null;
  email: string | null;
}

export interface GroupExpenseRow {
  amount: string;
  paidBy: PersonRef;
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
  // > 0: others still owe them this much. < 0: they still owe this much.
  pendingCents: number;
}

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
  const fromExpenses = (balance: MemberBalance) => balance.paidCents - balance.shareCents;
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
export function summarizeGroup(expenses: GroupExpenseRow[], settlements: GroupSettlementRow[]) {
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
    entry(expense.paidBy).paidCents += amountCents;
    if (expense.splitParticipants.length > 0) {
      for (const participant of expense.splitParticipants) {
        entry(participant.adminUser).shareCents += toCents(participant.shareAmount);
      }
    } else {
      entry(expense.paidBy).shareCents += amountCents;
    }
  }

  for (const settlement of settlements) {
    const cents = toCents(settlement.amount);
    entry(settlement.fromAdminUser).sentCents += cents;
    entry(settlement.toAdminUser).receivedCents += cents;
  }

  const balances = Array.from(byId.values());
  for (const balance of balances) {
    balance.pendingCents = balance.paidCents - balance.shareCents + balance.sentCents - balance.receivedCents;
  }
  // Biggest creditors first, then those who are square, then debtors.
  balances.sort((a, b) => b.pendingCents - a.pendingCents || a.name.localeCompare(b.name));
  return { balances, totalCents, expenseCount: expenses.length };
}
