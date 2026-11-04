import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { signInProblem } from "../modules/auth/auth.service";
import { requireAdminAuth, requireAnyAppAuth, requireCricketAuth } from "./auth";

const base = {
  sub: "1",
  email: null,
  name: null,
  isOwner: false,
  hasPortfolioAccess: true,
  hasExpensesAccess: false,
  hasSavingsAccess: false,
};

function accepts(guard: (req: Request, res: Response, next: NextFunction) => void, claims: object) {
  const req = { headers: { authorization: `Bearer ${jwt.sign(claims, env.jwtSecret)}` } } as Request;
  try {
    guard(req, {} as Response, () => {});
    return true;
  } catch {
    return false;
  }
}

const admin = { ...base, app: "admin" };
const cricket = { ...base, app: "cricket" };

test("an admin session opens the admin but not RunMitra", () => {
  assert.equal(accepts(requireAdminAuth, admin), true);
  assert.equal(accepts(requireCricketAuth, admin), false);
});

test("a RunMitra session opens RunMitra but not the admin", () => {
  assert.equal(accepts(requireCricketAuth, cricket), true);
  assert.equal(accepts(requireAdminAuth, cricket), false);
});

test("the routes both apps share take either session", () => {
  assert.equal(accepts(requireAnyAppAuth, admin), true);
  assert.equal(accepts(requireAnyAppAuth, cricket), true);
});

test("a token from before the split is refused everywhere", () => {
  assert.equal(accepts(requireAdminAuth, base), false);
  assert.equal(accepts(requireCricketAuth, base), false);
  assert.equal(accepts(requireAnyAppAuth, base), false);
});

test("a failed sign-in says what is wrong", () => {
  assert.equal(signInProblem(null, "a@b.co").message, "No account uses this email.");
  assert.equal(signInProblem(null, "9876543210").message, "No account uses this mobile number.");
  assert.equal(signInProblem({ isActive: false }, "a@b.co").code, "ACCOUNT_INACTIVE");
  assert.equal(signInProblem({ isActive: true }, "a@b.co").code, "NO_LOGIN");
});
