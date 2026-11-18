import assert from "node:assert/strict";
import { test } from "node:test";
import { mayChangeSignIn } from "./admin-user.service";

const member = { id: 1n, isSuperAdmin: false };

test("whoever added a guest can give them a login", () => {
  assert.equal(mayChangeSignIn({ id: 2n, passwordHash: null }, member), true);
});

test("once someone can sign in, only they or a super admin change how", () => {
  const withLogin = { id: 2n, passwordHash: "hash" };
  assert.equal(mayChangeSignIn(withLogin, member), false);
  assert.equal(mayChangeSignIn(withLogin, { id: 2n, isSuperAdmin: false }), true);
  assert.equal(mayChangeSignIn(withLogin, { id: 3n, isSuperAdmin: true }), true);
});
