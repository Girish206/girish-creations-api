import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ballsPerOver, inningsSummary, isFreeHitNext, isLegal, isWicket, oversText, runsRun, type BallLike } from "./cricket.scoring";

// The scoring rules every live match runs on. Run with `npm test`.

const ball = (over: Partial<BallLike> = {}): BallLike => ({ runs: 0, extraType: null, extras: 0, wicketType: null, ...over });

describe("legal balls", () => {
  it("doesn't count wides, no-balls or events between deliveries", () => {
    assert.equal(isLegal(ball({ extraType: "wide", extras: 1 })), false);
    assert.equal(isLegal(ball({ extraType: "no-ball", extras: 1 })), false);
    assert.equal(isLegal(ball({ extraType: "penalty", extras: 5, noDelivery: true })), false);
    assert.equal(isLegal(ball({ extraType: "bye", extras: 2 })), true);
  });
});

describe("runs run", () => {
  it("leaves out a wide or no-ball's one-run penalty", () => {
    assert.equal(runsRun(ball({ extraType: "wide", extras: 2 })), 1);
    assert.equal(runsRun(ball({ extraType: "no-ball", extras: 1, runs: 3 })), 3);
    // Byes run off a no-ball: the extras hold the penalty plus the byes.
    assert.equal(runsRun(ball({ extraType: "no-ball", extras: 3 })), 2);
    assert.equal(runsRun(ball({ extraType: "leg-bye", extras: 1 })), 1);
  });
});

describe("wickets", () => {
  it("doesn't count retiring hurt or absent hurt", () => {
    assert.equal(isWicket(ball({ wicketType: "retired-hurt" })), false);
    assert.equal(isWicket(ball({ wicketType: "absent-hurt" })), false);
    assert.equal(isWicket(ball({ wicketType: "retired-out" })), true);
  });
});

describe("innings summary", () => {
  it("adds penalty runs to the total without a ball", () => {
    const s = inningsSummary([ball({ runs: 4 }), ball({ extraType: "penalty", extras: 5, noDelivery: true }), ball({ runs: 1 })]);
    assert.deepEqual(s, { runs: 10, wickets: 0, legalBalls: 2 });
  });
});

describe("free hit", () => {
  it("follows a no-ball and carries over a wide on the free hit", () => {
    assert.equal(isFreeHitNext([ball({ extraType: "no-ball", extras: 1 })]), true);
    assert.equal(isFreeHitNext([ball({ extraType: "no-ball", extras: 1 }), ball({ extraType: "wide", extras: 1 })]), true);
    assert.equal(isFreeHitNext([ball({ extraType: "no-ball", extras: 1 }), ball({ runs: 1 })]), false);
    // An event between deliveries doesn't use it up.
    assert.equal(
      isFreeHitNext([ball({ extraType: "no-ball", extras: 1 }), ball({ wicketType: "retired-hurt", noDelivery: true })]),
      true,
    );
  });
});

describe("overs", () => {
  it("counts in the match's balls an over", () => {
    assert.equal(oversText(13), "2.1");
    assert.equal(oversText(13, ballsPerOver({ ballsPerOver: 5 })), "2.3");
    assert.equal(ballsPerOver({}), 6);
  });
});
