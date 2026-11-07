import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertMayChangeAccount,
  isMoneyHubPerson,
  memberMayManage,
  planExistingAccount,
  welcomeEmailBlocker,
} from "./admin-user.service";

const member = { id: 5n, hasExpensesAccess: true, hasSavingsAccess: false };
const added = {
  createdByAdminUserId: 5n,
  isOwner: false,
  isSuperAdmin: false,
  hasPortfolioAccess: false,
  hasExpensesAccess: true,
  hasSavingsAccess: false,
};

test("a member manages someone they added", () => {
  assert.equal(memberMayManage(added, member), true);
  assert.equal(memberMayManage({ ...added, createdByAdminUserId: 6n }, member), false);
});

test("a member can't manage, or so sign in as, someone later given more than they have", () => {
  assert.equal(memberMayManage({ ...added, isSuperAdmin: true }, member), false);
  assert.equal(memberMayManage({ ...added, isOwner: true }, member), false);
  assert.equal(memberMayManage({ ...added, hasPortfolioAccess: true }, member), false);
  assert.equal(memberMayManage({ ...added, hasSavingsAccess: true }, member), false);
});

test("only the owner changes another super admin's account", () => {
  const owner = { id: 1n, isOwner: true };
  const otherSuperAdmin = { id: 2n, isOwner: false };
  const target = { id: 3n, isOwner: false, isSuperAdmin: true };
  assert.doesNotThrow(() => assertMayChangeAccount(target, owner));
  assert.throws(() => assertMayChangeAccount(target, otherSuperAdmin), /Only the owner/);
  assert.throws(() => assertMayChangeAccount({ ...target, isOwner: true }, otherSuperAdmin), /owner account/);
  assert.doesNotThrow(() => assertMayChangeAccount({ ...target, id: 2n }, otherSuperAdmin));
  assert.doesNotThrow(() => assertMayChangeAccount({ ...target, isSuperAdmin: false }, otherSuperAdmin));
});

test("a welcome email only goes to someone who can sign in", () => {
  const ready = { isActive: true, email: "a@example.com", passwordHash: "hash", welcomeEmailSentAt: null };
  assert.equal(welcomeEmailBlocker(ready), null);
  assert.match(welcomeEmailBlocker({ ...ready, isActive: false }) ?? "", /deactivated/);
  assert.match(welcomeEmailBlocker({ ...ready, email: null }) ?? "", /no email/);
  assert.match(welcomeEmailBlocker({ ...ready, passwordHash: null }) ?? "", /can't sign in/);
});

test("a welcome email can be sent again, but not straight away", () => {
  const sentAt = new Date("2026-01-01T00:00:00Z");
  const account = { isActive: true, email: "a@example.com", passwordHash: "hash", welcomeEmailSentAt: sentAt };
  assert.match(welcomeEmailBlocker(account, sentAt.getTime() + 15_000) ?? "", /another in 45 seconds/);
  assert.equal(welcomeEmailBlocker(account, sentAt.getTime() + 60_000), null);
});

const withAccount = {
  isActive: true,
  isOwner: false,
  isSuperAdmin: false,
  hasPortfolioAccess: false,
  hasExpensesAccess: false,
  hasSavingsAccess: false,
  passwordHash: "hash",
};
const superAdmin = { isSuperAdmin: true };

test("someone who already has an account is given access, or just listed", () => {
  assert.equal(planExistingAccount(withAccount, true, superAdmin), "grant");
  assert.equal(planExistingAccount(withAccount, false, superAdmin), "list");
});

test("only a super admin can add someone who already has an account", () => {
  assert.throws(() => planExistingAccount(withAccount, true, { isSuperAdmin: false }), /Ask a super admin/);
  assert.throws(() => planExistingAccount(withAccount, false, { isSuperAdmin: false }), /Ask a super admin/);
});

test("someone with admin access already is edited, not granted again", () => {
  const member = { ...withAccount, hasExpensesAccess: true, passwordHash: "hash" };
  assert.throws(() => planExistingAccount(member, true, superAdmin), /already has admin access/);
  assert.equal(planExistingAccount(member, false, superAdmin), "list");
});

test("access for another app is added to an account that already exists", () => {
  const moneyHubMember = { ...withAccount, hasExpensesAccess: true };
  const portfolioOnly = { ...withAccount, hasPortfolioAccess: true };
  assert.equal(planExistingAccount(moneyHubMember, true, superAdmin, { hasPortfolioAccess: true }), "grant");
  assert.equal(planExistingAccount(moneyHubMember, false, superAdmin, { hasPortfolioAccess: true }), "grant");
  assert.equal(planExistingAccount(portfolioOnly, false, superAdmin, { hasExpensesAccess: true }), "grant");
  assert.equal(planExistingAccount({ ...withAccount, passwordHash: null }, false, superAdmin, { hasSavingsAccess: true }), "grant");
});

test("someone who already has the access asked for is edited instead", () => {
  const portfolioOnly = { ...withAccount, hasPortfolioAccess: true };
  assert.throws(() => planExistingAccount(portfolioOnly, true, superAdmin, { hasPortfolioAccess: true }), /already has admin access/);
  assert.throws(() => planExistingAccount(portfolioOnly, false, superAdmin, { hasPortfolioAccess: true }), /already has admin access/);
});

test("a member can't add access to someone's existing account", () => {
  assert.throws(() => planExistingAccount(withAccount, false, { isSuperAdmin: false }, { hasExpensesAccess: true }), /Ask a super admin/);
});

test("a deactivated account has to be restored first", () => {
  assert.throws(() => planExistingAccount({ ...withAccount, isActive: false }, true, superAdmin), /deactivated/);
});

const noOne = {
  hasExpensesAccess: false,
  hasSavingsAccess: false,
  listedInAdmin: null,
  passwordHash: "hash",
  linkedRecords: 0,
};

test("an account that can only sign in isn't a Money Hub person", () => {
  assert.equal(isMoneyHubPerson(noOne), false);
});

test("Money Hub access, a guest, or being listed on purpose makes someone a Money Hub person", () => {
  assert.equal(isMoneyHubPerson({ ...noOne, hasExpensesAccess: true }), true);
  assert.equal(isMoneyHubPerson({ ...noOne, hasSavingsAccess: true }), true);
  assert.equal(isMoneyHubPerson({ ...noOne, passwordHash: null }), true);
  assert.equal(isMoneyHubPerson({ ...noOne, listedInAdmin: true }), true);
});

test("someone with money records stays visible after losing access", () => {
  assert.equal(isMoneyHubPerson({ ...noOne, linkedRecords: 3 }), true);
});
