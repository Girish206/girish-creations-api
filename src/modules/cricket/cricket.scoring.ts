// Scoring rules shared by the match service: what counts as a legal ball,
// a wicket, runs run between the wickets, and when an innings is over.

export interface BallLike {
  runs: number;
  extraType: string | null;
  extras: number;
  wicketType: string | null;
}

export const EXTRA_TYPES = ["wide", "no-ball", "bye", "leg-bye"] as const;
export const WICKET_TYPES = ["bowled", "caught", "lbw", "run-out", "stumped", "hit-wicket", "retired-hurt"] as const;
// Dismissals the bowler gets credit for.
export const BOWLER_WICKETS = ["bowled", "caught", "lbw", "stumped", "hit-wicket"];

export const isLegal = (ball: BallLike) => ball.extraType !== "wide" && ball.extraType !== "no-ball";

// Retired hurt leaves the crease but isn't out.
export const isWicket = (ball: BallLike) => ball.wicketType !== null && ball.wicketType !== "retired-hurt";

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
