// Scoring rules shared by the match service: what counts as a legal ball,
// a wicket, runs run between the wickets, and when an innings is over.

export interface BallLike {
  runs: number;
  extraType: string | null;
  extras: number;
  wicketType: string | null;
  // An event between deliveries (a retirement, a Mankad, a timed out): no
  // ball is bowled, so it counts for no one.
  noDelivery?: boolean | null;
}

// "penalty": runs the umpires award the batting side (5 for a fielding
// offence), recorded between deliveries.
export const EXTRA_TYPES = ["wide", "no-ball", "bye", "leg-bye", "penalty"] as const;
export const WICKET_TYPES = [
  "bowled",
  "caught",
  "caught-behind",
  "lbw",
  "run-out",
  "stumped",
  "hit-wicket",
  "hit-ball-twice",
  "obstructing-field",
  "retired-out",
  "timed-out",
  "retired-hurt",
  "retired",
  "absent-hurt",
] as const;
// Dismissals the bowler gets credit for.
export const BOWLER_WICKETS = ["bowled", "caught", "caught-behind", "lbw", "stumped", "hit-wicket"];
// Leaving without being out: retired hurt and retired (not out) may bat
// again; absent hurt can't bat at all.
export const NOT_OUT_EXITS = ["retired-hurt", "retired", "absent-hurt"];
// Only ever between deliveries.
export const NO_DELIVERY_ONLY = ["retired", "retired-out", "timed-out", "absent-hurt"];
// What can still get a batter out on a free hit.
export const FREE_HIT_OUTS = ["run-out", "obstructing-field", "hit-ball-twice", "retired-hurt", "retired", "retired-out"];
// Can also be between deliveries: retiring hurt, or a Mankad run-out.
export const NO_DELIVERY_ALLOWED = [...NO_DELIVERY_ONLY, "retired-hurt", "run-out"];
// The next batter, before they reach the crease.
export const INCOMING_OUTS = ["timed-out", "absent-hurt"];

export const isLegal = (ball: BallLike) => !ball.noDelivery && ball.extraType !== "wide" && ball.extraType !== "no-ball";

export const isWicket = (ball: BallLike) => ball.wicketType !== null && !NOT_OUT_EXITS.includes(ball.wicketType);

// Out, or absent hurt: either way they can't bat (again) this innings.
export const cantBat = (ball: BallLike) => isWicket(ball) || ball.wicketType === "absent-hurt";

export const ballTotal = (ball: BallLike) => ball.runs + ball.extras;

// Runs the batters actually ran — decides whether they changed ends. A wide
// or no-ball's first extra is the penalty, not a run.
export function runsRun(ball: BallLike) {
  const penalty = ball.extraType === "wide" || ball.extraType === "no-ball" ? 1 : 0;
  return ball.runs + ball.extras - penalty;
}

export interface CreaseBall extends BallLike {
  batterId: bigint;
  nonStrikerId: bigint;
  dismissedId: bigint | null;
  outEnd?: string | null;
}

type Ends = [bigint | null, bigint | null];

// Who's at which end once a ball is done; null = gone, a batter yet to come.
function creaseAfter(ball: CreaseBall, overEnded: boolean): Ends {
  let ends: Ends = [ball.batterId, ball.nonStrikerId];
  // Penalty runs are awarded, not run.
  if (ball.extraType === "penalty") return ends;
  if (runsRun(ball) % 2 === 1) ends = [ends[1], ends[0]];
  if (ball.dismissedId !== null) {
    if (ball.wicketType === "run-out" && ball.outEnd) {
      const survivor = ball.dismissedId === ball.batterId ? ball.nonStrikerId : ball.batterId;
      ends = ball.outEnd === "striker" ? [null, survivor] : [survivor, null];
    } else {
      ends = [ends[0] === ball.dismissedId ? null : ends[0], ends[1] === ball.dismissedId ? null : ends[1]];
    }
  }
  return overEnded ? [ends[1], ends[0]] : ends;
}

// A corrected ball now has the batters finishing at the other ends, so the
// balls after it were faced by the other batter. Call it before changing the
// ball's runs. It stops at the next dismissal, which stays with the batter
// recorded as out (the rest of the innings then stands as it was), and where
// the scorer changed the strike by hand, which already put the crease right.
export function flipStrikeAfter(
  innings: { balls: CreaseBall[]; strikerId: bigint | null; nonStrikerId: bigint | null },
  index: number,
  perOver: number,
) {
  const { balls } = innings;
  const corrected = balls[index];
  // Alone there's no other end, and a run-out's end places the survivor
  // whatever was run.
  if (corrected.batterId === corrected.nonStrikerId || (corrected.wicketType === "run-out" && corrected.outEnd)) return;
  const matches = (expected: Ends, striker: bigint | null, nonStriker: bigint | null) =>
    (expected[0] === null || expected[0] === striker) && (expected[1] === null || expected[1] === nonStriker);
  let legal = balls.slice(0, index + 1).filter(isLegal).length;
  let expected = creaseAfter(corrected, isLegal(corrected) && legal % perOver === 0);
  for (const ball of balls.slice(index + 1)) {
    if (ball.dismissedId !== null || !matches(expected, ball.batterId, ball.nonStrikerId)) return;
    if (isLegal(ball)) legal++;
    expected = creaseAfter(ball, isLegal(ball) && legal % perOver === 0);
    [ball.batterId, ball.nonStrikerId] = [ball.nonStrikerId, ball.batterId];
  }
  if (matches(expected, innings.strikerId, innings.nonStrikerId)) {
    [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
  }
}

export function inningsSummary(balls: BallLike[]) {
  return {
    runs: balls.reduce((sum, ball) => sum + ballTotal(ball), 0),
    wickets: balls.filter(isWicket).length,
    legalBalls: balls.filter(isLegal).length,
  };
}

export const oversText = (legalBalls: number, perOver = 6) => `${Math.floor(legalBalls / perOver)}.${legalBalls % perOver}`;

// Balls in an over for this match (The Hundred plays 5).
export const ballsPerOver = (match: { ballsPerOver?: number | null }) => match.ballsPerOver ?? 6;

// Whether the next delivery is a free hit: after a no-ball, and still after
// a wide or no-ball bowled on the free hit itself.
export function isFreeHitNext(balls: BallLike[]) {
  let freeHit = false;
  for (const ball of balls) {
    if (ball.noDelivery) continue;
    if (ball.extraType === "no-ball") freeHit = true;
    else if (ball.extraType !== "wide") freeHit = false;
  }
  return freeHit;
}
