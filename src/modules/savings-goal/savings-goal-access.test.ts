import assert from "node:assert/strict";
import { test } from "node:test";
import { mayChangeContribution, mayManageGoal } from "./savings-goal.service";

const goal = { createdByAdminUserId: 1n, accountHolderAdminUserId: 2n };
const as = (id: bigint, isSuperAdmin = false) => ({ id, isSuperAdmin });

test("the creator, account holder or a super admin manages a goal", () => {
  assert.equal(mayManageGoal(goal, as(1n)), true);
  assert.equal(mayManageGoal(goal, as(2n)), true);
  assert.equal(mayManageGoal(goal, as(9n, true)), true);
});

test("someone it's only shared with doesn't", () => {
  assert.equal(mayManageGoal(goal, as(3n)), false);
});

test("an older goal with no creator or holder stays manageable", () => {
  const older = { createdByAdminUserId: null, accountHolderAdminUserId: null };
  assert.equal(mayManageGoal(older, as(3n)), true);
  assert.equal(mayManageGoal({ ...older, accountHolderAdminUserId: 2n }, as(3n)), false);
});

test("a member only handles their own contributions", () => {
  assert.equal(mayChangeContribution(goal, 3n, as(3n)), true);
  assert.equal(mayChangeContribution(goal, 4n, as(3n)), false);
});

test("whoever manages the goal can handle anyone's", () => {
  assert.equal(mayChangeContribution(goal, 4n, as(1n)), true);
  assert.equal(mayChangeContribution(goal, 4n, as(2n)), true);
  assert.equal(mayChangeContribution(goal, 4n, as(9n, true)), true);
});
