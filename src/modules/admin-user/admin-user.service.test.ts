import assert from "node:assert/strict";
import { test } from "node:test";
import { planExistingAccount } from "./admin-user.service";

const runMitraPlayer = {
  isActive: true,
  isOwner: false,
  isSuperAdmin: false,
  hasPortfolioAccess: false,
  hasExpensesAccess: false,
  hasSavingsAccess: false,
  passwordHash: "hash",
};
const superAdmin = { isSuperAdmin: true };

test("a RunMitra player is given access, or just listed", () => {
  assert.equal(planExistingAccount(runMitraPlayer, true, superAdmin), "grant");
  assert.equal(planExistingAccount(runMitraPlayer, false, superAdmin), "list");
});

test("only a super admin can add someone who already has an account", () => {
  assert.throws(() => planExistingAccount(runMitraPlayer, true, { isSuperAdmin: false }), /Ask a super admin/);
  assert.throws(() => planExistingAccount(runMitraPlayer, false, { isSuperAdmin: false }), /Ask a super admin/);
});

test("someone with admin access already is edited, not granted again", () => {
  const member = { ...runMitraPlayer, hasExpensesAccess: true, passwordHash: "hash" };
  assert.throws(() => planExistingAccount(member, true, superAdmin), /already has admin access/);
  assert.equal(planExistingAccount(member, false, superAdmin), "list");
});

test("a deactivated account has to be restored first", () => {
  assert.throws(() => planExistingAccount({ ...runMitraPlayer, isActive: false }, true, superAdmin), /deactivated/);
});
