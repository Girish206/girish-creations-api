import assert from "node:assert/strict";
import { test } from "node:test";
import { mayManageGroup, mayRunGroup } from "./expense-group.service";

const members = [1n, 2n];

test("the people in a group can change it", () => {
  assert.equal(mayManageGroup(members, { id: 1n, isSuperAdmin: false }), true);
  assert.equal(mayManageGroup(members, { id: 2n, isSuperAdmin: false }), true);
});

test("someone who only logged an expense in it can't, but a super admin can", () => {
  assert.equal(mayManageGroup(members, { id: 3n, isSuperAdmin: false }), false);
  assert.equal(mayManageGroup(members, { id: 3n, isSuperAdmin: true }), true);
});

test("an older group with no people recorded stays open to those who can see it", () => {
  assert.equal(mayManageGroup([], { id: 3n, isSuperAdmin: false }), true);
});

test("only the creator runs a group they're in", () => {
  const group = { createdByAdminUserId: 1n };
  assert.equal(mayRunGroup(group, members, { id: 1n, isSuperAdmin: false }), true);
  assert.equal(mayRunGroup(group, members, { id: 2n, isSuperAdmin: false }), false);
  assert.equal(mayRunGroup(group, members, { id: 3n, isSuperAdmin: true }), true);
});

test("with no creator in it, its people run it", () => {
  assert.equal(mayRunGroup({ createdByAdminUserId: null }, members, { id: 2n, isSuperAdmin: false }), true);
  assert.equal(mayRunGroup({ createdByAdminUserId: 9n }, members, { id: 2n, isSuperAdmin: false }), true);
  assert.equal(mayRunGroup({ createdByAdminUserId: 9n }, members, { id: 3n, isSuperAdmin: false }), false);
});
