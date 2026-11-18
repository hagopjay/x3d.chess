// ADVANCED CONCEPT LENS: static strategic/tactical concepts for one position, each with an honest label.
// Pure functions of a FEN (no DOM, no X3D runtime): testable under Node. chess.js is used only to validate the FEN
// and to count LEGAL moves for the side to move; every other quantity comes from this file's own board model.
//
// PUBLIC API
//   conceptsReport(fen)                  -> { fen, concepts:{...}, squares:{conceptId:[squares]}, legend }
//   staticExchange(fen, square)          -> { square, target, gain, best, attackers, defenders, sequence, label } | throws
//   hangingPieces(fen)                   -> [{square,piece,color,attackers,defenders,reasons}]
//   conceptGeometry(report, origin, selected) -> { primitives:[...], buffers:{id:{lines,faces}}, selected:[ids] }
//   conceptsXml(origin, {prefix, buffers}) -> X3D 4.0 Interchange document string (pre-created hidden shapes per concept)
//   conceptUpdates(geometry, {prefix})   -> [{def, field, value}] SAI assignments (point / coordIndex / visible)
//   CONCEPT_IDS, LEGEND, LABELS, SEE_VALUES, TIER_VALUES, ZONE_WEIGHTS
//
// CONVENTIONS: squares are 'a1'..'h8'; colours 'w'/'b'; piece letters lowercase 'pnbrqk'. Lists are sorted by square index
// (a1=0, b1=1 ... h8=63). Coordinates follow board.js sqPos: x = ox + file - 3.5, z = oz + 3.5 - (rank-1), rank 1 on +Z.
//
// WHAT EACH NUMBER IS (full text in LEGEND; the UI must display LEGEND[id].label next to any overlay or number):
//   see            static exchange estimate on one square; NOT engine verified; ignores pins, checks, promotion, en passant
//   hanging        a counting rule over direct attackers/defenders, not "this piece will be lost"
//   pawn concepts  geometric pawn-skeleton facts (pawn files/ranks only)
//   kingZone       geometric attack counts on the 8 neighbours of a king, with an arbitrary weight table (not king safety)
//   mobility       pseudo-legal destination counts for both sides; legal counts for the SIDE TO MOVE ONLY
//
// INTEGRATION (for the lead; this file touches no shared file):
//   scene.js / BoardView per board (index i, origin o). createX3DFromString is ASYNC (board.js awaits it), so cache the promise:
//     this.conceptPromise ??= browser.createX3DFromString(conceptsXml(o, { prefix: `cx${i}` })).then((cx) => { browser.currentScene.addRootNode(cx.rootNodes[0]); return cx; });
//     the resolved scene fragment `cx` must be kept so cx.getNamedNode(def) works for the DEF names in conceptUpdates().
//   on every accepted FEN for that board:
//     const rev = ++this.conceptRevision, epoch = this.epoch;
//     const report = conceptsReport(fen);                              // synchronous, throws RangeError on a bad FEN
//     const geo = conceptGeometry(report, this.origin, this.conceptSelection);   // selection = array of CONCEPT_IDS or null
//     const cx = await this.conceptPromise;                            // the ONLY await: the staleness check must come after it
//     if (rev !== this.conceptRevision || !this._current(epoch)) return;         // drop stale work (a newer FEN / reset / dispose won)
//     for (const u of conceptUpdates(geo, { prefix: `cx${i}` })) {
//       const n = cx.getNamedNode(u.def);
//       if (u.field === 'point')      n.point = new X3D.MFVec3f(...u.value.map(p => new X3D.SFVec3f(...p)));
//       else if (u.field === 'coordIndex') n.coordIndex = new X3D.MFInt32(...u.value);
//       else if (u.field === 'visible')    n.visible = u.value;
//     }
//   toggle (button/key): flip an id in this.conceptSelection, then redo the block above (cheap; no node creation).
//     e.g. key 'c' cycles CONCEPT_IDS one at a time (one named relationship per picture); button row = one per id.
//   clear: on reset(fen)/new generation/dispose: ++this.conceptRevision and apply conceptUpdates(conceptGeometry(lastReport, origin, [])) (empty selection hides and empties every group;
//     a hand-made empty report is REFUSED by conceptGeometry), or simply set every `${prefix}_${id}` group visible=false and empty its point/coordIndex; dispose removes cx.rootNodes[0].
//   UI text: show LEGEND[id].label (+ .definition on hover/details). Show SEE as "static estimate", never "wins".
//   Shapes are pointerEvents='false' so the board TouchSensor keeps picking. Use projectPortableX3D for export.

import { Chess } from "../vendor/chess.js";

export const FILES = "abcdefgh";
/** Piece values for SEE (centipawn-like). King is huge so a king capture into a defended square resolves as a refusal. */
export const SEE_VALUES = Object.freeze({ p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 });
/** Coarse tiers for the 'attacked by a lower-valued piece' test: knight and bishop are equal, king never counts as lower. */
export const TIER_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 1000 });
/** Arbitrary, untuned attack-unit weights for king-zone pressure. */
export const ZONE_WEIGHTS = Object.freeze({ p: 1, n: 2, b: 2, r: 3, q: 5 });

export const CONCEPT_IDS = Object.freeze(["hanging", "see", "isolated", "doubled", "passed", "backward", "connected",
  "outpost", "openFiles", "halfOpenFiles", "rookFile", "kingZone", "bishopPair"]);

const T = (title, label, definition, limits) => Object.freeze({ title, label, definition, limits });
export const LEGEND = Object.freeze({
  schema: "x3dchess.concepts-legend/1",
  conventions: "Lists are sorted by square index a1..h8. w/b are colours. All concepts are static properties of ONE position; none looks ahead.",
  values: { see: SEE_VALUES, tiers: TIER_VALUES, kingZoneWeights: ZONE_WEIGHTS },
  concepts: Object.freeze({
    hanging: T("Hanging piece", "Counting rule, not a forecast",
      "A non-king piece attacked by at least one enemy piece that is (a) undefended (no friendly piece attacks its square) or (b) attacked by an enemy piece of strictly lower tier (P1 < N=B3 < R5 < Q9; king never lower).",
      "Direct attackers only (no x-ray). Pins, checks and whose turn it is are ignored. A hanging piece may be safe in a real line."),
    see: T("Static exchange estimate", "STATIC ESTIMATE; NOT engine-verified",
      "Capture sequence on one square, both sides always recapturing with their least valuable attacker (ties: lowest square index), x-ray attackers revealed as pieces leave, either side may stop. Value table SEE_VALUES. gain is for the FORCED first capture and can be negative; best=max(0,gain). Marked squares have gain>0.",
      "Ignores pins, checks, pawn promotion, en passant and zugzwang/tempo; does not know whose move it is. A positive number is not a won piece."),
    isolated: T("Isolated pawn", "Pawn-file fact", "No friendly pawn on either adjacent file (any rank).", "Says nothing about whether the pawn is actually weak."),
    doubled: T("Doubled pawns", "Pawn-file fact", "Two or more friendly pawns on one file; every pawn on that file is marked. doubledCount = sum(n-1) over such files.", "Static; ignores whether the file is useful."),
    passed: T("Passed pawn", "Pawn-file fact", "No enemy pawn on the same or an adjacent file strictly ahead of it.", "Not a promotion forecast: kings and pieces are ignored."),
    backward: T("Backward pawn (conservative)", "Pawn-file fact, deliberately strict",
      "Not isolated; no friendly pawn on an adjacent file at the same or a LOWER relative rank (nothing behind or beside it can ever support its advance); and the square directly in front is attacked by an enemy pawn.",
      "Conservative: a pawn with any friendly neighbour behind/beside it is never reported, even if that neighbour is blocked. Stop-square occupancy is ignored."),
    connected: T("Connected pawns", "Pawn-file fact", "Phalanx (friendly pawn on an adjacent file, same rank) or supported (a friendly pawn attacks it). Lines join each phalanx pair and each supporter->supported pair.", "A pawn that only supports others (nothing supports it, no neighbour on its rank) is not marked."),
    outpost: T("Outpost", "Pawn-structure fact; also needs a piece",
      "A knight or bishop on its relative rank 4, 5 or 6 (white ranks 4-6; black ranks 5-3), on a square attacked by a friendly pawn, with NO enemy pawn on an adjacent file at a rank from which it could still advance to attack the square (a pawn already level with or past the square cannot).",
      "Pawn captures that change files are ignored. Not a statement that the piece is strong; piece trades ignored."),
    openFiles: T("Open files", "Pawn-file fact", "A file containing no pawn of either colour.", "Says nothing about who controls the file."),
    halfOpenFiles: T("Half-open files", "Pawn-file fact", "A file with no pawn of one colour but at least one pawn of the other. concepts.files.halfOpen.w lists files with no WHITE pawn.", "Marked squares are the files half-open for either colour."),
    rookFile: T("Rook on open/half-open file", "Placement fact", "A rook on an open file, or on a file with no friendly pawn but an enemy pawn (half_open). 'closed' means a friendly pawn is on its file.", "Does not check blockers on the file."),
    kingZone: T("King-zone pressure", "Attack counts, arbitrary weights; NOT king safety",
      "Zone = the up-to-8 squares adjacent to a king. pairs = sum over enemy non-king pieces of the number of zone squares it attacks; attackers = distinct such pieces; weighted = sum of ZONE_WEIGHTS[piece] x its zone squares. Marked squares are zone squares attacked by an enemy piece.",
      "Occupancy-aware attacks only; defenders, pins, shelter pawns and checks are ignored. Weights are untuned."),
    bishopPair: T("Bishop pair", "Material-pattern fact", "A side owns at least one light-squared and one dark-squared bishop.", "Does not evaluate the position type."),
  }),
  mobility: T("Mobility", "Pseudo-legal for both sides; legal for the side to move only",
    "pseudo: number of (from,to) destination squares per piece type summed over that colour's pieces, ignoring pins/checks (a king may 'move into' attacked squares), excluding castling and en passant; pawns count pushes, double pushes and captures of enemy pieces. legal: chess.js legal moves for the side to move, distinct (from,to), castling and en passant included.",
    "An attack-count balance (heat map) is NOT mobility. The non-moving side has no legal count here."),
});
export const LABELS = Object.freeze(Object.fromEntries(Object.entries(LEGEND.concepts).map(([k, v]) => [k, v.label])));

// ------------------------------------------------------------------ board model
export const validSquare = (s) => typeof s === "string" && /^[a-h][1-8]$/.test(s);
export const sqIndex = (s) => { if (!validSquare(s)) throw new RangeError("Invalid chess square"); return (s.charCodeAt(1) - 49) * 8 + s.charCodeAt(0) - 97; };
export const sqName = (i) => FILES[i & 7] + ((i >> 3) + 1);
const fileOf = (i) => i & 7, rankOf = (i) => i >> 3;
const relRank = (c, i) => (c === "w" ? rankOf(i) : 7 - rankOf(i));
const other = (c) => (c === "w" ? "b" : "w");
const byIndex = (a) => [...new Set(a)].sort((x, y) => x - y);
const names = (a) => byIndex(a).map(sqName);

function parse(fen) {
  if (typeof fen !== "string") throw new RangeError("FEN must be text");
  let chess;
  try { chess = new Chess(fen); } catch (e) { throw new RangeError("Invalid FEN: " + e.message); }
  const board = new Array(64).fill(null);
  fen.trim().split(/\s+/)[0].split("/").forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) f += Number(ch);
      else board[(7 - i) * 8 + f++] = { t: ch.toLowerCase(), c: ch === ch.toLowerCase() ? "b" : "w" };
    }
  });
  return { board, chess, turn: chess.turn() };
}

const KN = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KG = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]], DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const at = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1);

/** squares attacked (geometrically, occupancy-aware, own-occupied squares included) by the piece on i */
function attackSquares(board, i) {
  const p = board[i], f = fileOf(i), r = rankOf(i), out = [];
  const add = (j) => { if (j >= 0) out.push(j); };
  if (p.t === "p") { const d = p.c === "w" ? 1 : -1; add(at(f - 1, r + d)); add(at(f + 1, r + d)); }
  else if (p.t === "n") for (const [a, b] of KN) add(at(f + a, r + b));
  else if (p.t === "k") for (const [a, b] of KG) add(at(f + a, r + b));
  else {
    const dirs = p.t === "r" ? ORTH : p.t === "b" ? DIAG : [...ORTH, ...DIAG];
    for (const [a, b] of dirs) for (let x = f + a, y = r + b; at(x, y) >= 0; x += a, y += b) { out.push(at(x, y)); if (board[at(x, y)]) break; }
  }
  return out;
}
/** indices of `color` pieces that attack square s on this occupancy (x-rays appear when the board is edited) */
function attackersTo(board, s, color) {
  const f = fileOf(s), r = rankOf(s), out = [];
  const is = (j, ts) => j >= 0 && board[j] && board[j].c === color && ts.includes(board[j].t);
  const pr = color === "w" ? r - 1 : r + 1;
  for (const df of [-1, 1]) if (is(at(f + df, pr), "p")) out.push(at(f + df, pr));
  for (const [a, b] of KN) if (is(at(f + a, r + b), "n")) out.push(at(f + a, r + b));
  for (const [a, b] of KG) if (is(at(f + a, r + b), "k")) out.push(at(f + a, r + b));
  for (const [dirs, ts] of [[ORTH, "rq"], [DIAG, "bq"]]) for (const [a, b] of dirs) {
    for (let x = f + a, y = r + b; at(x, y) >= 0; x += a, y += b) { const j = at(x, y); if (board[j]) { if (is(j, ts)) out.push(j); break; } }
  }
  return out;
}
const lva = (board, list) => list.slice().sort((x, y) => SEE_VALUES[board[x].t] - SEE_VALUES[board[y].t] || x - y)[0];

// ------------------------------------------------------------------ SEE
function seeOn(board, s) {
  const target = board[s];
  if (!target) throw new RangeError("No piece on " + sqName(s));
  if (target.t === "k") throw new RangeError("Static exchange on a king square is undefined");
  const work = board.slice(), seq = [], victims = [SEE_VALUES[target.t]];
  let side = other(target.c);
  const direct = attackersTo(board, s, side).length, defenders = attackersTo(board, s, target.c).length;
  for (;;) {
    const list = attackersTo(work, s, side);
    if (!list.length) break;
    const a = lva(work, list);
    seq.push({ square: sqName(a), piece: work[a].t, color: side });
    victims.push(SEE_VALUES[work[a].t]);
    work[a] = null; side = other(side);
  }
  if (!seq.length) return { gain: null, sequence: seq, attackers: direct, defenders };
  // victims[k] is what capture k takes; fold from the back: V_k = victims[k] - max(0, V_{k+1})
  let v = victims[seq.length - 1];
  for (let k = seq.length - 2; k >= 0; k--) v = victims[k] - Math.max(0, v);
  return { gain: v, sequence: seq, attackers: direct, defenders };
}

export function staticExchange(fen, square) {
  const { board } = parse(fen), s = sqIndex(square), r = seeOn(board, s);
  return { square, target: { piece: board[s].t, color: board[s].c }, gain: r.gain, best: r.gain == null ? null : Math.max(0, r.gain),
    attackers: r.attackers, defenders: r.defenders, sequence: r.sequence,
    label: LEGEND.concepts.see.label, values: SEE_VALUES };
}

// ------------------------------------------------------------------ hanging
function hangingOf(board) {
  const out = [];
  board.forEach((p, i) => {
    if (!p || p.t === "k") return;
    const a = attackersTo(board, i, other(p.c)), d = attackersTo(board, i, p.c);
    if (!a.length) return;
    const reasons = [];
    if (!d.length) reasons.push("undefended");
    if (Math.min(...a.map((j) => TIER_VALUES[board[j].t])) < TIER_VALUES[p.t]) reasons.push("attacked_by_lower");
    if (reasons.length) out.push({ square: sqName(i), piece: p.t, color: p.c, attackers: a.length, defenders: d.length, reasons });
  });
  return out;
}
export function hangingPieces(fen) { return hangingOf(parse(fen).board); }

// ------------------------------------------------------------------ pawn structure
function pawnStructure(board, c) {
  const own = [], enemy = [];
  board.forEach((p, i) => { if (p && p.t === "p") (p.c === c ? own : enemy).push(i); });
  const count = new Map();
  own.forEach((i) => count.set(fileOf(i), (count.get(fileOf(i)) || 0) + 1));
  const res = { isolated: [], doubled: [], passed: [], backward: [], phalanx: [], supported: [], connected: [] }, links = [];
  const dir = c === "w" ? 1 : -1;
  for (const i of own) {
    const f = fileOf(i), rr = relRank(c, i), adj = own.filter((j) => Math.abs(fileOf(j) - f) === 1);
    const isolated = adj.length === 0;
    if (isolated) res.isolated.push(i);
    if (count.get(f) >= 2) res.doubled.push(i);
    if (!enemy.some((e) => Math.abs(fileOf(e) - f) <= 1 && relRank(c, e) > rr)) res.passed.push(i);
    if (!isolated && !adj.some((j) => relRank(c, j) <= rr)) {
      const stop = at(f, rankOf(i) + dir);
      if (stop >= 0 && enemy.some((e) => Math.abs(fileOf(e) - f) === 1 && rankOf(e) === rankOf(stop) + dir)) res.backward.push(i);
    }
    for (const j of adj) {
      if (rankOf(j) === rankOf(i) && fileOf(j) > f) { res.phalanx.push(i, j); links.push({ from: i, to: j, type: "phalanx" }); }
      if (rankOf(j) === rankOf(i) + dir) { res.supported.push(j); links.push({ from: i, to: j, type: "supports" }); } // i attacks j
    }
  }
  res.connected = [...res.phalanx, ...res.supported];
  const fs = [...count.keys()].sort((a, b) => a - b);
  const out = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, names(v)]));
  out.doubledFiles = fs.filter((f) => count.get(f) >= 2).map((f) => FILES[f]);
  out.doubledCount = [...count.values()].reduce((s, n) => s + (n >= 2 ? n - 1 : 0), 0);
  out.islands = fs.filter((f, k) => k === 0 || f !== fs[k - 1] + 1).length;
  out.count = own.length;
  out.links = links.sort((a, b) => a.from - b.from || a.to - b.to || (a.type < b.type ? -1 : 1)).map((l) => ({ from: sqName(l.from), to: sqName(l.to), type: l.type }));
  return out;
}

function outpostsOf(board) {
  const out = [];
  board.forEach((p, i) => {
    if (!p || (p.t !== "n" && p.t !== "b")) return;
    const c = p.c, rr = relRank(c, i), f = fileOf(i), d = c === "w" ? 1 : -1;
    if (rr < 3 || rr > 5) return;
    const supported = [-1, 1].some((df) => { const j = at(f + df, rankOf(i) - d); return j >= 0 && board[j] && board[j].t === "p" && board[j].c === c; });
    if (!supported) return;
    const attackable = board.some((e, j) => e && e.t === "p" && e.c !== c && Math.abs(fileOf(j) - f) === 1 && relRank(c, j) > rr);
    if (!attackable) out.push({ square: sqName(i), piece: p.t, color: c });
  });
  return out;
}

function filesAndRooks(board) {
  const pf = { w: new Set(), b: new Set() };
  board.forEach((p, i) => { if (p && p.t === "p") pf[p.c].add(fileOf(i)); });
  const all = [0, 1, 2, 3, 4, 5, 6, 7], open = all.filter((f) => !pf.w.has(f) && !pf.b.has(f));
  const half = { w: all.filter((f) => !pf.w.has(f) && pf.b.has(f)), b: all.filter((f) => !pf.b.has(f) && pf.w.has(f)) };
  const rooks = [];
  board.forEach((p, i) => {
    if (!p || p.t !== "r") return;
    const f = fileOf(i);
    rooks.push({ square: sqName(i), color: p.c, file: FILES[f], status: open.includes(f) ? "open" : half[p.c].includes(f) ? "half_open" : "closed" });
  });
  return { files: { open: open.map((f) => FILES[f]), halfOpen: { w: half.w.map((f) => FILES[f]), b: half.b.map((f) => FILES[f]) } }, rooks };
}

function kingZone(board, c) {
  const ks = board.findIndex((p) => p && p.t === "k" && p.c === c);
  if (ks < 0) throw new RangeError("Position has no " + c + " king");
  const zone = new Set(attackSquares(board, ks));
  let pairs = 0, weighted = 0, attackers = 0; const hit = new Set();
  board.forEach((p, i) => {
    if (!p || p.c === c || p.t === "k") return;
    const m = attackSquares(board, i).filter((j) => zone.has(j));
    if (m.length) { pairs += m.length; weighted += ZONE_WEIGHTS[p.t] * m.length; attackers++; m.forEach((j) => hit.add(j)); }
  });
  return { king: sqName(ks), zone: names([...zone]), pairs, weighted, attackers, attackedSquares: names([...hit]) };
}

function pseudoMobility(board, c) {
  const out = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, d = c === "w" ? 1 : -1;
  board.forEach((p, i) => {
    if (!p || p.c !== c) return;
    if (p.t === "p") {
      const f = fileOf(i), r = rankOf(i), one = at(f, r + d);
      if (one >= 0 && !board[one]) { out.p++; const two = at(f, r + 2 * d); if (relRank(c, i) === 1 && !board[two]) out.p++; }
      for (const j of attackSquares(board, i)) if (board[j] && board[j].c !== c) out.p++;
    } else out[p.t] += attackSquares(board, i).filter((j) => !board[j] || board[j].c !== c).length;
  });
  return out;
}
function legalMobility(chess, board) {
  const seen = new Set(), counts = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  for (const m of chess.moves({ verbose: true })) {
    const key = m.from + m.to; if (seen.has(key)) continue;
    seen.add(key); counts[board[sqIndex(m.from)].t]++;
  }
  return { side: chess.turn(), counts };
}

function bishopPairOf(board) {
  const seen = { w: new Set(), b: new Set() };
  board.forEach((p, i) => { if (p && p.t === "b") seen[p.c].add((fileOf(i) + rankOf(i)) % 2); });
  return { w: seen.w.size === 2, b: seen.b.size === 2 };
}

/** Full report. concepts keys: hanging, see, pawns{w,b}, outposts, files, rooks, kingZone{w,b}, mobility, bishopPair. */
export function conceptsReport(fen) {
  const { board, chess } = parse(fen);
  const see = [];
  board.forEach((p, i) => { if (p && p.t !== "k") see.push({ square: sqName(i), piece: p.t, color: p.c, gain: seeOn(board, i).gain }); });
  const hanging = hangingOf(board), pawns = { w: pawnStructure(board, "w"), b: pawnStructure(board, "b") };
  const outposts = outpostsOf(board), { files, rooks } = filesAndRooks(board);
  const kz = { w: kingZone(board, "w"), b: kingZone(board, "b") }, bp = bishopPairOf(board);
  const mobility = { pseudo: { w: pseudoMobility(board, "w"), b: pseudoMobility(board, "b") }, legal: legalMobility(chess, board) };
  const concepts = { hanging, see, pawns, outposts, files, rooks, kingZone: kz, mobility, bishopPair: bp };
  const idx = (a) => a.map(sqIndex), both = (k) => names(idx([...pawns.w[k], ...pawns.b[k]]));
  const fileSq = (fl) => names(fl.flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => sqIndex(f + r))));
  const halfAny = FILES.split("").filter((f) => files.halfOpen.w.includes(f) || files.halfOpen.b.includes(f));
  const bishops = [];
  board.forEach((p, i) => { if (p && p.t === "b" && bp[p.c]) bishops.push(i); });
  const squares = {
    hanging: names(idx(hanging.map((h) => h.square))), see: names(idx(see.filter((e) => e.gain != null && e.gain > 0).map((e) => e.square))),
    isolated: both("isolated"), doubled: both("doubled"), passed: both("passed"), backward: both("backward"), connected: both("connected"),
    outpost: names(idx(outposts.map((o) => o.square))), openFiles: fileSq(files.open), halfOpenFiles: fileSq(halfAny),
    rookFile: names(idx(rooks.filter((r) => r.status !== "closed").map((r) => r.square))),
    kingZone: names(idx([...kz.w.attackedSquares, ...kz.b.attackedSquares])), bishopPair: names(bishops),
  };
  return { fen, concepts, squares, legend: LEGEND };
}

// ------------------------------------------------------------------ 3D geometry
const STYLE = Object.freeze({
  hanging: { color: [1, 0.25, 0.2], kind: "ring", radius: 0.45 }, see: { color: [1, 0.72, 0.1], kind: "flag", corner: 0 },
  isolated: { color: [0.8, 0.5, 1], kind: "flag", corner: 1 }, doubled: { color: [1, 0.55, 0.85], kind: "flag", corner: 2 },
  passed: { color: [0.3, 1, 0.5], kind: "ring", radius: 0.36 }, backward: { color: [0.6, 0.4, 0.2], kind: "flag", corner: 3 },
  connected: { color: [0.4, 0.8, 1], kind: "link" }, outpost: { color: [1, 1, 0.3], kind: "ring", radius: 0.45 },
  openFiles: { color: [0.2, 0.9, 0.9], kind: "strip" }, halfOpenFiles: { color: [0.2, 0.5, 0.9], kind: "strip" },
  rookFile: { color: [1, 0.6, 0.2], kind: "ring", radius: 0.40 }, kingZone: { color: [1, 0.3, 0.55], kind: "ring", radius: 0.30 },
  bishopPair: { color: [0.9, 0.9, 0.9], kind: "ring", radius: 0.30 },
});
export const CONCEPT_STYLE = STYLE;
const CORNERS = [[0.36, -0.36], [-0.36, -0.36], [0.36, 0.36], [-0.36, 0.36]];
const RING_N = 16;

const centre = (s, o) => { const i = sqIndex(s); return [o[0] + fileOf(i) - 3.5, o[2] + 3.5 - rankOf(i)]; };
const finite3 = (o) => Array.isArray(o) && o.length === 3 && o.every(Number.isFinite);

/** Marker geometry. `selected`: array of CONCEPT_IDS, or null/undefined for all. Throws on an unknown id or malformed input. */
export function conceptGeometry(report, origin, selected = null) {
  if (!finite3(origin)) throw new RangeError("origin must be three finite numbers");
  if (!report || typeof report !== "object" || !report.squares || !report.concepts) throw new RangeError("Not a conceptsReport");
  const sel = selected == null ? [...CONCEPT_IDS] : selected;
  if (!Array.isArray(sel) || sel.some((id) => !CONCEPT_IDS.includes(id))) throw new RangeError("Unknown concept id in selection");
  const buffers = Object.fromEntries(CONCEPT_IDS.map((id) => [id, { lines: { points: [], index: [] }, faces: { points: [], index: [] } }]));
  const primitives = [];
  const need = (list) => { if (!Array.isArray(list) || !list.every(validSquare)) throw new RangeError("Report has an invalid square list"); return list; };
  const ring = (id, s, i) => {
    const [x, z] = centre(s, origin), y = 0.09 + 0.004 * i, R = STYLE[id].radius, L = buffers[id].lines, b = L.points.length;
    for (let k = 0; k < RING_N; k++) { const a = (2 * Math.PI * k) / RING_N; L.points.push([x + R * Math.cos(a), y, z + R * Math.sin(a)]); }
    for (let k = 0; k <= RING_N; k++) L.index.push(b + (k % RING_N)); L.index.push(-1);
    primitives.push({ concept: id, kind: "ring", square: s, center: [x, y, z], radius: R, color: STYLE[id].color });
  };
  const flag = (id, s) => {
    const [x, z] = centre(s, origin), [cx, cz] = CORNERS[STYLE[id].corner], px = x + cx, pz = z + cz, top = 1.35;
    const L = buffers[id].lines, F = buffers[id].faces, lb = L.points.length, fb = F.points.length;
    const tip = px + (cx > 0 ? -0.3 : 0.3); // pennant points toward the square centre so it never leaves its own square (max |offset| 0.36)
    L.points.push([px, 0.05, pz], [px, top, pz]); L.index.push(lb, lb + 1, -1);
    F.points.push([px, top, pz], [px, top - 0.3, pz], [tip, top - 0.15, pz]); F.index.push(fb, fb + 1, fb + 2, -1);
    primitives.push({ concept: id, kind: "flag", square: s, base: [px, 0.05, pz], top: [px, top, pz], color: STYLE[id].color });
  };
  const strip = (id, file, i) => {
    const f = FILES.indexOf(file); if (f < 0) throw new RangeError("Invalid file in report");
    const x = origin[0] + f - 3.5, y = 0.07 + 0.004 * i, F = buffers[id].faces, b = F.points.length;
    F.points.push([x - 0.46, y, origin[2] - 3.95], [x + 0.46, y, origin[2] - 3.95], [x + 0.46, y, origin[2] + 3.95], [x - 0.46, y, origin[2] + 3.95]);
    F.index.push(b, b + 1, b + 2, b + 3, -1);
    primitives.push({ concept: id, kind: "strip", file, y, zFrom: origin[2] - 3.95, zTo: origin[2] + 3.95, color: STYLE[id].color });
  };
  const link = (id, a, b, type) => {
    const [x1, z1] = centre(a, origin), [x2, z2] = centre(b, origin), y = 0.13, L = buffers[id].lines, n = L.points.length;
    L.points.push([x1, y, z1], [x2, y, z2]); L.index.push(n, n + 1, -1);
    primitives.push({ concept: id, kind: "link", from: a, to: b, type, color: STYLE[id].color });
  };
  CONCEPT_IDS.forEach((id, i) => {
    if (!sel.includes(id)) return;
    const st = STYLE[id];
    if (st.kind === "ring") need(report.squares[id]).forEach((s) => ring(id, s, i));
    else if (st.kind === "flag") need(report.squares[id]).forEach((s) => flag(id, s));
    else if (st.kind === "strip") {
      const files = id === "openFiles" ? report.concepts.files.open : FILES.split("").filter((f) => report.concepts.files.halfOpen.w.includes(f) || report.concepts.files.halfOpen.b.includes(f));
      files.forEach((f) => strip(id, f, i));
    } else if (st.kind === "link") for (const c of ["w", "b"]) for (const l of report.concepts.pawns[c].links) link(id, need([l.from])[0], need([l.to])[0], l.type);
  });
  return { primitives, buffers, selected: sel.slice(), origin: origin.slice() };
}

// ------------------------------------------------------------------ XML
const fmt = (n) => String(Math.round(n * 1e6) / 1e6);
const pts = (a) => a.map((p) => p.map(fmt).join(" ")).join(", ");
const safeId = (s) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new RangeError("Invalid DEF prefix"); return s; };
export const conceptDef = (prefix, id, part = "") => `${safeId(prefix)}_${id}${part ? "_" + part : ""}`;

function checkBuffers(buffers) {
  const okPart = (q) => q && Array.isArray(q.points) && Array.isArray(q.index) && q.points.every((p) => finite3(p)) &&
    q.index.every((i) => i === -1 || (Number.isInteger(i) && i >= 0 && i < q.points.length));
  if (!buffers || typeof buffers !== "object" || !CONCEPT_IDS.every((id) => buffers[id] && okPart(buffers[id].lines) && okPart(buffers[id].faces)))
    throw new RangeError("Malformed concept buffers (need every concept id with finite 3D points and in-range indices)");
}

/** Pre-created concept shapes (all hidden, empty). With opts.buffers (a conceptGeometry().buffers) the shapes are filled and the
 *  selected groups made visible: that variant is the static snapshot used for export/validation. */
export function conceptsXml(origin, { prefix = "cx", buffers = null, selected = null } = {}) {
  if (!finite3(origin)) throw new RangeError("origin must be three finite numbers");
  if (buffers) checkBuffers(buffers);
  if (selected != null && (!Array.isArray(selected) || selected.some((id) => !CONCEPT_IDS.includes(id)))) throw new RangeError("Unknown concept id in selection");
  const shapes = CONCEPT_IDS.map((id) => {
    const col = STYLE[id].color.join(" "), d = (p) => conceptDef(prefix, id, p), b = buffers && buffers[id];
    const lp = b && b.lines.points.length ? pts(b.lines.points) : "0 0 0", li = b && b.lines.index.length ? b.lines.index.join(" ") : "-1";
    const fp = b && b.faces.points.length ? pts(b.faces.points) : "0 0 0", fi = b && b.faces.index.length ? b.faces.index.join(" ") : "-1";
    const vis = buffers && (selected == null || selected.includes(id)) && (b.lines.points.length || b.faces.points.length) ? "true" : "false";
    return `<Group DEF='${d("")}'${vis === "false" ? " visible='false'" : ""}>` +
      `<Shape pointerEvents='false'><Appearance><Material diffuseColor='0 0 0' emissiveColor='${col}'/></Appearance><IndexedLineSet DEF='${d("lines")}' coordIndex='${li}'><Coordinate DEF='${d("lineCoord")}' point='${lp}'/></IndexedLineSet></Shape>` +
      `<Shape pointerEvents='false'><Appearance><Material diffuseColor='0 0 0' emissiveColor='${col}' transparency='0.55'/></Appearance><IndexedFaceSet DEF='${d("faces")}' solid='false' coordIndex='${fi}'><Coordinate DEF='${d("faceCoord")}' point='${fp}'/></IndexedFaceSet></Shape></Group>`;
  }).join("\n");
  return `<X3D profile='Interchange' version='4.0'><head><component name='Rendering' level='3'/><component name='Shape' level='3'/><component name='Grouping' level='2'/></head><Scene><Group DEF='${safeId(prefix)}_root'>\n${shapes}\n</Group></Scene></X3D>`;
}

/** Flat list of SAI assignments realising a conceptGeometry result on the nodes created by conceptsXml(origin,{prefix}). */
export function conceptUpdates(geometry, { prefix = "cx" } = {}) {
  if (!geometry || !geometry.buffers || !Array.isArray(geometry.selected)) throw new RangeError("Not a conceptGeometry result");
  checkBuffers(geometry.buffers);
  const out = [];
  for (const id of CONCEPT_IDS) {
    const b = geometry.buffers[id], on = geometry.selected.includes(id) && (b.lines.points.length > 0 || b.faces.points.length > 0);
    const d = (p) => conceptDef(prefix, id, p);
    out.push({ def: d("lineCoord"), field: "point", value: b.lines.points.length ? b.lines.points : [[0, 0, 0]] },
      { def: d("lines"), field: "coordIndex", value: b.lines.index.length ? b.lines.index : [-1] },
      { def: d("faceCoord"), field: "point", value: b.faces.points.length ? b.faces.points : [[0, 0, 0]] },
      { def: d("faces"), field: "coordIndex", value: b.faces.index.length ? b.faces.index : [-1] },
      { def: d(""), field: "visible", value: on });
  }
  return out;
}
