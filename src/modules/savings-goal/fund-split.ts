import { toCents } from "../../utils/money";

export interface PersonRef {
  id: bigint;
  name: string | null;
  email: string | null;
}

export interface FundExpenseRow {
  amount: string;
  splitParticipants: { shareAmount: string; adminUser: PersonRef }[];
}

export interface FundContributionRow {
  amount: string;
  contributedBy: PersonRef;
}

export interface FundSplitRow {
  adminUserId: bigint;
  name: string;
  // What they put into the fund.
  putInCents: number;
  // Their part of everything paid from it.
  shareCents: number;
  // putIn - share. > 0: they get this back. < 0: they still owe the fund this.
  balanceCents: number;
}

export const FUND_KIND = "fund";

// A goal used as a shared fund ("Bandihole Trip"): money is collected into
// it up front, expenses are paid from it, and at the end each person gets
// back what they put in less their share, or tops up if it ran short.
export const isSharedFund = (goal: { kind: string | null } | null | undefined) => goal?.kind === FUND_KIND;

const nameOf = (person: PersonRef) => person.name || person.email || "Unknown member";

// Everyone on a shared fund, in display order: who made it, who keeps it, who
// it's shared with, then anyone else who put money in.
export function fundPeople(goal: {
  createdBy: PersonRef | null;
  accountHolder: PersonRef | null;
  members: { adminUser: PersonRef }[];
  contributions: { contributedBy: PersonRef }[];
}): PersonRef[] {
  return [
    goal.createdBy,
    goal.accountHolder,
    ...goal.members.map((member) => member.adminUser),
    ...goal.contributions.map((contribution) => contribution.contributedBy),
  ].filter((person, index, all): person is PersonRef =>
    Boolean(person) && all.findIndex((other) => other?.id === person!.id) === index,
  );
}

// `people` is everyone on the fund, in display order. An expense with a split
// is shared as split; one without is shared equally by all of them, with any
// leftover paise going to the first few, the same as an equal split.
export function computeFundSplit(
  people: PersonRef[],
  contributions: FundContributionRow[],
  expenses: FundExpenseRow[],
): FundSplitRow[] {
  const rows = new Map<bigint, FundSplitRow>();
  const row = (person: PersonRef) => {
    let found = rows.get(person.id);
    if (!found) {
      found = { adminUserId: person.id, name: nameOf(person), putInCents: 0, shareCents: 0, balanceCents: 0 };
      rows.set(person.id, found);
    }
    return found;
  };
  people.forEach(row);

  for (const contribution of contributions) {
    row(contribution.contributedBy).putInCents += toCents(contribution.amount);
  }
  for (const expense of expenses) {
    if (expense.splitParticipants.length > 0) {
      for (const participant of expense.splitParticipants) {
        row(participant.adminUser).shareCents += toCents(participant.shareAmount);
      }
      continue;
    }
    if (people.length === 0) continue;
    const totalCents = toCents(expense.amount);
    const base = Math.floor(totalCents / people.length);
    const remainder = totalCents - base * people.length;
    people.forEach((person, index) => {
      row(person).shareCents += base + (index < remainder ? 1 : 0);
    });
  }

  const result = Array.from(rows.values());
  for (const entry of result) entry.balanceCents = entry.putInCents - entry.shareCents;
  return result;
}
