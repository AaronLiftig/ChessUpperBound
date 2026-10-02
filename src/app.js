import {
  binom, cumulativeCounts, totalCombinations,
  isFeasible, materialPlacements, placementsUpperBound, randomMaterial,
  toScientific, log10,
} from "./counting.js";

const $ = (sel) => document.querySelector(sel);
const SVG_NS = "http://www.w3.org/2000/svg";
const TEXT = "\uFE0E"; // ask for text (not emoji) glyphs
const SOLID = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" };
const OUTLINE = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙" };
const TERM_ORDER = ["material", "pawnsq", "colour", "piecesq", "arrange"];

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}
const sciHtml = (n) => {
  const s = toScientific(n, 3);
  const m = s.match(/^(.*) × 10\^(\d+)$/);
  return m ? `${m[1]} × 10<sup>${m[2]}</sup>` : s;
};
const fmt = (n) => Number(n).toLocaleString("en-US");
const plural = (n, word, many = word + "s") => `${fmt(n)} ${n === 1 ? word : many}`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ------------------------------------------------------------------ */
/* Games                                                               */
/* ------------------------------------------------------------------ */
const P = (letter, name, count, promotes = true) => ({ letter, name, count, promotes });
const PRESETS = {
  standard: { name: "Standard chess", rows: 8, cols: 8, pawns: 8, pieces: [P("Q", "Queen", 1), P("R", "Rook", 2), P("B", "Bishop", 2), P("N", "Knight", 2)] },
  fiveBishops: { name: "Five bishops a side", rows: 8, cols: 8, pawns: 8, pieces: [P("Q", "Queen", 1), P("R", "Rook", 2), P("B", "Bishop", 5), P("N", "Knight", 2)] },
  capablanca: { name: "Capablanca chess (10×8)", rows: 8, cols: 10, pawns: 10, pieces: [P("Q", "Queen", 1), P("R", "Rook", 2), P("B", "Bishop", 2), P("N", "Knight", 2), P("A", "Archbishop", 1), P("C", "Chancellor", 1)] },
  losAlamos: { name: "Los Alamos chess (6×6)", rows: 6, cols: 6, pawns: 6, pieces: [P("Q", "Queen", 1), P("R", "Rook", 2), P("N", "Knight", 2)] },
  gardner: { name: "Gardner minichess (5×5)", rows: 5, cols: 5, pawns: 5, pieces: [P("Q", "Queen", 1), P("R", "Rook", 1), P("B", "Bishop", 1), P("N", "Knight", 1)] },
};
const clone = (g) => JSON.parse(JSON.stringify(g));

let game = clone(PRESETS.standard);
let gameId = "standard";
let params = toParams(game);

function toParams(g) {
  const army = {};
  const promotions = [];
  for (const p of g.pieces) { army[p.letter] = p.count; if (p.promotes) promotions.push(p.letter); }
  return { rows: g.rows, cols: g.cols, pawns: g.pawns, army, promotions };
}
const types = () => game.pieces.map((p) => p.letter);
const pieceName = (letter, n = 1) => {
  if (letter === "K") return n === 1 ? "king" : "kings";
  if (letter === "P") return n === 1 ? "pawn" : "pawns";
  const name = (game.pieces.find((p) => p.letter === letter)?.name || letter).toLowerCase();
  return n === 1 ? name : name + "s";
};
const pawnSquares = () => Math.max(0, game.rows - 2) * game.cols;
const squares = () => game.rows * game.cols;

function glyphHtml(letter, side) {
  if (SOLID[letter]) return `<span aria-hidden="true">${(side === "white" ? OUTLINE : SOLID)[letter]}${TEXT}</span>`;
  return `<span class="letter-glyph ${side}" aria-hidden="true">${escapeHtml(letter)}</span>`;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
const startMaterial = () => ({ pawns: game.pawns, counts: { ...params.army } });
const state = { term: "pawnsq", preview: null, white: null, black: null, sample: null };
let whole = null;
const activeKey = () => state.preview ?? state.term;

const TERMS = {
  material: {
    label: "Materials",
    title: "Every material each side could have",
    body: () => `The sum runs over every combination of pieces White and Black could have. Extra pieces only come from promoting pawns, so for each side <em>pawns + promoted pieces ≤ ${game.pawns}</em>. Each side always has its king. On the board, promoted pieces are shaded darker.`,
    tip: () => `Adds up the four factors over every pair of materials the two sides could have.`,
    value: () => `${fmt(whole.materialsPerSide)} materials per side`,
  },
  pawnsq: {
    label: "Pawn squares",
    title: "Which squares hold pawns",
    body: (f, w, b) => `Pawns can never stand on the first or last rank, which leaves ${pawnSquares()} squares (shaded). Choose ${w.pawns + b.pawns} of them for the ${plural(w.pawns + b.pawns, "pawn")}.`,
    tip: (f, w, b) => `Choose ${w.pawns + b.pawns} of the ${pawnSquares()} shaded squares for the pawns.`,
    value: (f, w, b) => `C(${pawnSquares()}, ${w.pawns + b.pawns}) = ${sciHtml(f.pawnSquareChoice)}`,
  },
  colour: {
    label: "Pawn colours",
    title: "Which of those pawns are White's",
    body: (f, w, b) => `Of the ${w.pawns + b.pawns} pawn squares, choose the ${w.pawns} that hold white pawns (shaded darker). The rest are Black's.`,
    tip: (f, w, b) => `Pick which ${w.pawns} of the ${w.pawns + b.pawns} pawns are White's.`,
    value: (f, w, b) => `C(${w.pawns + b.pawns}, ${w.pawns}) = ${sciHtml(f.pawnColouring)}`,
  },
  piecesq: {
    label: "Piece squares",
    title: "Which squares hold the other men",
    body: (f) => `After the pawns, ${f.free} squares are left anywhere on the board (shaded). Choose ${f.pieces} of them for the two kings and the ${plural(f.pieces - 2, "other piece")}.`,
    tip: (f) => `Choose ${f.pieces} of the ${f.free} squares left after the pawns, for the kings and pieces.`,
    value: (f) => `C(${f.free}, ${f.pieces}) = ${sciHtml(f.pieceSquareChoice)}`,
  },
  arrange: {
    label: "Arrangement",
    title: "Who stands on which of those squares",
    body: (f, w, b) => {
      const groups = [];
      for (const [side, m] of [["white", w], ["black", b]]) for (const t of types()) if (m.counts[t] > 1) groups.push(`${m.counts[t]} ${side} ${pieceName(t, 2)}`);
      const dup = groups.length ? `Identical pieces swapping places gives the same position, so divide by the factorial of each group (${groups.join(", ")}).` : "There are no repeated pieces in this material, so nothing is divided out.";
      return `Put the ${f.pieces} men on the chosen squares in every possible order: ${f.pieces}!. ${dup}`;
    },
    tip: (f) => `Order the ${f.pieces} men on their squares, without counting swaps of identical pieces.`,
    value: (f) => sciHtml(f.arrangement),
  },
};

/* ------------------------------------------------------------------ */
/* Formula and hover previews                                           */
/* ------------------------------------------------------------------ */
function renderTex(el, tex, plain) {
  if (window.katex) window.katex.render(tex, el, { displayMode: true, trust: true, strict: false, throwOnError: false });
  else el.textContent = plain;
}

const narrow = window.matchMedia("(max-width: 600px)");

function renderFormula() {
  const el = $("#formula");
  const parts = [
    String.raw`\htmlClass{t-material}{\sum_{W,\,B}}\;\htmlClass{t-pawnsq}{\binom{${pawnSquares()}}{p_W+p_B}}\cdot\htmlClass{t-colour}{\binom{p_W+p_B}{p_W}}`,
    String.raw`\htmlClass{t-piecesq}{\binom{${squares()}-p_W-p_B}{n}}\cdot\htmlClass{t-arrange}{\frac{n!}{\prod c!}}`,
  ];
  const tex = narrow.matches
    ? String.raw`\begin{aligned}N \le {}& ${parts[0]}\\ &\cdot ${parts[1]}\end{aligned}`
    : String.raw`N \le ${parts[0]}\cdot ${parts[1]}`;
  renderTex(el, tex, `N ≤ Σ over materials W, B of C(${pawnSquares()}, pW+pB) · C(pW+pB, pW) · C(${squares()}−pW−pB, n) · n! / ∏ c!`);
  for (const key of TERM_ORDER) {
    el.querySelectorAll(`.t-${key}`).forEach((node) => {
      node.classList.add("term");
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", TERMS[key].label);
      node.addEventListener("mouseenter", () => startPreview(key));
      node.addEventListener("mouseleave", endPreview);
      node.addEventListener("focus", () => startPreview(key));
      node.addEventListener("blur", endPreview);
      node.addEventListener("click", () => setTerm(key));
      node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTerm(key); } });
    });
  }
  markActive();
}

function setupTermButtons() {
  const buttons = $("#term-buttons");
  for (const key of TERM_ORDER) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `t-${key}`;
    b.setAttribute("role", "tab");
    b.dataset.term = key;
    b.textContent = TERMS[key].label;
    b.addEventListener("click", () => setTerm(key));
    b.addEventListener("mouseenter", () => startPreview(key));
    b.addEventListener("mouseleave", endPreview);
    buttons.appendChild(b);
  }
}

function markActive() {
  const key = activeKey();
  $("#formula").classList.add("has-active");
  document.querySelectorAll("#formula .term").forEach((n) => n.classList.toggle("active", n.classList.contains(`t-${key}`)));
  document.querySelectorAll("#term-buttons button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.term === state.term)));
}

function startPreview(key) {
  state.preview = key;
  markActive();
  showTip(key);
  renderExplainer();
  renderBoard();
}

function endPreview() {
  state.preview = null;
  $("#term-tip").hidden = true;
  markActive();
  renderExplainer();
  renderBoard();
}

function setTerm(key) {
  state.term = key;
  markActive();
  renderExplainer();
  renderBoard();
}

function showTip(key) {
  const node = $(`#formula .t-${key}`);
  const tip = $("#term-tip");
  const section = $(".formula-section");
  if (!node) return;
  const f = materialPlacements(state.white, state.black, params);
  const t = TERMS[key];
  tip.className = `term-tip t-${key}`;
  tip.innerHTML = `<strong>${t.title}</strong>${t.tip(f, state.white, state.black)}<span class="tip-value">${t.value(f, state.white, state.black)}</span>`;
  tip.hidden = false;
  const r = node.getBoundingClientRect();
  const s = section.getBoundingClientRect();
  const width = tip.offsetWidth;
  const left = Math.max(0, Math.min(r.left - s.left + r.width / 2 - width / 2, s.width - width));
  tip.style.left = `${left}px`;
  tip.style.top = `${r.bottom - s.top + 22}px`;
}

/* ------------------------------------------------------------------ */
/* Material editor                                                      */
/* ------------------------------------------------------------------ */
function renderSides() {
  const wrap = $("#sides");
  wrap.innerHTML = "";
  for (const side of ["white", "black"]) {
    const m = state[side];
    const box = document.createElement("div");
    box.className = "side";
    box.innerHTML = `<h4>${side === "white" ? "White" : "Black"}</h4>`;
    for (const kind of ["P", ...types()]) {
      const value = kind === "P" ? m.pawns : m.counts[kind];
      const name = pieceName(kind, 2);
      const row = document.createElement("div");
      row.className = "stepper";
      row.innerHTML = `<span class="glyph">${glyphHtml(kind, side)}</span><span>${name[0].toUpperCase() + name.slice(1)}</span>
        <span class="controls"><button type="button" aria-label="Remove one ${side} ${pieceName(kind)}">−</button><output>${value}</output><button type="button" aria-label="Add one ${side} ${pieceName(kind)}">+</button></span>`;
      const [minus, plus] = row.querySelectorAll("button");
      minus.disabled = !canChange(side, kind, -1);
      const blocked = blockedReason(side, kind);
      if (blocked) { plus.setAttribute("aria-disabled", "true"); plus.title = blocked; }
      minus.addEventListener("click", () => change(side, kind, -1));
      plus.addEventListener("click", () => {
        if (blocked) { box.querySelector(".notice").textContent = blocked; return; }
        change(side, kind, +1);
      });
      box.appendChild(row);
    }
    const promoted = types().reduce((e, t) => e + Math.max(0, m.counts[t] - params.army[t]), 0);
    const missing = game.pawns - m.pawns;
    box.insertAdjacentHTML("beforeend", `<p class="budget">${plural(missing, "pawn")} missing, ${plural(promoted, "promoted piece")}</p><p class="notice" aria-live="polite"></p>`);
    wrap.appendChild(box);
  }
}

function changed(m, kind, delta) {
  const next = { pawns: m.pawns, counts: { ...m.counts } };
  if (kind === "P") next.pawns += delta; else next.counts[kind] += delta;
  return next;
}
function fitsBoard(w, b) {
  const men = w.pawns + b.pawns + 2 + types().reduce((s, t) => s + w.counts[t] + b.counts[t], 0);
  return w.pawns + b.pawns <= pawnSquares() && men <= squares();
}
function canChange(side, kind, delta) {
  const next = changed(state[side], kind, delta);
  if (!isFeasible(next, params)) return false;
  return fitsBoard(side === "white" ? next : state.white, side === "black" ? next : state.black);
}
// Why "+" is unavailable for this piece, in plain words, or null if it is allowed.
function blockedReason(side, kind) {
  if (canChange(side, kind, +1)) return null;
  const m = state[side];
  const promoted = types().reduce((e, t) => e + Math.max(0, m.counts[t] - params.army[t]), 0);
  const next = changed(m, kind, +1);
  if (isFeasible(next, params)) return "The board has no free squares left.";
  if (kind === "P") return m.pawns >= game.pawns ? `Each side starts with ${game.pawns} pawns, so it cannot have more.` : `Each promoted piece used up a pawn. Remove a promoted piece to bring a pawn back.`;
  const name = pieceName(kind);
  if (!params.promotions.includes(kind)) return `Pawns cannot promote to a ${name}, so ${params.army[kind]} is the most a side can have.`;
  if (m.pawns > 0) return `An extra ${name} has to come from a promoted pawn. Remove a pawn first.`;
  return `All ${game.pawns} pawns have already promoted (${promoted} promoted pieces).`;
}

function change(side, kind, delta) {
  if (!canChange(side, kind, delta)) return;
  state[side] = changed(state[side], kind, delta);
  updateExplorer(true);
}

function materialPreset(name) {
  if (name === "start") { state.white = startMaterial(); state.black = startMaterial(); }
  if (name === "half") {
    const half = () => ({ pawns: Math.floor(game.pawns / 2), counts: Object.fromEntries(types().map((t) => [t, Math.floor(params.army[t] / 2)])) });
    state.white = half(); state.black = half();
  }
  if (name === "random") {
    do { state.white = randomMaterial(params); state.black = randomMaterial(params); } while (!fitsBoard(state.white, state.black));
  }
  updateExplorer(true);
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function samplePosition() {
  const { white: w, black: b } = state;
  const n = squares();
  const board = new Array(n).fill(null);
  const legal = [];
  for (let sq = game.cols; sq < n - game.cols; sq++) legal.push(sq);
  shuffled(legal).slice(0, w.pawns + b.pawns).forEach((sq, i) => { board[sq] = { side: i < w.pawns ? "white" : "black", kind: "P" }; });
  const men = [{ side: "white", kind: "K" }, { side: "black", kind: "K" }];
  for (const [side, m] of [["white", w], ["black", b]]) {
    for (const t of types()) for (let i = 0; i < m.counts[t]; i++) men.push({ side, kind: t, promoted: i >= params.army[t] });
  }
  const free = shuffled([...Array(n).keys()].filter((sq) => !board[sq])).slice(0, men.length);
  shuffled(men).forEach((man, i) => { board[free[i]] = man; });
  state.sample = board;
}

function renderBoard() {
  const el = $("#board");
  el.innerHTML = "";
  const s = 50, rows = game.rows, cols = game.cols;
  el.setAttribute("viewBox", `0 0 ${cols * s} ${rows * s}`);
  const key = activeKey();
  const color = getComputedStyle(document.documentElement).getPropertyValue(`--t-${key}`);
  const files = "abcdefghijklmnopqrstuvwxyz";
  for (let sq = 0; sq < rows * cols; sq++) {
    const r = Math.floor(sq / cols), c = sq % cols;
    svg("rect", { x: c * s, y: r * s, width: s, height: s, class: (r + c) % 2 ? "sq-dark" : "sq-light" }, el);
    const man = state.sample[sq];
    const isPawn = man?.kind === "P";
    let mark = null;
    if (key === "pawnsq" && r >= 1 && r <= rows - 2) mark = isPawn ? "strong" : "light";
    if (key === "colour" && isPawn) mark = man.side === "white" ? "strong" : "light";
    if (key === "piecesq" && !isPawn) mark = man ? "strong" : "light";
    if (key === "arrange" && man && !isPawn) mark = "strong";
    if (key === "material" && man) mark = man.promoted ? "strong" : "light";
    if (mark) svg("rect", { x: c * s, y: r * s, width: s, height: s, class: `sq-mark ${mark === "strong" ? "strong" : ""}`, style: `--c:${color}` }, el);
    if (c === 0) svg("text", { x: 3, y: r * s + 11, class: "sq-label" }, el).textContent = rows - r;
    if (r === rows - 1) svg("text", { x: c * s + s - 9, y: rows * s - 4, class: "sq-label" }, el).textContent = files[c];
    if (man) drawMan(el, man, c * s + s / 2, r * s + s / 2 + 1);
  }
  const names = state.sample.map((m, sq) => m && `${m.side} ${pieceName(m.kind)} on ${files[sq % cols]}${rows - Math.floor(sq / cols)}`).filter(Boolean);
  el.setAttribute("aria-label", `Sample position: ${names.join(", ")}`);
  $("#board-caption").textContent = "One of the positions counted for this material.";
}

function drawMan(el, man, x, y) {
  if (SOLID[man.kind]) {
    svg("text", { x, y, class: `piece ${man.side}` }, el).textContent = SOLID[man.kind] + TEXT;
  } else {
    svg("circle", { cx: x, cy: y - 1, r: 16, class: `token-bg ${man.side}` }, el);
    svg("text", { x, y: y - 1, class: `token-text ${man.side}`, "font-size": 18 }, el).textContent = man.kind;
  }
}

/* ------------------------------------------------------------------ */
/* Explainer and product                                                */
/* ------------------------------------------------------------------ */
function renderExplainer() {
  const f = materialPlacements(state.white, state.black, params);
  const key = activeKey();
  const t = TERMS[key];
  const el = $("#explainer");
  el.className = `term-explainer t-${key}`;
  el.innerHTML = `<h3>${t.title}</h3><p>${t.body(f, state.white, state.black)}</p><p class="value">${t.value(f, state.white, state.black)}</p>`;

  const factors = [["pawnsq", f.pawnSquareChoice], ["colour", f.pawnColouring], ["piecesq", f.pieceSquareChoice], ["arrange", f.arrangement]];
  const p = $("#product");
  p.innerHTML = "";
  factors.forEach(([k, v], i) => {
    if (i) p.insertAdjacentHTML("beforeend", `<span class="op">×</span>`);
    const span = document.createElement("span");
    span.className = `factor t-${k}`;
    span.tabIndex = 0;
    span.title = `${TERMS[k].label}: ${v.toLocaleString("en-US")}`;
    span.innerHTML = sciHtml(v);
    span.addEventListener("click", () => setTerm(k));
    span.addEventListener("mouseenter", () => startPreview(k));
    span.addEventListener("mouseleave", endPreview);
    span.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTerm(k); } });
    p.appendChild(span);
  });
  p.insertAdjacentHTML("beforeend", `<span class="op">=</span><span class="result">${sciHtml(f.total)}</span><span class="caption">positions with exactly this material, one term of the sum</span>`);
}

function updateExplorer(resample) {
  if (resample) samplePosition();
  renderSides();
  renderExplainer();
  renderBoard();
}

/* ------------------------------------------------------------------ */
/* Whole sum and game result                                            */
/* ------------------------------------------------------------------ */
let standardTotal = null;

function renderHeadline() {
  const name = gameId === "custom" ? "your game" : gameId === "standard" ? "standard chess" : PRESETS[gameId].name;
  $("#headline").innerHTML = `Upper bound for ${escapeHtml(name)}: <strong>${sciHtml(whole.total)}</strong> positions`;
}

function renderGameResult() {
  const el = $("#game-result");
  let compare = "";
  if (gameId !== "standard") {
    const diff = log10(whole.total) - log10(standardTotal);
    const mag = Math.abs(diff);
    const times = mag < 3 ? `${(10 ** mag).toFixed(mag < 1 ? 2 : 1)} times` : `about 10<sup>${Math.round(mag)}</sup> times`;
    compare = `<p class="compare">${diff >= 0 ? `${times} as many as` : `${times} smaller than`} standard chess.</p>`;
  }
  el.innerHTML = `<h3>${escapeHtml(gameId === "custom" ? "Your game" : PRESETS[gameId].name)}</h3>
    <p class="big">${sciHtml(whole.total)}</p>
    <p>positions at most</p>
    ${compare}`;
  renderGameSelect();
  renderHeadline();
}

function renderGameSelect() {
  const sel = $("#game-select");
  sel.innerHTML = Object.entries(PRESETS).map(([id, g]) => `<option value="${id}" ${id === gameId ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join("")
    + `<option value="custom" ${gameId === "custom" ? "selected" : ""} ${gameId === "custom" ? "" : "disabled"}>Your own game</option>`;
}

/* ------------------------------------------------------------------ */
/* Game editor                                                          */
/* ------------------------------------------------------------------ */
function renderPresets() {
  const wrap = $("#game-presets");
  wrap.innerHTML = "";
  for (const [id, g] of Object.entries(PRESETS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = g.name;
    b.setAttribute("aria-pressed", String(id === gameId));
    b.addEventListener("click", () => choosePreset(id));
    wrap.appendChild(b);
  }
}

function choosePreset(id) {
  game = clone(PRESETS[id]);
  gameId = id;
  renderGameEditor();
  applyGame();
}

function renderGameEditor() {
  $("#g-rows").value = game.rows;
  $("#g-cols").value = game.cols;
  $("#g-pawns").value = game.pawns;
  const body = $("#g-pieces");
  body.innerHTML = "";
  game.pieces.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input class="letter" type="text" maxlength="1" value="${escapeHtml(p.letter)}" aria-label="Letter for piece ${i + 1}"></td>
      <td><input type="text" value="${escapeHtml(p.name)}" aria-label="Name of piece ${i + 1}"></td>
      <td><input type="number" min="0" max="10" value="${p.count}" aria-label="How many ${escapeHtml(p.name || "pieces")} per side"></td>
      <td><input type="checkbox" ${p.promotes ? "checked" : ""} aria-label="Pawns can promote to ${escapeHtml(p.name || "this piece")}"></td>
      <td><button type="button">Remove</button></td>`;
    const [letter, name, count, promotes] = tr.querySelectorAll("input");
    letter.addEventListener("input", () => { p.letter = letter.value.toUpperCase(); edited(); });
    name.addEventListener("input", () => { p.name = name.value; edited(false); });
    count.addEventListener("input", () => { p.count = Number(count.value); edited(); });
    promotes.addEventListener("change", () => { p.promotes = promotes.checked; edited(); });
    tr.querySelector("button").addEventListener("click", () => { game.pieces.splice(i, 1); renderGameEditor(); edited(); });
    body.appendChild(tr);
  });
  $("#g-add").disabled = game.pieces.length >= 8;
  renderPresets();
}

let editTimer = null;
function edited(recount = true) {
  gameId = "custom";
  renderPresets();
  renderGameSelect();
  clearTimeout(editTimer);
  editTimer = setTimeout(() => applyGame(recount), 350);
}

function validateGame() {
  const { rows, cols, pawns, pieces } = game;
  const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!whole(rows, 3, 12) || !whole(cols, 3, 12)) return "Ranks and files must each be a whole number from 3 to 12.";
  if (!whole(pawns, 0, 16)) return "Pawns per side must be a whole number from 0 to 16.";
  if (2 * pawns > pawnSquares()) return `Both sides' ${2 * pawns} pawns do not fit on the ${pawnSquares()} squares pawns can use.`;
  const seen = new Set();
  for (const p of pieces) {
    if (!/^[A-Z]$/.test(p.letter)) return "Each piece needs a single letter from A to Z.";
    if (p.letter === "K" || p.letter === "P") return "K and P are used for the king and pawns. Choose another letter.";
    if (seen.has(p.letter)) return `The letter ${p.letter} is used twice. Give each piece its own letter.`;
    seen.add(p.letter);
    if (!whole(p.count, 0, 10)) return `${p.name || p.letter}: the number per side must be a whole number from 0 to 10.`;
  }
  const men = 2 * (1 + pawns + pieces.reduce((s, p) => s + p.count, 0));
  if (men > rows * cols) return `The starting armies have ${men} men, more than the ${rows * cols} squares on the board.`;
  return null;
}

function applyGame(recount = true) {
  game.rows = Number($("#g-rows").value);
  game.cols = Number($("#g-cols").value);
  game.pawns = Number($("#g-pawns").value);
  const error = validateGame();
  $("#g-error").textContent = error ?? "";
  if (error) return;
  if (!recount) { renderSides(); renderBoard(); renderGameResult(); syncCombos(); return; }
  $("#game-result").setAttribute("aria-busy", "true");
  $("#game-result").insertAdjacentHTML("afterbegin", `<p class="hint" id="calculating">Calculating…</p>`);
  setTimeout(() => {
    params = toParams(game);
    whole = placementsUpperBound(params);
    state.white = startMaterial();
    state.black = startMaterial();
    renderFormula();
    updateExplorer(true);
    renderGameResult();
    syncCombos();
    $("#game-result").removeAttribute("aria-busy");
  }, 20);
}

/* ------------------------------------------------------------------ */
/* Piece combinations                                                   */
/* ------------------------------------------------------------------ */
const combo = { spec: {}, columns: [], heights: [], rows: [] };

function gameColumns() {
  const cols = [];
  for (const side of ["white", "black"]) for (const p of game.pieces) if (p.count > 0) cols.push({ label: glyphHtml(p.letter, side), size: p.count, name: `${side} ${pieceName(p.letter, 2)}` });
  return cols;
}

function specFromColumns(cols) {
  const spec = {};
  for (const c of cols) spec[c.size] = (spec[c.size] ?? 0) + 1;
  return spec;
}

function syncCombos() {
  const cols = gameColumns();
  if (cols.length === 0) {
    combo.rows = [[1, 1]];
    setSpec({ 1: 1 });
    return;
  }
  combo.columns = cols;
  combo.spec = specFromColumns(cols);
  combo.rows = Object.entries(combo.spec).map(([j, a]) => [Number(j), a]).sort((a, b) => b[0] - a[0]);
  combo.heights = cols.map((c) => c.size);
  renderCombos();
}

function setSpec(spec) {
  combo.spec = spec;
  const cols = [];
  let n = 0;
  for (const j of Object.keys(spec).map(Number).sort((a, b) => b - a)) {
    for (let i = 0; i < spec[j]; i++) { const L = String.fromCharCode(65 + (n++ % 26)); cols.push({ label: `<span class="text">${L}</span>`, size: j, name: `kind ${L}` }); }
  }
  combo.columns = cols;
  combo.heights = cols.map((c) => c.size);
  renderCombos();
}

function renderCombos() {
  const sky = $("#skyline");
  sky.innerHTML = "";
  combo.columns.forEach((col, ci) => {
    const c = document.createElement("div");
    c.className = "column";
    const label = document.createElement("span");
    label.className = "label";
    label.innerHTML = col.label;
    const zero = document.createElement("button");
    zero.type = "button";
    zero.className = "zero-btn";
    zero.textContent = "0";
    zero.setAttribute("aria-label", `Keep no ${col.name}`);
    zero.addEventListener("click", () => { combo.heights[ci] = 0; renderCombos(); });
    c.append(label, zero);
    for (let h = 1; h <= col.size; h++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `cell ${h <= combo.heights[ci] ? "kept" : ""}`;
      cell.setAttribute("aria-label", `Keep ${h} ${col.name}`);
      cell.setAttribute("aria-pressed", String(h <= combo.heights[ci]));
      cell.addEventListener("click", () => { combo.heights[ci] = combo.heights[ci] === h ? h - 1 : h; renderCombos(); });
      c.appendChild(cell);
    }
    sky.appendChild(c);
  });

  const levels = cumulativeCounts(combo.spec);
  const idx = levels.map(([j]) => combo.heights.filter((h) => h === j).length);
  let used = 0;
  const factors = levels.map(([, A], k) => { const f = binom(A - used, idx[k]); const s = `C(${A - used}, ${idx[k]})`; used += idx[k]; return [s, f]; });
  const termValue = factors.reduce((a, [, f]) => a * f, 1n);
  const kept = combo.heights.reduce((a, b) => a + b, 0);
  const total = totalCombinations(combo.spec);
  const idxText = levels.map(([j], k) => `i<sub>${j}</sub> = ${idx[k]}`).join(", ");
  const meaning = levels.map(([j], k) => `${plural(idx[k], "kind")} keep${idx[k] === 1 ? "s" : ""} ${j}`).join(", ");
  $("#combo-readout").innerHTML = `This choice keeps <strong>${plural(kept, "piece")}</strong>: ${meaning}. It belongs to the term ${idxText}, which counts ${factors.map(([s]) => s).join(" · ")} = <strong>${termValue.toLocaleString("en-US")}</strong> choice${termValue === 1n ? "" : "s"} with the same pattern, out of ${total.toLocaleString("en-US")} in all.`;

  const top = levels[0][0];
  const sums = levels.map(([j], k) => {
    const prev = levels.slice(0, k).map(([jj]) => `i_{${jj}}`).join("+");
    return `\\sum_{i_{${j}}=0}^{A_{${j}}${prev ? (k > 1 ? "-(" + prev + ")" : "-" + prev) : ""}}`;
  });
  const shown = levels.length > 3 ? [sums[0], "\\cdots", sums[sums.length - 1].replace(/\^\{.*\}$/, "^{\\cdots}")] : sums;
  const tex = `${shown.join("")}\\prod_{j=1}^{${top}}\\binom{A_j-\\sum_{k>j}i_k}{i_j}\\;=\\;\\prod_{j}(j+1)^{a_j}\\;=\\;${total.toLocaleString("en-US").replace(/,/g, "{,}")}`;
  renderTex($("#combo-formula"), tex, `Nested sum = ∏ (j+1)^(a_j) = ${total.toLocaleString("en-US")}`);

  const rows = levels.map(([j, A], k) => `<tr class="${idx[k] ? "current" : ""}"><td>${j}</td><td>${combo.spec[j] ?? 0}</td><td>${A}</td><td>${idx[k]}</td></tr>`).join("");
  $("#combo-levels").innerHTML = `<table class="levels"><thead><tr><th>Copies j</th><th>Kinds with exactly j (a<sub>j</sub>)</th><th>Kinds with at least j (A<sub>j</sub>)</th><th>Your choice (i<sub>j</sub>)</th></tr></thead><tbody>${rows}</tbody></table>`;

}

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */
function init() {
  params = toParams(game);
  whole = placementsUpperBound(params);
  standardTotal = whole.total;
  state.white = startMaterial();
  state.black = startMaterial();

  setupTermButtons();
  renderFormula();
  samplePosition();
  renderSides();
  setTerm(state.term);
  renderGameEditor();
  renderGameResult();
  syncCombos();

  const caption = document.createElement("p");
  caption.className = "hint";
  caption.innerHTML = "p<sub>W</sub>, p<sub>B</sub>: pawns of each side. n: kings and other pieces. c: the size of each group of identical pieces.";
  $("#term-buttons").before(caption);

  $("#shuffle").addEventListener("click", () => { samplePosition(); renderBoard(); });
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => materialPreset(b.dataset.preset)));
  $("#combo-all").addEventListener("click", () => { combo.heights = combo.columns.map((c) => c.size); renderCombos(); });
  $("#combo-none").addEventListener("click", () => { combo.heights = combo.columns.map(() => 0); renderCombos(); });
  $("#game-select").addEventListener("change", (e) => { if (PRESETS[e.target.value]) choosePreset(e.target.value); });
  narrow.addEventListener("change", renderFormula);
  for (const id of ["#g-rows", "#g-cols", "#g-pawns"]) $(id).addEventListener("input", () => edited());
  $("#g-add").addEventListener("click", () => {
    const used = new Set(game.pieces.map((p) => p.letter));
    const letter = [..."ACDEFGHIJLMOSTUVWXYZ"].find((l) => !used.has(l)) ?? "Z";
    game.pieces.push({ letter, name: "New piece", count: 1, promotes: true });
    renderGameEditor();
    edited();
  });
}

init();
