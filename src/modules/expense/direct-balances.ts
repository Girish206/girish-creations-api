import { toCents } from "../../utils/money";

export interface PersonRef {
  id: bigint;
  name: string | null;
  email: string | null;
}

export interface DirectExpenseRow {
  paidBy: PersonRef;
  splitParticipants: { shareAmount: string; adminUser: PersonRef }[];
}

export interface DirectSettlementRow {
  amount: string;
  fromAdminUser: PersonRef;
  toAdminUser: PersonRef;
}

export interface DirectTransfer {
  fromAdminUserId: bigint;
  fromName: string;
  toAdminUserId: bigint;
  toName: string;
  amountCents: number;
}

const nameOf = (person: PersonRef) => person.name || person.email || "Unknown member";

// Ungrouped splits are settled pair by pair, not pooled like a trip group's:
// these people may have nothing else to do with one another, so nobody should
// be told to pay someone they never split anything with — and pooling would
// expose what each person's private splits add up to.
export function computeDirectTransfers(
  expenses: DirectExpenseRow[],
  settlements: DirectSettlementRow[],
): DirectTransfer[] {
  // Keyed lowest id first. Positive: the lower id owes the higher id.
  const pairs = new Map<string, { low: PersonRef; high: PersonRef; cents: number }>();
  const addDebt = (debtor: PersonRef, creditor: PersonRef, cents: number) => {
    if (debtor.id === creditor.id) return;
    const [low, high] = debtor.id < creditor.id ? [debtor, creditor] : [creditor, debtor];
    const key = `${low.id}-${high.id}`;
    const pair = pairs.get(key) ?? { low, high, cents: 0 };
    pair.cents += debtor.id === low.id ? cents : -cents;
    pairs.set(key, pair);
  };

  for (const expense of expenses) {
    for (const participant of expense.splitParticipants) {
      addDebt(participant.adminUser, expense.paidBy, toCents(participant.shareAmount));
    }
  }
  for (const settlement of settlements) {
    // Paying back reduces what the payer owes the receiver.
    addDebt(settlement.fromAdminUser, settlement.toAdminUser, -toCents(settlement.amount));
  }

  const transfers: DirectTransfer[] = [];
  for (const { low, high, cents } of pairs.values()) {
    if (cents === 0) continue;
    const [from, to] = cents > 0 ? [low, high] : [high, low];
    transfers.push({
      fromAdminUserId: from.id,
      fromName: nameOf(from),
      toAdminUserId: to.id,
      toName: nameOf(to),
      amountCents: Math.abs(cents),
    });
  }
  return transfers.sort((a, b) => b.amountCents - a.amountCents || a.fromName.localeCompare(b.fromName));
}
