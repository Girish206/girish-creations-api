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

export const EXTRA_TYPES = ["wide", "no-ball", "bye", "leg-bye"] as const;
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

export function inningsSummary(balls: BallLike[]) {
  return {
    runs: balls.reduce((sum, ball) => sum + ballTotal(ball), 0),
    wickets: balls.filter(isWicket).length,
    legalBalls: balls.filter(isLegal).length,
  };
}

export const oversText = (legalBalls: number) => `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
