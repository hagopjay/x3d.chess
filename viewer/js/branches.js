// 3D SEARCH OBSERVATORY: verified MultiPV branches drawn as arcs above one board.
//
// LEGEND (also exported): PV branches are SELECTED engine continuations from one search, not an exhaustive
// tree and not a proof that any alternative loses.
//
// PUBLIC API (pure, no browser needed)
//   parseInfoLine(line)               UCI "info ..." -> {depth,seldepth,multipv,kind,cp,mate,bound,nodes,nps,time,pv[]}
//                                     or null. cp/mate are from the SIDE TO MOVE (raw UCI). null if no depth/score.
//   verifyLine(fen, pvUci)            replay each move with chess.js -> {ok,verified,total,reason,moves[],san[],fenAfter}
//                                     ok is true only if EVERY move is legal; verified says how far it got.
//   normalizeResult({fenSearched,lines})
//                                     bind lines (raw strings or parseInfoLine objects) to the searched FEN, convert to
//                                     WHITE-perspective score; keeps evaluation_kind engine_cp | engine_mate | unavailable
//                                     and score_bound exact | lowerbound | upperbound | null distinct.
//   verifyResult(normalized)          attach verification, split into {lines (ok only), rejected[]}.
//   acceptResult(current, result)     {accepted, reason}; drops a result whose fenSearched differs from the current
//                                     board FEN (current = fen string or {fen, revision}; result.revision optional).
//   branchGeometry(fenSearched, verifiedLines, origin, {maxPlies})
//                                     per line: {rank,color,points[[x,y,z]],coordIndex[],squares[],san[],label,labelAnchor}.
//                                     Re-verifies and silently omits any line that is not fully legal.
//   branchesXml(origin, maxLines=5)   pre-created Group of IndexedLineSet slots (pointerEvents='false'); DEFs
//                                     bl_coord_<k>, bl_ils_<k>, bl_mat_<k>, bl_group (k = 0..maxLines-1).
//   branchUpdates(geometry, maxLines) per slot {point[], coordIndex[]}; unused slots are blanked (not stale).
//   applyBranchesToScene(scene, geometry, maxLines, X3Dns)   writes the updates through SAI getNamedNode.
//   formatScore(line), LEGEND, LABELS, RANK_COLORS, MAX_LINES, MAX_PLIES
//
// INTEGRATION (for the lead; nothing here edits shared files)
//   board.js  BoardView: add `this.branchRevision = 0;` and a method
//       async showBranches(result /* from pool.analyze or normalizeResult */) {
//         const rev = ++this.branchRevision, epoch = this.epoch, fen = this.lastFen;   // lastFen = current board FEN
//         const gate = acceptResult({ fen, revision: rev }, { ...result, revision: rev }); // or compare to the live fen only
//         if (!acceptResult(this.lastFen, result).accepted) return false;              // stale FEN: drop
//         const { lines } = verifyResult(result), geom = branchGeometry(result.fenSearched, lines, this.origin);
//         if (!this.branchScene) {                                                     // create once, like graphXml
//           this.branchScene = await this.ctx.browser.createX3DFromString(branchesXml(this.origin));
//           if (!this._current(epoch)) return false;
//           this.ctx.browser.currentScene.addRootNode(this.branchScene.rootNodes[0]);
//         }
//         if (!this._current(epoch) || rev !== this.branchRevision || this.lastFen !== fen) return false;  // revision guard
//         applyBranchesToScene(this.branchScene, geom); this.branchLabels = geom.map((g) => g.label); return true;
//       }
//       clearBranches() { this.branchRevision++; if (this.branchScene) applyBranchesToScene(this.branchScene, []); }
//     Call clearBranches() from reset(), from clearEffects() (new generation / snapshot) and from apply(fen) whenever
//     the placement changes (any move invalidates the searched FEN); add branchScene root to dispose()'s root list.
//   UI: a "Branches" button / key (e.g. B) on the focused board calls
//       const r = await transport.analyze(board.lastFen, { multipv: 3, depth: 12 }); await board.showBranches(r);
//     (WasmTransport.analyze -> WasmEnginePool.analyze). Show board.branchLabels plus LEGEND.pv beside the picture.
//   scene.js: nothing required; the Group is per-board and added as a root node like the graph.
//   Declared component: the fragment uses profile Interchange with explicit Rendering component (level 4).
import { Chess } from "../vendor/chess.js";
import { Chess960 } from "./chess960.js";
// A Shredder-FEN (castling as rook files) can only be a Chess960 position; everything else is plain chess.js.
const openChess = (fen) => (/^\S+ [wb] [A-Ha-h]{1,4} /.test(String(fen)) ? new Chess960(fen) : new Chess(fen));
// Local copies (not imported from board.js) so board.js -> lenses.js -> branches.js has no import cycle.
const FILES = "abcdefgh";
const validSquare = (sq) => typeof sq === "string" && /^[a-h][1-8]$/.test(sq);
const sqPos = (sq, origin) => {
  if (!validSquare(sq)) throw new RangeError("Invalid chess square");
  return [origin[0] + FILES.indexOf(sq[0]) - 3.5, 0.05, origin[2] + 3.5 - (Number(sq[1]) - 1)];
};

export const MAX_LINES = 5, MAX_PLIES = 8, MAX_PV = 128;
export const RANK_COLORS = ["1 0.85 0.2", "0.2 0.9 1", "1 0.35 0.85", "0.45 1 0.4", "1 0.6 0.2"];
const START_Y = 0.2, BASE_H = 0.45, RANK_STEP = 0.3, PLY_STEP = 0.12, ARC = 0.25;
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const INT = /^-?\d+$/;

export const LEGEND = Object.freeze({
  pv: "PV branches are selected engine continuations (principal variations) from one MultiPV search, not an exhaustive move tree and not a proof that any alternative loses. Arc links join successive destination squares, not piece trajectories.",
  verified: "Every drawn move was replayed legally from the searched FEN with chess.js; a line with any illegal move is not drawn.",
  score_cp: "Engine centipawn score of the searched position, White point of view; it depends on depth/time and is not a win probability or material count.",
  score_mate: "Engine-reported forced mate distance (White point of view: positive means White mates); a search result, not an exhaustive proof here.",
  score_bound: "lowerbound/upperbound means the engine only bounded the score at that depth; it is not an exact sample.",
  height: "Arc height encodes line rank and ply index only. It does not encode evaluation.",
  color: "Color encodes rank (line number) only: 1 gold, 2 cyan, 3 magenta, 4 green, 5 orange.",
  fen: "Every result is bound to the FEN that was searched; a result for any other position is dropped.",
  history: "Searches see only the FEN, not game history: repetition and fifty-move draws that depend on history are not modeled.",
});
export const LABELS = Object.freeze({ rank: "line", depth: "d", white_pov: "White POV", exact: "exact", lowerbound: "lower bound", upperbound: "upper bound", unavailable: "no score" });

// ---------- parsing ----------
/** Parse one UCI info line. Scores are raw (side to move). Returns null unless depth and a numeric score exist. */
export function parseInfoLine(line) {
  if (typeof line !== "string") return null;
  const t = line.trim().split(/\s+/);
  if (t[0] !== "info" || t.includes("string")) return null;
  const out = { depth: null, seldepth: null, multipv: 1, kind: null, cp: null, mate: null, bound: "exact", nodes: null, nps: null, time: null, pv: [] };
  const num = (s) => (INT.test(s ?? "") && Number.isSafeInteger(Number(s)) ? Number(s) : undefined);
  for (let i = 1; i < t.length;) {
    const k = t[i];
    if (k === "pv") { out.pv = t.slice(i + 1); break; }
    if (k === "score") {
      const kind = t[i + 1], v = num(t[i + 2]);
      if ((kind !== "cp" && kind !== "mate") || v === undefined) return null;
      out.kind = kind === "cp" ? "engine_cp" : "engine_mate"; out[kind] = v; i += 3;
      // Stockfish prints "score cp N wdl W D L lowerbound": accept wdl and the bound in either order.
      for (;;) {
        if (t[i] === "lowerbound" || t[i] === "upperbound") out.bound = t[i++];
        else if (t[i] === "wdl") i += 4;
        else break;
      }
      continue;
    }
    if (["depth", "seldepth", "multipv", "nodes", "nps", "time"].includes(k)) {
      const v = num(t[i + 1]); if (v === undefined || v < 0) return null;
      out[k] = v; i += 2; continue;
    }
    i++;   // currmove, hashfull, tbhits and unknown tokens are ignored
  }
  if (out.depth === null || out.kind === null || out.multipv < 1) return null;
  return out;
}

// ---------- verification ----------
/** Replay pvUci (array or space separated string) from fen. ok is true only when every move is legal. */
export function verifyLine(fen, pvUci) {
  const fail = (reason, verified = 0, total = 0, moves = [], fenAfter = null) =>
    ({ ok: false, verified, total, reason, moves, san: moves.map((m) => m.san), fenAfter });
  const pv = typeof pvUci === "string" ? pvUci.trim().split(/\s+/).filter(Boolean) : pvUci;
  if (!Array.isArray(pv)) return fail("PV must be an array or a string");
  let chess;
  try { chess = openChess(fen); } catch (e) { return fail("Invalid FEN"); }
  if (pv.length === 0) return fail("Empty PV");
  if (pv.length > MAX_PV) return fail("PV longer than " + MAX_PV + " plies", 0, pv.length);
  const moves = [];
  for (let i = 0; i < pv.length; i++) {
    const u = pv[i];
    if (typeof u !== "string" || !UCI_MOVE.test(u)) return fail(`Ply ${i + 1}: malformed UCI move`, i, pv.length, moves, chess.fen());
    const from = u.slice(0, 2), to = u.slice(2, 4), promotion = u[4];
    let m;
    try { m = chess.move({ from, to, promotion }); } catch (e) { m = null; }
    // chess.js ignores a superfluous promotion letter; the engine contract does not.
    if (!m || (m.promotion || undefined) !== promotion) return fail(`Ply ${i + 1}: illegal move ${u}`, i, pv.length, moves, chess.fen());
    moves.push({ uci: u, san: m.san, from, to, promotion: promotion || null, fenAfter: chess.fen() });
  }
  return { ok: true, verified: pv.length, total: pv.length, reason: null, moves, san: moves.map((m) => m.san), fenAfter: chess.fen() };
}

// ---------- normalization ----------
const flip = (b) => (b === "lowerbound" ? "upperbound" : b === "upperbound" ? "lowerbound" : b);
/** Bind lines to the searched FEN and convert scores to White's point of view.
 * Per multipv rank the deepest line wins (later wins ties). Unscored lines stay 'unavailable' (never 0). */
export function normalizeResult({ fenSearched, lines } = {}) {
  let chess;
  try { chess = openChess(fenSearched); } catch (e) { throw new TypeError("normalizeResult needs a valid searched FEN"); }
  if (!Array.isArray(lines)) throw new TypeError("normalizeResult needs a lines array");
  const stm = chess.turn(), sign = stm === "w" ? 1 : -1, byRank = new Map();
  let dropped = 0;
  for (const raw of lines) {
    const p = typeof raw === "string" ? parseInfoLine(raw) : raw && typeof raw === "object" ? raw : null;
    if (!p || !Number.isInteger(p.multipv ?? 1) || (p.multipv ?? 1) < 1 || !Array.isArray(p.pv ?? [])) { dropped++; continue; }
    const rank = p.multipv ?? 1, depth = Number.isInteger(p.depth) ? p.depth : 0;
    const isMate = p.mate != null && Number.isInteger(p.mate), isCp = !isMate && p.cp != null && Number.isFinite(p.cp);
    const bound = isMate || isCp ? (p.bound === "lowerbound" || p.bound === "upperbound" ? p.bound : "exact") : null;
    const entry = {
      rank, depth, seldepth: p.seldepth ?? null, nodes: p.nodes ?? null, nps: p.nps ?? null, time_ms: p.time ?? null,
      evaluation_kind: isMate ? "engine_mate" : isCp ? "engine_cp" : "unavailable",
      cp: isCp ? sign * p.cp || 0 : null, mate: isMate ? sign * p.mate || 0 : null,
      score_bound: bound && sign < 0 ? flip(bound) : bound, score_pov: "white", eval_fen: chess.fen(), pv: [...(p.pv ?? [])],
    };
    const old = byRank.get(rank);
    if (!old || entry.depth >= old.depth) byRank.set(rank, entry);
  }
  return { fenSearched: chess.fen(), ...(chess.fen960 ? { engineFen: chess.fen960() } : {}), sideToMove: stm, lines: [...byRank.values()].sort((a, b) => a.rank - b.rank), dropped };
}

/** Attach verification to every normalized line; only fully legal lines are returned in `lines`. */
export function verifyResult(result) {
  const lines = [], rejected = [];
  for (const l of result.lines) {
    const v = verifyLine(result.engineFen ?? result.fenSearched, l.pv);
    (v.ok ? lines : rejected).push({ ...l, verification: v });
  }
  return { fenSearched: result.fenSearched, ...(result.engineFen ? { engineFen: result.engineFen } : {}), lines, rejected };
}

/** Drop a result whose searched FEN is not the current board FEN (or whose revision is older). */
export function acceptResult(current, result) {
  const norm = (f) => { try { return new Chess(f).fen(); } catch (e) { return null; } };
  const cur = typeof current === "string" ? { fen: current } : current;
  if (!cur || !result || typeof result.fenSearched !== "string") return { accepted: false, reason: "No searched FEN" };
  const a = norm(cur.fen), b = norm(result.fenSearched);
  if (!a || !b) return { accepted: false, reason: "Invalid FEN" };
  if (a !== b) return { accepted: false, reason: "Stale: result searched another position" };
  if (cur.revision !== undefined && result.revision !== undefined && cur.revision !== result.revision) return { accepted: false, reason: "Stale: superseded revision" };
  return { accepted: true, reason: null };
}

// ---------- labels ----------
/** Honest score text: White point of view, with mate/bound kept distinct. */
export function formatScore(line) {
  if (line.evaluation_kind === "engine_mate") {
    const m = line.mate, who = m > 0 ? "White mates" : m < 0 ? "Black mates" : "mated side to move";
    return `${boundMark(line.score_bound)}mate ${m > 0 ? "+" : ""}${m} (${who})`;
  }
  if (line.evaluation_kind === "engine_cp") return `${boundMark(line.score_bound)}cp ${line.cp > 0 ? "+" : ""}${line.cp}`;
  return LABELS.unavailable;
}
const boundMark = (b) => (b === "lowerbound" ? ">= " : b === "upperbound" ? "<= " : "");

// ---------- 3D ----------
const heightAt = (rank, ply) => BASE_H + RANK_STEP * (rank - 1) + PLY_STEP * ply;
const r3 = (n) => Math.round(n * 1e4) / 1e4;

export function branchGeometry(fenSearched, verifiedLines, origin, { maxPlies = MAX_PLIES } = {}) {
  if (!Array.isArray(origin) || origin.length < 3 || !origin.every(Number.isFinite)) throw new TypeError("origin must be three finite numbers");
  if (!Number.isInteger(maxPlies) || maxPlies < 1 || maxPlies > MAX_PLIES) throw new RangeError("maxPlies must be 1.." + MAX_PLIES);
  const out = [], seenRanks = new Set();
  for (const line of verifiedLines.slice(0, MAX_LINES)) {
    const v = verifyLine(fenSearched, line.pv);                  // never trust the caller's "verified" claim
    if (!v.ok || !Number.isInteger(line.rank) || line.rank < 1 || line.rank > MAX_LINES) continue;
    if (seenRanks.has(line.rank)) continue;                       // one slot per rank: a duplicate would be labelled but never drawn
    seenRanks.add(line.rank);
    const n = Math.min(v.moves.length, maxPlies), first = sqPos(v.moves[0].from, origin);
    const pts = [[first[0], START_Y, first[2]]], squares = [v.moves[0].from];
    let prevH = START_Y;
    for (let i = 0; i < n; i++) {
      // The arc joins consecutive squares of the polyline (previous point -> destination), so the apex sits between
      // squares[i] and squares[i+1]; it must not use this move's own from-square, which the polyline never visits after ply 1.
      const a = sqPos(squares[i], origin), b = sqPos(v.moves[i].to, origin), h = heightAt(line.rank, i + 1);
      pts.push([(a[0] + b[0]) / 2, Math.max(prevH, h) + ARC, (a[2] + b[2]) / 2], [b[0], h, b[2]]);
      squares.push(v.moves[i].to); prevH = h;
    }
    const points = pts.map((p) => p.map(r3)), last = points[points.length - 1];
    out.push({
      rank: line.rank, color: RANK_COLORS[line.rank - 1], points, coordIndex: [...points.map((_, i) => i), -1],
      squares, san: v.san.slice(0, n), plies: n, truncatedForDisplay: v.moves.length > n,
      label: `#${line.rank} ${Number.isInteger(line.depth) ? "d" + line.depth : "d?"} ${formatScore(line)} (${LABELS.white_pov}) ${v.san[0]}`,
      labelAnchor: [last[0], last[1] + 0.3, last[2]],
    });
  }
  return out;
}

/** Pre-created group of line slots. Updates go through branchUpdates/applyBranchesToScene. */
export function branchesXml(origin, maxLines = MAX_LINES) {
  if (!Array.isArray(origin) || origin.length < 3 || !origin.every(Number.isFinite)) throw new TypeError("origin must be three finite numbers");
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > MAX_LINES) throw new RangeError("maxLines must be 1.." + MAX_LINES);
  const slots = Array.from({ length: maxLines }, (_, k) =>
    `<Shape pointerEvents='false'><Appearance><Material DEF='bl_mat_${k}' diffuseColor='0 0 0' emissiveColor='${RANK_COLORS[k]}'/></Appearance>` +
    `<IndexedLineSet DEF='bl_ils_${k}' coordIndex='-1'><Coordinate DEF='bl_coord_${k}' point='${origin[0]} ${origin[1]} ${origin[2]}'/></IndexedLineSet></Shape>`).join("\n");
  return `<X3D profile='Interchange' version='4.0'><head><component name='Rendering' level='4'/><component name='Shape' level='1'/><component name='Grouping' level='1'/></head><Scene><Group DEF='bl_group'>\n${slots}\n</Group></Scene></X3D>`;
}

export function branchUpdates(geometry, maxLines = MAX_LINES) {
  return Array.from({ length: maxLines }, (_, k) => {
    const g = geometry.find((x) => x.rank === k + 1);
    return g ? { point: g.points, coordIndex: g.coordIndex } : { point: [[0, 0, 0]], coordIndex: [-1] };
  });
}

/** Write geometry into a scene made from branchesXml. Empty slots are blanked, so nothing stale remains. */
export function applyBranchesToScene(scene, geometry, maxLines = MAX_LINES, X3Dns = globalThis.X3D) {
  branchUpdates(geometry, maxLines).forEach((u, k) => {
    scene.getNamedNode(`bl_coord_${k}`).point = new X3Dns.MFVec3f(...u.point.map((p) => new X3Dns.SFVec3f(...p)));
    scene.getNamedNode(`bl_ils_${k}`).coordIndex = new X3Dns.MFInt32(...u.coordIndex);
  });
}
export { validSquare };
