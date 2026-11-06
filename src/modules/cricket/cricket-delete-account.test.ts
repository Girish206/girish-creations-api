import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { DELETED_PLAYER_NAME, deleteMyAccount } from "./cricket.service";

type Row = Record<string, unknown>;
type Args = { data: Row; where: Row };
type Call = { at: string; args: Args };

// Prisma's client hides its methods from node:test's mock.method, so they're
// replaced directly (as in cricket-account-email.test.ts). Each test file runs
// in its own process, so this can't leak; the check stops the test rather than
// letting it reach a real database if an upgrade makes this do nothing.
function stub(target: object, method: string, impl: (args: Args) => unknown) {
  const object = target as Record<string, unknown>;
  object[method] = impl;
  assert.equal(object[method], impl, `couldn't stub ${method}`);
}

const PASSWORD = "right-password";
const passwordHash = bcrypt.hashSync(PASSWORD, 4);

const player = { id: 7n, name: "Ravi Kumar", mobile: "9876543210", photoUrl: null, role: "batter" };

const playerOnly = {
  id: 1n,
  name: "Ravi Kumar",
  mobile: "9876543210",
  email: "ravi@example.com",
  passwordHash,
  isOwner: false,
  isSuperAdmin: false,
  hasPortfolioAccess: false,
  hasExpensesAccess: false,
  hasSavingsAccess: false,
  hasCricketAccess: true,
  isActive: true,
  listedInAdmin: null,
  sessionVersion: 2,
};

// Stands in for the database: nothing in this file reaches it. Every write is
// recorded in `calls`, as "model.method".
function stubDb(account: Row, { tournaments = [] as Row[], deleteFails = false } = {}) {
  const calls: Call[] = [];
  const record = (at: string, result: unknown = {}) => (args: Args) => {
    calls.push({ at, args });
    return result;
  };
  stub(prisma.adminUser, "findUnique", () => account);
  stub(prisma.adminUser, "update", record("adminUser.update"));
  stub(prisma.adminUser, "delete", (args) => {
    calls.push({ at: "adminUser.delete", args });
    if (deleteFails) throw new Error("records still point at this account");
    return account;
  });
  stub(prisma.cricketPlayer, "findFirst", () => player);
  stub(prisma.cricketPlayer, "update", record("cricketPlayer.update"));
  stub(prisma.cricketFollow, "deleteMany", record("cricketFollow.deleteMany", { count: 0 }));
  // Its own tournaments (by createdById) for the contact clean-up; none for
  // the scorer/organiser lists.
  stub(prisma.cricketTournament, "findMany", ({ where }) => (where.createdById ? tournaments : []));
  stub(prisma.cricketTournament, "update", record("cricketTournament.update"));
  stub(prisma.cricketMatch, "findMany", () => []);
  stub(prisma.cricketMatch, "updateMany", record("cricketMatch.updateMany", { count: 0 }));
  stub(prisma.cricketSavedTeam, "findMany", () => []);
  stub(prisma.cricketPushSubscription, "deleteMany", record("cricketPushSubscription.deleteMany", { count: 0 }));
  stub(prisma.authCode, "deleteMany", record("authCode.deleteMany", { count: 0 }));
  stub(prisma.storedFile, "deleteMany", record("storedFile.deleteMany", { count: 0 }));
  const find = (at: string) => calls.filter((call) => call.at === at);
  return { calls, find };
}

test("a wrong password deletes nothing", async () => {
  const { calls } = stubDb(playerOnly);
  await assert.rejects(deleteMyAccount(1n, "wrong-password"), /password isn't right/);
  assert.deepEqual(calls, []);
});

test("organisers and the owner can't delete their account here", async () => {
  for (const account of [{ ...playerOnly, isSuperAdmin: true }, { ...playerOnly, isOwner: true }]) {
    const { calls } = stubDb(account);
    await assert.rejects(deleteMyAccount(1n, PASSWORD), /Organiser accounts can't be deleted here/);
    assert.deepEqual(calls, []);
  }
});

test("a RunMitra-only account is deleted, and its player becomes a nameless 'Deleted player'", async () => {
  const { find } = stubDb(playerOnly);
  assert.deepEqual(await deleteMyAccount(1n, PASSWORD), { accountKept: false });

  const [playerUpdate] = find("cricketPlayer.update");
  assert.deepEqual(playerUpdate.args.where, { id: 7n });
  assert.equal(playerUpdate.args.data.name, DELETED_PLAYER_NAME);
  for (const field of ["mobile", "photoUrl", "role", "battingStyle", "bowlingStyle", "inviteCode"]) {
    assert.equal(playerUpdate.args.data[field], null, `${field} is cleared`);
  }
  // Follows both ways: who they follow, and who follows them.
  assert.deepEqual(find("cricketFollow.deleteMany")[0].args.where, {
    OR: [{ followerId: 7n }, { kind: "player", targetId: 7n }],
  });
  assert.deepEqual(find("cricketPushSubscription.deleteMany")[0].args.where, { adminId: 1n });
  assert.deepEqual(find("authCode.deleteMany")[0].args.where, { adminUserId: 1n });
  assert.deepEqual(find("cricketMatch.updateMany")[0].args.where, { scoringById: 1n });
  assert.deepEqual(find("adminUser.delete")[0].args.where, { id: 1n });
  assert.equal(find("adminUser.update").length, 0);
});

test("if something still points at the account, it's blanked and switched off instead", async () => {
  const { find } = stubDb(playerOnly, { deleteFails: true });
  assert.deepEqual(await deleteMyAccount(1n, PASSWORD), { accountKept: false });
  const [update] = find("adminUser.update");
  assert.deepEqual(update.args.data, {
    name: null,
    mobile: null,
    email: null,
    passwordHash: null,
    hasCricketAccess: false,
    isActive: false,
    sessionVersion: 3,
  });
});

test("an account also used for the other tools only loses RunMitra, and is signed out", async () => {
  for (const account of [{ ...playerOnly, hasExpensesAccess: true }, { ...playerOnly, listedInAdmin: true }]) {
    const { find } = stubDb(account);
    assert.deepEqual(await deleteMyAccount(1n, PASSWORD), { accountKept: true });
    assert.equal(find("adminUser.delete").length, 0);
    assert.deepEqual(find("adminUser.update")[0].args.data, { hasCricketAccess: false, sessionVersion: 3 });
    // The player record is anonymised all the same.
    assert.equal(find("cricketPlayer.update")[0].args.data.name, DELETED_PLAYER_NAME);
  }
});

test("with keepName, the name stays on past matches and their tournaments, but nothing else does", async () => {
  const { find } = stubDb(playerOnly, {
    tournaments: [
      { id: 11n, organiserName: "Ravi Kumar", organiserMobile: "9876543210", organiserEmail: "ravi@example.com" },
    ],
  });
  assert.deepEqual(await deleteMyAccount(1n, PASSWORD, { keepName: true }), { accountKept: false });
  const [playerUpdate] = find("cricketPlayer.update");
  assert.equal("name" in playerUpdate.args.data, false, "the name isn't touched");
  assert.equal(playerUpdate.args.data.mobile, null);
  assert.equal(playerUpdate.args.data.photoUrl, null);
  assert.deepEqual(find("cricketTournament.update")[0].args.data, { organiserMobile: null, organiserEmail: null });
  assert.deepEqual(find("adminUser.delete")[0].args.where, { id: 1n });
});

test("their own contact details come off the tournaments they made; someone else's stay", async () => {
  const { find } = stubDb(playerOnly, {
    tournaments: [
      { id: 11n, organiserName: "ravi kumar", organiserMobile: "98765 43210", organiserEmail: "RAVI@example.com" },
      { id: 12n, organiserName: "Suresh", organiserMobile: "9123456780", organiserEmail: null },
    ],
  });
  await deleteMyAccount(1n, PASSWORD);
  const updates = find("cricketTournament.update");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].args.where, { id: 11n });
  assert.deepEqual(updates[0].args.data, { organiserName: null, organiserMobile: null, organiserEmail: null });
});
