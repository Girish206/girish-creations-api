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

// The most one person can repay another in a group: what the payer still owes,
// up to what the other is still owed. More would flip who owes whom.
export function maxRepaymentCents(balances: MemberBalance[], fromId: bigint, toId: bigint) {
  const pendingOf = (id: bigint) => balances.find((balance) => balance.adminUserId === id)?.pendingCents ?? 0;
  return Math.max(0, Math.min(-pendingOf(fromId), pendingOf(toId)));
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
