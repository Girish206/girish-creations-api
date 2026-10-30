import { DLS_RESOURCES } from "./dls-table";

// Rain rules: the Duckworth-Lewis Standard Edition as the ICC's playing
// conditions set it out. Each interruption in an innings costs the
// resources between the balls left before and after it (at the wickets down
// then); the chasing side's target is the first innings scaled by the two
// sides' resources. Kept in step with the client's dls.ts.

export interface Interruption {
  // 0 = first innings, 1 = the chase.
  innings: number;
  // Legal balls bowled and wickets down when play stopped.
  balls: number;
  wickets: number;
  // The batting side's balls still to come before and after the cut (0 =
  // no more play in that innings).
  ballsLeftBefore: number;
  ballsLeftAfter: number;
}

// The "G50" of the playing conditions for levels below full internationals:
// what an average side scores in 50 overs, used when the chasing side ends
// up with more resources than the side batting first.
const G50 = 200;

// The resource percentage still to come, in tenths (so sums stay exact).
export const resourceAt = (ballsLeft: number, wickets: number) =>
  Math.round(DLS_RESOURCES[Math.max(0, Math.min(300, ballsLeft))][Math.max(0, Math.min(9, wickets))] * 10);

const lostIn = (interruptions: Interruption[], innings: number) =>
  interruptions
    .filter((i) => i.innings === innings)
    .reduce((sum, i) => sum + resourceAt(i.ballsLeftBefore, i.wickets) - resourceAt(i.ballsLeftAfter, i.wickets), 0);

// R1 and R2 in tenths of a percent. `scheduledOvers` is the overs per side
// the match started with; `chaseStartBalls` the chasing side's allocation
// when their innings began.
export function dlsResources(scheduledOvers: number, chaseStartBalls: number, interruptions: Interruption[]) {
  return {
    r1: resourceAt(scheduledOvers * 6, 0) - lostIn(interruptions, 0),
    r2: resourceAt(chaseStartBalls, 0) - lostIn(interruptions, 1),
  };
}

// The score the chasing side needs to tie (the "par score"); the target is
// one more. Fractions of a run are dropped, as the playing conditions say.
export function dlsPar(firstInnings: number, r1: number, r2: number, g50 = G50) {
  if (r1 <= 0) return firstInnings;
  return r2 < r1 ? Math.floor((firstInnings * r2) / r1) : Math.floor(firstInnings + (g50 * (r2 - r1)) / 1000);
}

// The chasing side's allocation when their innings began: what they had at
// their first interruption, or what the match has now if none.
export function chaseStartBalls(interruptions: Interruption[], currentOvers: number) {
  const first = interruptions.find((i) => i.innings === 1);
  return first ? first.balls + first.ballsLeftBefore : currentOvers * 6;
}

// The fewest overs the chasing side must face for a rain-shortened match to
// have a result: 20 in a 50-over game, 5 in a T20, a quarter of the overs
// in anything shorter.
export const minResultBalls = (scheduledOvers: number) =>
  (scheduledOvers >= 50 ? 20 : scheduledOvers >= 20 ? 5 : Math.ceil(scheduledOvers / 4)) * 6;
