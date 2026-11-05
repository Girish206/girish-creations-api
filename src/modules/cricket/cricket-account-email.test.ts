import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { signUpHandler } from "./cricket.controller";
import { isCricketOnly, signUp, updateMyProfile } from "./cricket.service";

type Row = Record<string, unknown>;

// Prisma's client hides its methods from node:test's mock.method, so they're
// replaced directly. Each test file runs in its own process, so this can't
// leak. The check stops the test if an upgrade makes this quietly do nothing,
// rather than letting it go on to write to a real database.
function stub(target: object, method: string, impl: (arg: { data: Row; where: Row }) => unknown) {
  const object = target as Record<string, unknown>;
  object[method] = impl;
  assert.equal(object[method], impl, `couldn't stub ${method}`);
}

// Stands in for the database: nothing in this file reaches it.
function stubDb(rows: { byId?: Row; byMobile?: Row; byEmail?: Row; player?: Row } = {}) {
  const created: Row[] = [];
  const updated: Row[] = [];
  const clearedCodes: Row[] = [];
  stub(prisma.adminUser, "findFirst", () => rows.byMobile ?? null);
  stub(prisma.adminUser, "findUnique", ({ where }) => (where.email ? rows.byEmail : rows.byId) ?? null);
  stub(prisma.adminUser, "create", ({ data }) => {
    created.push(data);
    return { id: 1n, ...data };
  });
  stub(prisma.adminUser, "update", ({ data }) => {
    updated.push(data);
    return { id: 1n, ...data };
  });
  stub(prisma.cricketPlayer, "findFirst", () => rows.player ?? null);
  stub(prisma.cricketPlayer, "create", () => ({}));
  stub(prisma.cricketPlayer, "update", () => ({}));
  stub(prisma.authCode, "deleteMany", ({ where }) => {
    clearedCodes.push(where);
    return { count: 1 };
  });
  stub(prisma, "$runCommandRaw", () => ({ value: { count: 1 } }));
  return { created, updated, clearedCodes };
}

const newPlayer = { name: "Ravi Kumar", mobile: "9876543210", password: "long-enough" };

test("signing up saves the email given", async () => {
  const { created } = stubDb();
  await signUp({ ...newPlayer, email: "ravi@example.com" });
  assert.equal(created[0].email, "ravi@example.com");
});

test("the email can be left out", async () => {
  const { created } = stubDb();
  await signUp(newPlayer);
  assert.equal(created.length, 1);
  assert.equal(created[0].email, undefined);
});

test("an email another account uses is refused, and nothing is created", async () => {
  const { created } = stubDb({ byEmail: { id: 2n, email: "ravi@example.com" } });
  await assert.rejects(signUp({ ...newPlayer, email: "ravi@example.com" }), /already uses this email/);
  assert.equal(created.length, 0);
});

test("claiming an invite saves the email given", async () => {
  const { created } = stubDb({ player: { id: 5n, name: "Ravi Kumar", inviteCode: "123456" } });
  await signUp({ mobile: newPlayer.mobile, password: newPlayer.password, inviteCode: "123456", email: "ravi@example.com" });
  assert.equal(created[0].email, "ravi@example.com");
});

test("a wrong invite code doesn't attach an email", async () => {
  const { created } = stubDb({ player: { id: 5n, name: "Ravi Kumar", inviteCode: "123456" } });
  await assert.rejects(
    signUp({ mobile: newPlayer.mobile, password: newPlayer.password, inviteCode: "000000", email: "ravi@example.com" }),
    /invite code/,
  );
  assert.equal(created.length, 0);
});

test("an account that already has an email keeps it", async () => {
  const existing = { id: 3n, name: "Ravi", email: "old@example.com", passwordHash: null, isActive: true };
  const { updated } = stubDb({
    byMobile: existing,
    // The new address is taken too, which must not matter: it isn't being saved.
    byEmail: { id: 9n, email: "new@example.com" },
    player: { id: 5n, name: "Ravi", inviteCode: "123456" },
  });
  await signUp({ mobile: newPlayer.mobile, password: newPlayer.password, inviteCode: "123456", email: "new@example.com" });
  assert.equal(updated[0].email, undefined);
});

test("the API trims and lowercases the email, since sign-in looks it up in lowercase", async () => {
  const { created } = stubDb();
  let status = 0;
  const res = { status: (code: number) => ((status = code), res), json: () => res } as unknown as Response;
  await signUpHandler({ body: { ...newPlayer, email: "  Ravi@Example.COM " } } as Request, res);
  assert.equal(status, 201);
  assert.equal(created[0].email, "ravi@example.com");
});

test("the API refuses an email that isn't one", async () => {
  stubDb();
  const res = {} as Response;
  await assert.rejects(signUpHandler({ body: { ...newPlayer, email: "not-an-email" } } as Request, res), /valid email/);
});

// ---- My Profile

const myAccount = async (email: string | null = null) => ({
  id: 7n,
  name: "Ravi Kumar",
  mobile: "9876543210",
  email,
  passwordHash: await bcrypt.hash("right-password", 4),
});
const profile = { name: "Ravi Kumar", mobile: "9876543210" };

test("a profile can add an email with the current password, and old codes stop working", async () => {
  const { updated, clearedCodes } = stubDb({ byId: await myAccount() });
  await updateMyProfile(7n, { ...profile, email: "ravi@example.com", currentPassword: "right-password" });
  assert.equal(updated[0].email, "ravi@example.com");
  assert.deepEqual(clearedCodes, [{ adminUserId: 7n }]);
});

test("changing the email without the right password is refused", async () => {
  const { updated, clearedCodes } = stubDb({ byId: await myAccount("old@example.com") });
  for (const currentPassword of [undefined, "wrong-password"]) {
    await assert.rejects(updateMyProfile(7n, { ...profile, email: "new@example.com", currentPassword }), /current password/);
  }
  assert.equal(updated.length, 0);
  assert.equal(clearedCodes.length, 0);
});

test("a profile can't take an email another account uses", async () => {
  const { updated } = stubDb({ byId: await myAccount(), byEmail: { id: 9n, email: "new@example.com" } });
  await assert.rejects(
    updateMyProfile(7n, { ...profile, email: "new@example.com", currentPassword: "right-password" }),
    /already uses this email/,
  );
  assert.equal(updated.length, 0);
});

test("other profile edits don't need the password, and leave the email and codes alone", async () => {
  const { updated, clearedCodes } = stubDb({ byId: await myAccount("old@example.com") });
  await updateMyProfile(7n, { ...profile, name: "Ravi K" });
  assert.equal(updated[0].email, undefined);
  assert.equal(clearedCodes.length, 0);
});

test("sending the email they already have isn't a change", async () => {
  // It would clash with itself if this looked it up.
  const { updated, clearedCodes } = stubDb({ byId: await myAccount("old@example.com"), byEmail: { id: 7n } });
  await updateMyProfile(7n, { ...profile, email: "old@example.com" });
  assert.equal(updated.length, 1);
  assert.equal(clearedCodes.length, 0);
});

// ---- Who counts as cricket-only

const noAccess = {
  isOwner: false,
  isSuperAdmin: false,
  hasPortfolioAccess: false,
  hasExpensesAccess: false,
  hasSavingsAccess: false,
};

test("a player who gave an email still counts as cricket-only", () => {
  assert.equal(isCricketOnly({ ...noAccess, email: "ravi@example.com" } as typeof noAccess), true);
});

test("access to any other app means more than cricket", () => {
  for (const flag of Object.keys(noAccess)) {
    assert.equal(isCricketOnly({ ...noAccess, [flag]: true }), false, flag);
  }
});
