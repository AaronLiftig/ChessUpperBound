// Exact counting for the chess upper bound and the general piece-combination
// expression. Everything uses BigInt, so results are exact integers.

const factCache = [1n];
export function factorial(n) {
  if (n < 0) throw new RangeError(`factorial of negative number ${n}`);
  for (let i = factCache.length; i <= n; i++) factCache.push(factCache[i - 1] * BigInt(i));
  return factCache[n];
}

export function binom(n, k) {
  if (k < 0 || k > n || n < 0) return 0n;
  return factorial(n) / (factorial(k) * factorial(n - k));
}

// Multinomial coefficient: n! / (k1! k2! ... (n - sum k)!)
export function multinomial(n, parts) {
  const used = parts.reduce((a, b) => a + b, 0);
  if (used > n || parts.some((p) => p < 0)) return 0n;
  let denom = factorial(n - used);
  for (const p of parts) denom *= factorial(p);
  return factorial(n) / denom;
}

/* ------------------------------------------------------------------ */
/* General piece combinations                                          */
/* ------------------------------------------------------------------ */
// A spec maps copies-per-type -> number of types with that many copies.
// Standard chess pieces (no kings or pawns): { 2: 6, 1: 2 }.

function validateSpec(spec) {
  const entries = Object.entries(spec).map(([j, a]) => [Number(j), Number(a)]);
  if (entries.length === 0) throw new RangeError("Add at least one piece type.");
  for (const [j, a] of entries) {
    if (!Number.isInteger(j) || j < 1) throw new RangeError(`Copies per type must be a whole number of at least 1 (got ${j}).`);
    if (!Number.isInteger(a) || a < 0) throw new RangeError(`Number of types must be a whole number of at least 0 (got ${a}).`);
  }
  return entries;
}

// [[j, A_j]] from the largest multiplicity down to 1, where A_j is the
// number of types with at least j copies.
export function cumulativeCounts(spec) {
  const entries = validateSpec(spec);
  const top = Math.max(...entries.map(([j]) => j));
  const levels = [];
  let running = 0;
  for (let j = top; j >= 1; j--) {
    running += Number(spec[j] ?? 0);
    levels.push([j, running]);
  }
  return levels;
}

// The nested sum: sum over i_M..i_1 of prod_j C(A_j - (i_M + ... + i_{j+1}), i_j).
// Calls onTerm(indices, product) for every term when provided.
export function nestedSum(spec, onTerm) {
  const levels = cumulativeCounts(spec);
  const indices = [];
  function recurse(level, used, product) {
    const free = levels[level][1] - used;
    let total = 0n;
    for (let i = 0; i <= free; i++) {
      const p = product * binom(free, i);
      indices.push(i);
      if (level === levels.length - 1) {
        total += p;
        if (onTerm) onTerm(indices.slice(), p);
      } else {
        total += recurse(level + 1, used + i, p);
      }
      indices.pop();
    }
    return total;
  }
  return recurse(0, 0, 1n);
}

// Closed form: prod_j (j + 1)^(a_j).
export function totalCombinations(spec) {
  return validateSpec(spec).reduce((acc, [j, a]) => acc * BigInt(j + 1) ** BigInt(a), 1n);
}

// Coefficients of prod_j (1 + x + ... + x^j)^(a_j): result[n] = combinations with n pieces.
export function combinationsBySize(spec) {
  let coeffs = [1n];
  for (const [j, a] of validateSpec(spec)) {
    for (let r = 0; r < a; r++) {
      const next = new Array(coeffs.length + j).fill(0n);
      coeffs.forEach((v, n) => { for (let k = 0; k <= j; k++) next[n + k] += v; });
      coeffs = next;
    }
  }
  return coeffs;
}

/* ------------------------------------------------------------------ */
/* Chess upper bound                                                    */
/* ------------------------------------------------------------------ */

export const STANDARD = Object.freeze({
  rows: 8,
  cols: 8,
  pawns: 8,
  army: Object.freeze({ Q: 1, R: 2, B: 2, N: 2 }),
  promotions: Object.freeze(["Q", "R", "B", "N"]),
});

function withDefaults(params = {}) {
  return { ...STANDARD, ...params };
}

// Largest count of each piece type one side could ever have.
export function maxCounts(params) {
  const { pawns, army, promotions } = withDefaults(params);
  return Object.fromEntries(Object.keys(army).map((t) => [t, army[t] + (promotions.includes(t) ? pawns : 0)]));
}

// Promoted pieces needed for a material: copies beyond the starting army.
export function excessOf(counts, params) {
  const { army } = withDefaults(params);
  return Object.keys(army).reduce((e, t) => e + Math.max(0, (counts[t] ?? 0) - army[t]), 0);
}

// Can one side reach this material by captures and promotions?
export function isFeasible(material, params) {
  const p = withDefaults(params);
  const max = maxCounts(p);
  if (material.pawns < 0 || material.pawns > p.pawns) return false;
  for (const t of Object.keys(p.army)) {
    const c = material.counts[t] ?? 0;
    if (c < 0 || c > max[t]) return false;
  }
  return material.pawns + excessOf(material.counts, p) <= p.pawns;
}

// Every material one side can have: { pawns, counts: {type: n} }.
export function feasibleMaterials(params) {
  const p = withDefaults(params);
  const types = Object.keys(p.army);
  const max = maxCounts(p);
  const out = [];
  const counts = {};
  function rec(i, pawns) {
    if (i === types.length) {
      if (pawns + excessOf(counts, p) <= p.pawns) out.push({ pawns, counts: { ...counts } });
      return;
    }
    for (let c = 0; c <= max[types[i]]; c++) { counts[types[i]] = c; rec(i + 1, pawns); }
  }
  for (let pawns = 0; pawns <= p.pawns; pawns++) rec(0, pawns);
  return out;
}

// The factors for one specific pair of materials (white, black). Pieces of the
// same type and colour are identical. Returns each component and their product.
export function materialPlacements(white, black, params) {
  const p = withDefaults(params);
  const squares = p.rows * p.cols;
  const pawnSquares = Math.max(0, p.rows - 2) * p.cols;
  const types = Object.keys(p.army);
  const pw = white.pawns, pb = black.pawns;
  const nw = types.reduce((s, t) => s + (white.counts[t] ?? 0), 0);
  const nb = types.reduce((s, t) => s + (black.counts[t] ?? 0), 0);
  const pieces = nw + nb + 2; // + two kings
  const free = squares - pw - pb;

  const pawnSquareChoice = binom(pawnSquares, pw + pb); // which squares hold pawns
  const pawnColouring = binom(pw + pb, pw); // which of those are white
  const pieceSquareChoice = free >= 0 ? binom(free, pieces) : 0n; // squares for kings and pieces
  let arrangementDenom = 1n;
  for (const t of types) arrangementDenom *= factorial(white.counts[t] ?? 0) * factorial(black.counts[t] ?? 0);
  const arrangement = pieces <= free ? factorial(pieces) / arrangementDenom : 0n; // identical pieces swap freely

  return {
    pawnSquares, free, pieces,
    pawnSquareChoice, pawnColouring, pieceSquareChoice, arrangement,
    total: pawnSquareChoice * pawnColouring * pieceSquareChoice * arrangement,
  };
}

// Group one side's materials by (pawns, non-king pieces) with a dynamic
// program over piece types, so large armies stay fast. The weight of a group
// is sum of D / prod(count!) over its materials, where D = prod(max count!),
// which keeps everything an integer. Also counts the materials themselves.
function sideWeights(p) {
  const types = Object.keys(p.army);
  const max = maxCounts(p);
  const D = types.reduce((d, t) => d * factorial(max[t]), 1n);
  // dp: "n,e" -> [weight, count], n = pieces so far, e = promoted pieces so far
  let dp = new Map([["0,0", [1n, 1]]]);
  for (const t of types) {
    const next = new Map();
    for (const [key, [w, c]] of dp) {
      const [n, e] = key.split(",").map(Number);
      for (let k = 0; k <= max[t]; k++) {
        const e2 = e + Math.max(0, k - p.army[t]);
        if (e2 > p.pawns) break;
        const k2 = `${n + k},${e2}`;
        const prev = next.get(k2) ?? [0n, 0];
        next.set(k2, [prev[0] + w * (factorial(max[t]) / factorial(k)), prev[1] + c]);
      }
    }
    dp = next;
  }
  const weights = new Map();
  let materials = 0;
  for (const [key, [w, c]] of dp) {
    const [n, e] = key.split(",").map(Number);
    for (let pawns = 0; pawns + e <= p.pawns; pawns++) {
      const k = `${pawns},${n}`;
      weights.set(k, (weights.get(k) ?? 0n) + w);
      materials += c;
    }
  }
  return { weights, D, materials };
}

// Number of materials one side can have.
export function materialCount(params) {
  return sideWeights(withDefaults(params)).materials;
}

// A random material one side can have (not uniformly distributed).
export function randomMaterial(params, rand = Math.random) {
  const p = withDefaults(params);
  const types = Object.keys(p.army);
  const max = maxCounts(p);
  for (let tries = 0; tries < 1000; tries++) {
    const pawns = Math.floor(rand() * (p.pawns + 1));
    const counts = {};
    for (const t of types) counts[t] = Math.floor(rand() * (Math.min(max[t], p.army[t] + p.pawns - pawns) + 1));
    if (isFeasible({ pawns, counts }, p)) return { pawns, counts };
  }
  return { pawns: p.pawns, counts: { ...p.army } };
}

// Number of placements where each side has one king, no pawn is on the first or
// last rank, and each side's material is reachable from the starting army.
// Returns the total plus breakdowns by pieces on the board and by pawn counts.
export function placementsUpperBound(params) {
  const p = withDefaults(params);
  const squares = p.rows * p.cols;
  const pawnSquares = Math.max(0, p.rows - 2) * p.cols;
  const { weights, D } = sideWeights(p);
  const D2 = D * D;
  let scaled = 0n;
  const byPieces = new Map(); // total men on board -> scaled count
  const byPawns = new Map(); // "pw,pb" -> scaled count
  const keys = [...weights.keys()].map((k) => k.split(",").map(Number));
  for (const [pw, nw] of keys) {
    for (const [pb, nb] of keys) {
      if (pw + pb > pawnSquares) continue;
      const free = squares - pw - pb;
      const pieces = nw + nb + 2;
      if (pieces > free) continue;
      const term = multinomial(pawnSquares, [pw, pb]) * (factorial(free) / factorial(free - pieces))
        * weights.get(`${pw},${nw}`) * weights.get(`${pb},${nb}`);
      scaled += term;
      const men = pw + pb + pieces;
      byPieces.set(men, (byPieces.get(men) ?? 0n) + term);
      byPawns.set(`${pw},${pb}`, (byPawns.get(`${pw},${pb}`) ?? 0n) + term);
    }
  }
  if (scaled % D2 !== 0n) throw new Error("internal error: non-integer total");
  const unscale = (m) => new Map([...m].sort((a, b) => (a[0] > b[0] ? 1 : -1)).map(([k, v]) => [k, v / D2]));
  return { total: scaled / D2, byPieces: unscale(byPieces), byPawns: unscale(byPawns), materialsPerSide: sideWeights(p).materials };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                           */
/* ------------------------------------------------------------------ */
export function toScientific(n, digits = 3) {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString();
  if (s.length <= digits + 3) return (neg ? "-" : "") + Number(s).toLocaleString("en-US");
  // Round to digits + 1 significant figures, carrying into the exponent if needed.
  let lead = BigInt(s.slice(0, digits + 1));
  if (Number(s[digits + 1]) >= 5) lead += 1n;
  let exp = s.length - 1;
  let ls = lead.toString();
  if (ls.length > digits + 1) { ls = ls.slice(0, digits + 1); exp += 1; }
  return `${neg ? "-" : ""}${ls[0]}.${ls.slice(1)} × 10^${exp}`;
}

export function log10(n) {
  if (n <= 0n) return -Infinity;
  const s = n.toString();
  return s.length - 1 + Math.log10(Number(`0.${s.slice(0, 15)}`) * 10);
}
