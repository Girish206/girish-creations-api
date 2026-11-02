import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ballsPerOver, flipStrikeAfter, inningsSummary, isFreeHitNext, isLegal, isWicket, oversText, runsRun, type BallLike, type CreaseBall } from "./cricket.scoring";

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

describe("correcting a ball's runs", () => {
  const A = 1n;
  const B = 2n;
  const C = 3n;
  const played = (batterId: bigint, nonStrikerId: bigint, over: Partial<CreaseBall> = {}): CreaseBall => ({
    ...ball(),
    batterId,
    nonStrikerId,
    dismissedId: null,
    ...over,
  });
  const faced = (balls: CreaseBall[]) => balls.map((b) => [b.batterId, b.nonStrikerId]);

  it("gives the later balls and the crease to the other batter", () => {
    // A's 1 (to become a 2) put B on strike; B's dot and 2 are really A's.
    const innings = { balls: [played(A, B, { runs: 1 }), played(B, A), played(B, A, { runs: 2 })], strikerId: B, nonStrikerId: A };
    flipStrikeAfter(innings, 0, 6);
    assert.deepEqual(faced(innings.balls), [[A, B], [A, B], [A, B]]);
    assert.deepEqual([innings.strikerId, innings.nonStrikerId], [A, B]);
  });

  it("follows the strike through a later single and the end of an over", () => {
    const innings = {
      balls: [played(A, B, { runs: 1 }), played(B, A, { runs: 1 }), played(A, B)],
      // The third ball ends a 3-ball over, so the ends change there.
      strikerId: B,
      nonStrikerId: A,
    };
    flipStrikeAfter(innings, 0, 3);
    assert.deepEqual(faced(innings.balls), [[A, B], [A, B], [B, A]]);
    assert.deepEqual([innings.strikerId, innings.nonStrikerId], [A, B]);
  });

  it("leaves a later dismissal, and everything after it, with who was recorded", () => {
    const out = played(B, A, { wicketType: "bowled", dismissedId: B });
    const innings = { balls: [played(A, B, { runs: 1 }), played(B, A), out, played(C, A)], strikerId: C, nonStrikerId: A };
    flipStrikeAfter(innings, 0, 6);
    assert.deepEqual(faced(innings.balls), [[A, B], [A, B], [B, A], [C, A]]);
    assert.equal(out.dismissedId, B);
    assert.deepEqual([innings.strikerId, innings.nonStrikerId], [C, A]);
  });

  it("stops where the scorer changed the strike by hand", () => {
    // After A's 1 the app had B on strike, but the scorer put A back.
    const innings = { balls: [played(A, B, { runs: 1 }), played(A, B)], strikerId: A, nonStrikerId: B };
    flipStrikeAfter(innings, 0, 6);
    assert.deepEqual(faced(innings.balls), [[A, B], [A, B]]);
    assert.deepEqual([innings.strikerId, innings.nonStrikerId], [A, B]);
  });

  it("carries through penalty runs and no-balls, and leaves earlier balls alone", () => {
    const innings = {
      balls: [
        played(A, B),
        played(A, B, { runs: 1 }),
        played(B, A, { extraType: "penalty", extras: 5, noDelivery: true }),
        played(B, A, { extraType: "no-ball", extras: 1, runs: 1 }),
      ],
      strikerId: A,
      nonStrikerId: B,
    };
    flipStrikeAfter(innings, 1, 6);
    assert.deepEqual(faced(innings.balls), [[A, B], [A, B], [A, B], [A, B]]);
    assert.deepEqual([innings.strikerId, innings.nonStrikerId], [B, A]);
  });

  it("moves nothing for a run-out with a known end, or a batter alone", () => {
    const runOut = {
      balls: [played(A, B, { runs: 1, wicketType: "run-out", dismissedId: A, outEnd: "striker" }), played(C, B)],
      strikerId: C,
      nonStrikerId: B,
    };
    flipStrikeAfter(runOut, 0, 6);
    assert.deepEqual(faced(runOut.balls), [[A, B], [C, B]]);
    const alone = { balls: [played(A, A, { runs: 1 }), played(A, A)], strikerId: A, nonStrikerId: null };
    flipStrikeAfter(alone, 0, 6);
    assert.deepEqual([alone.strikerId, alone.nonStrikerId], [A, null]);
  });

  it("corrects the balls of a closed innings without bringing its crease back", () => {
    const innings = { balls: [played(A, B, { runs: 1 }), played(B, A)], strikerId: null, nonStrikerId: null };
    flipStrikeAfter(innings, 0, 6);
    assert.deepEqual(faced(innings.balls), [[A, B], [A, B]]);
    assert.deepEqual([innings.strikerId, innings.nonStrikerId], [null, null]);
  });
});
