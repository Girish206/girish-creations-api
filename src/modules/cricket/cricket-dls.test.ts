import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chaseStartBalls, dlsPar, dlsResources, resourceAt, type Interruption } from "./cricket-dls";

// The worked examples from the ICC playing conditions' D/L Standard Edition
// appendix. Run with `npm test`.

const cut = (innings: number, overs: number, wickets: number, leftBefore: number, leftAfter: number): Interruption => ({
  innings,
  balls: overs * 6,
  wickets,
  ballsLeftBefore: leftBefore * 6,
  ballsLeftAfter: leftAfter * 6,
});

describe("D/L Standard Edition", () => {
  it("reads the table", () => {
    assert.equal(resourceAt(300, 0), 1000);
    assert.equal(resourceAt(38 * 6, 1), 820);
    assert.equal(resourceAt(17, 8), 69); // 2.5 overs left, 8 down
  });

  it("example 1: first innings cut, chasing side has more resources (G50 245)", () => {
    const interruptions = [cut(0, 20, 3, 30, 20)];
    const { r1, r2 } = dlsResources(50, 40 * 6, interruptions);
    assert.equal(r1, 875);
    assert.equal(r2, 893);
    assert.equal(dlsPar(180, r1, r2, 245) + 1, 185);
  });

  it("example 2: chase delayed and shortened", () => {
    const { r1, r2 } = dlsResources(45, 35 * 6, []);
    assert.equal(dlsPar(212, r1, r2) + 1, 185);
  });

  it("example 3: suspension during the chase", () => {
    const interruptions = [cut(1, 12, 1, 38, 28)];
    const { r1, r2 } = dlsResources(50, chaseStartBalls(interruptions, 40), interruptions);
    assert.equal(r2, 868);
    assert.equal(dlsPar(250, r1, r2) + 1, 218);
  });

  it("example 4: a second suspension, then no more play — par decides", () => {
    const interruptions = [cut(1, 12, 1, 38, 28), cut(1, 22, 3, 18, 16), { ...cut(1, 0, 6, 0, 0), balls: 200, ballsLeftBefore: 46 }];
    const { r1, r2 } = dlsResources(50, chaseStartBalls(interruptions, 38), interruptions);
    // 100 - 13.2 - 3.6 - 19.4 (7.4 overs left at 6 down): 154 against a par of 159.
    assert.equal(r2, 638);
    assert.equal(dlsPar(250, r1, r2), 159);
  });

  it("example 5: first innings ended early mid-over, chase shortened", () => {
    const interruptions = [{ innings: 0, balls: 283, wickets: 8, ballsLeftBefore: 17, ballsLeftAfter: 0 }];
    const { r1, r2 } = dlsResources(50, 33 * 6, interruptions);
    assert.equal(r1, 931);
    assert.equal(r2, 798);
    assert.equal(dlsPar(226, r1, r2) + 1, 194);
  });

  it("example 6: and a further cut during that chase", () => {
    const interruptions = [
      { innings: 0, balls: 283, wickets: 8, ballsLeftBefore: 17, ballsLeftAfter: 0 },
      cut(1, 25, 2, 8, 3),
    ];
    const { r1, r2 } = dlsResources(50, chaseStartBalls(interruptions, 28), interruptions);
    assert.equal(r2, 647);
    assert.equal(dlsPar(226, r1, r2) + 1, 158);
  });
});
