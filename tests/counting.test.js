// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binom, cumulativeCounts, nestedSum, totalCombinations, combinationsBySize,
  feasibleMaterials, isFeasible, materialPlacements, placementsUpperBound,
  STANDARD, materialCount, randomMaterial, toScientific,
} from "../src/counting.js";

/* ---------- general piece combinations ---------- */

function bruteForceBySize(spec) {
  const mult = Object.entries(spec).flatMap(([j, a]) => Array(Number(a)).fill(Number(j)));
  const tally = new Array(mult.reduce((s, m) => s + m, 0) + 1).fill(0n);
  (function rec(i, size) {
    if (i === mult.length) { tally[size] += 1n; return; }
    for (let c = 0; c <= mult[i]; c++) rec(i + 1, size + c);
  })(0, 0);
  return tally;
}

test("standard chess pieces give 2916 = 3^6 * 2^2", () => {
  assert.equal(nestedSum({ 2: 6, 1: 2 }), 2916n);
  assert.equal(totalCombinations({ 2: 6, 1: 2 }), 2916n);
});

test("three or more levels are counted correctly", () => {
  assert.equal(nestedSum({ 3: 1 }), 4n);
  assert.equal(nestedSum({ 5: 2, 3: 3, 1: 5 }), 73728n);
  assert.equal(nestedSum({ 3: 2, 1: 1 }), 32n);
});

test("cumulative counts fill gaps and leave the input alone", () => {
  const spec = { 5: 2, 3: 3, 1: 5 };
  assert.deepEqual(cumulativeCounts(spec), [[5, 2], [4, 2], [3, 5], [2, 5], [1, 10]]);
  assert.deepEqual(spec, { 5: 2, 3: 3, 1: 5 });
});

test("nested sum, closed form and size distribution agree on random specs", () => {
  let seed = 2012;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let k = 0; k < 300; k++) {
    const spec = {};
    for (let r = 0; r < 1 + rand(4); r++) spec[1 + rand(6)] = rand(4);
    if (Object.values(spec).every((a) => a === 0)) continue;
    const expected = totalCombinations(spec);
    assert.equal(nestedSum(spec), expected, JSON.stringify(spec));
    assert.equal(combinationsBySize(spec).reduce((a, b) => a + b, 0n), expected);
  }
});

test("size distribution matches direct enumeration", () => {
  for (const spec of [{ 2: 6, 1: 2 }, { 3: 2, 1: 1 }, { 4: 1, 2: 2, 1: 1 }]) {
    assert.deepEqual(combinationsBySize(spec), bruteForceBySize(spec));
  }
});

test("matches hand-checked size counts", () => {
  assert.equal(combinationsBySize({ 5: 3, 3: 4, 2: 2, 1: 4 })[6], 10670n);
  const ex19 = combinationsBySize({ 4: 1, 3: 2, 1: 1 });
  assert.equal(ex19.reduce((a, b) => a + b, 0n), 160n);
  assert.deepEqual(ex19.slice(0, 4), [1n, 4n, 9n, 16n]);
});

test("nestedSum reports every term", () => {
  const terms = [];
  const total = nestedSum({ 2: 6, 1: 2 }, (idx, p) => terms.push([idx, p]));
  assert.equal(terms.reduce((s, [, p]) => s + p, 0n), total);
  assert.deepEqual(terms[0], [[0, 0], 1n]);
});

test("bad specs are rejected with a clear message", () => {
  for (const bad of [{}, { 0: 1 }, { 2: -1 }, { 2: 1.5 }]) assert.throws(() => nestedSum(bad), RangeError);
});

/* ---------- chess upper bound ---------- */

// Places pieces square by square, sharing no logic with the formula.
function bruteForcePlacements({ rows, cols, pawns, army, promotions }) {
  const types = Object.keys(army);
  const kinds = [];
  for (const colour of ["w", "b"]) for (const piece of ["K", "P", ...types]) kinds.push(colour + piece);
  const limit = {};
  for (const colour of ["w", "b"]) {
    limit[colour + "K"] = 1;
    limit[colour + "P"] = pawns;
    for (const t of types) limit[colour + t] = army[t] + (promotions.includes(t) ? pawns : 0);
  }
  const count = Object.fromEntries(kinds.map((k) => [k, 0]));
  const ok = (colour) => {
    if (count[colour + "K"] !== 1) return false;
    let excess = 0;
    for (const t of types) excess += Math.max(0, count[colour + t] - army[t]);
    return count[colour + "P"] + excess <= pawns;
  };
  const n = rows * cols;
  function place(sq) {
    if (sq === n) return ok("w") && ok("b") ? 1n : 0n;
    let total = place(sq + 1);
    const row = Math.floor(sq / cols);
    for (const k of kinds) {
      if (k[1] === "P" && (row === 0 || row === rows - 1)) continue;
      if (count[k] < limit[k]) { count[k]++; total += place(sq + 1); count[k]--; }
    }
    return total;
  }
  return place(0);
}

const SMALL_BOARDS = [
  { rows: 3, cols: 2, pawns: 1, army: { R: 1 }, promotions: ["R"] },
  { rows: 3, cols: 2, pawns: 1, army: { R: 1, N: 0 }, promotions: ["R", "N"] },
  { rows: 3, cols: 3, pawns: 1, army: { Q: 0 }, promotions: ["Q"] },
  { rows: 4, cols: 2, pawns: 2, army: { Q: 0 }, promotions: ["Q"] },
  { rows: 4, cols: 2, pawns: 1, army: { R: 1, Q: 1 }, promotions: ["Q"] },
  { rows: 2, cols: 3, pawns: 1, army: { R: 1 }, promotions: ["R"] },
];

for (const params of SMALL_BOARDS) {
  test(`formula matches brute force on ${params.rows}x${params.cols}, army ${JSON.stringify(params.army)}`, () => {
    const expected = bruteForcePlacements(params);
    assert.ok(expected > 0n);
    assert.equal(placementsUpperBound(params).total, expected);
  });
}

test("identical pieces are not double counted", () => {
  const params = { rows: 3, cols: 2, pawns: 1, army: { R: 1 }, promotions: ["R"] };
  // Two white rooks are possible here; swapping them must not create a new placement.
  const withTwoRooks = materialPlacements({ pawns: 0, counts: { R: 2 } }, { pawns: 0, counts: { R: 0 } }, params);
  assert.equal(withTwoRooks.arrangement, 4n * 3n * 2n / 2n);
});

test("only kings: 64 * 63 placements", () => {
  assert.equal(placementsUpperBound({ pawns: 0, army: {}, promotions: [] }).total, 64n * 63n);
});

test("without promotions there are 9 * 3^3 * 2 materials per side", () => {
  assert.equal(feasibleMaterials({ promotions: [] }).length, 9 * 3 * 3 * 3 * 2);
});

test("feasibility rule", () => {
  assert.ok(isFeasible({ pawns: 8, counts: { Q: 1, R: 2, B: 2, N: 2 } }));
  assert.ok(isFeasible({ pawns: 0, counts: { Q: 9, R: 2, B: 2, N: 2 } }));
  assert.ok(!isFeasible({ pawns: 1, counts: { Q: 9, R: 2, B: 2, N: 2 } }));
  assert.ok(!isFeasible({ pawns: 7, counts: { Q: 2, R: 3, B: 0, N: 0 } }));
});

test("starting position material is one exact term", () => {
  const start = { pawns: 8, counts: { Q: 1, R: 2, B: 2, N: 2 } };
  const f = materialPlacements(start, start);
  assert.equal(f.pawnSquareChoice * f.pawnColouring, binom(48, 16) * binom(16, 8));
  assert.equal(f.pieceSquareChoice, binom(48, 16));
  assert.equal(f.arrangement, 16n * 15n * 14n * 13n * 12n * 11n * 10n * 9n * 8n * 7n * 6n * 5n * 4n * 3n * 2n / 64n);
});

test("the total equals the sum over every pair of materials", () => {
  // Independent check of the grouping on a reduced army (sum is small enough to do directly).
  const params = { ...STANDARD, pawns: 2, army: { Q: 1, R: 1 }, promotions: ["Q", "R"] };
  const mats = feasibleMaterials(params);
  let direct = 0n;
  for (const w of mats) for (const b of mats) direct += materialPlacements(w, b, params).total;
  assert.equal(placementsUpperBound(params).total, direct);
});

test("standard chess result", () => {
  const r = placementsUpperBound();
  assert.equal(r.total, 23937533792747905898433845980097921846050276105440n);
  assert.equal([...r.byPieces.values()].reduce((a, b) => a + b, 0n), r.total);
  assert.equal([...r.byPawns.values()].reduce((a, b) => a + b, 0n), r.total);
});

test("material count from the dynamic program matches enumeration", () => {
  for (const params of [STANDARD, { pawns: 3, army: { Q: 1, R: 2, X: 0 }, promotions: ["Q", "X"] }, ...SMALL_BOARDS]) {
    assert.equal(materialCount(params), feasibleMaterials(params).length);
  }
  assert.equal(materialCount(), 8694);
});

test("random materials are always feasible", () => {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 500; i++) assert.ok(isFeasible(randomMaterial(STANDARD, rand)));
});

test("variants: wider boards, extra pieces, non-promotable pieces", () => {
  // Grouped sum equals the direct sum over pairs on a variant with an unpromotable piece.
  const params = { rows: 6, cols: 6, pawns: 2, army: { R: 1, N: 1, X: 1 }, promotions: ["R", "N"] };
  const mats = feasibleMaterials(params);
  let direct = 0n;
  for (const w of mats) for (const b of mats) direct += materialPlacements(w, b, params).total;
  assert.equal(placementsUpperBound(params).total, direct);
  // A big variant still runs quickly.
  const t0 = Date.now();
  const big = placementsUpperBound({ rows: 10, cols: 10, pawns: 10, army: { Q: 1, R: 2, B: 2, N: 2, A: 1, C: 1, M: 2 }, promotions: ["Q", "R", "B", "N", "A", "C", "M"] });
  assert.ok(big.total > 0n);
  assert.ok(Date.now() - t0 < 5000);
});

test("scientific notation rounds instead of truncating", () => {
  assert.equal(toScientific(23937533792747905898433845980097921846050276105440n), "2.394 × 10^49");
  assert.equal(toScientific(9999600000n), "1.000 × 10^10");
  assert.equal(toScientific(123456n), "123,456");
});

