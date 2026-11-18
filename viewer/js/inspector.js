// SQUARE INSPECTOR: exact relations for one selected square, keyboard navigation,
// and X3D-ready overlay geometry. Pure logic (no browser, no SAI) except
// applyInspectorGeometry(), which only calls the SAI objects handed to it.
//
// PUBLIC API
//   inspect(fen, square, episode?)      -> inspection (throws RangeError for an off-board square,
//                                          Error for an invalid FEN). See fields below.
//   navigate(square|null, key, event?)  -> { square, handled, changed }  (event: ctrl/meta/alt/composing => not handled)  (ArrowUp/Down/Left/Right, WASD, Escape)
//   makeInspectorState(gen?)            -> { gen, fen, square, revision }
//   selectSquare(state, fen, square)    -> episode {gen, fen, square, revision}  (bumps revision)
//   clearSelection(state), newGeneration(state, gen)
//   inspectionStaleReason(state, ins)   -> null | string ;  acceptInspection(state, ins) -> boolean
//   inspectorGeometry(inspection|null, origin) -> { halo, dest, rays, pin, counts }  (point lists)
//   inspectorXml(origin, {def, geometry}) -> full X3D 4.0 Interchange document, pre-created shapes
//   inspectorNodeNames(def), applyInspectorGeometry(scene, geometry, X3D, def)
//   LEGEND, COLORS                      -> honest labels / colour meaning
//
// inspection = { schema, episode, fen, turn, square, piece|null,
//   position   { inCheck, checkers[], doubleCheck },
//   attackedBy { w:[A], b:[A] }            GEOMETRIC attackers per colour (chess.js attackers(), the
//                                          same relation controlGrid() in analysis.js counts)
//   A          { square,type,color, pinned, pin|null, attackLegalToPlay: true|false|null, legalBasis }
//   enemyAttackers[], defenders[]          (null for an empty square) subsets of attackedBy
//   control    { white, black, balance }   attack-COUNT balance == controlGrid()[sq]; not mobility
//   legal      { sideToMove, moves[], destinations[], note }   LEGAL moves from chess.js verbose moves
//   pin        { pinned, pinner, king, rayFromKing[], lineSquares[] } | { pinned:false }
//   pinning    [{ pinned, king, rayFromKing[] }]  absolute pins this piece creates
//   xray       [{ direction, members[], beyond|null }]  geometric line through own sliders
//   kingSafety { relativeTo, attackedByEnemy, enemyAttackers[] }  geometric, occupant left in place }
//
// Geometric attack and legal move are kept apart on purpose: attackedBy never filters by legality
// (a pinned knight still attacks); attackLegalToPlay says whether from->square would be a legal move
// (exact for the side to move; for the other colour it means "if that colour were to move", with the
// en passant right dropped). It is null when there is no move to ask about: the target holds the enemy king (a check, not a move),
// an own piece (a defender), or is an empty square that a pawn only controls diagonally (no en passant target).
//
// INTEGRATION (lead adds; nothing here edits shared files)
//   import * as insp from "./inspector.js"  (inspector.js imports only chess.js and analysis.js; it does
//   not import board.js, so there is no import cycle).
//   board.js, per Board instance:
//     this.insp = insp.makeInspectorState(); this.inspNodes = null; this.inspPromise = null;
//     async ensureInspector(){ if(!this.inspPromise) this.inspPromise = this.ctx.browser
//         .createX3DFromString(insp.inspectorXml(this.origin,{def:"insp"+this.index})).then(s=>{
//           this.ctx.world.addRootNode ... (same attach path as the heat overlay); this.inspScene=s; }); await it }
//     async inspect(square, fen){                       // fen = this.chess.fen() of the displayed position
//         const ep = insp.selectSquare(this.insp, fen, square);   // bumps revision BEFORE any await
//         await this.ensureInspector();
//         const ins = insp.inspect(fen, square, ep);
//         if(!insp.acceptInspection(this.insp, ins)) return null;  // a newer click/move/reset won
//         insp.applyInspectorGeometry(this.inspScene, insp.inspectorGeometry(ins,this.origin), X3D, "insp"+this.index);
//         return ins; }                                  // panel shows ins + insp.LEGEND text
//     clear(): insp.clearSelection(this.insp); apply insp.inspectorGeometry(null, origin).
//     reset / new snapshot generation: insp.newGeneration(this.insp, ev.generation); apply the empty
//     geometry. Every accepted move/snapshot ALSO changes fen, so call clear() (or re-select) there: an
//     in-flight inspection of the old fen is then rejected by acceptInspection.
//   Pointer: board TouchSensor hit -> board.inspect(square). Effect shapes are pointerEvents='false'.
//   Keys (main.js keydown, only when the canvas/panel has focus and not typing in an input):
//     const r = insp.navigate(board.insp.square, e.key, e); if(r.handled){ e.preventDefault();
//        r.square ? board.inspect(r.square, board.chess.fen()) : board.clear(); }
//   Layout: white at the bottom, rank 1 on +Z, same as board.js sqPos().
//   Panel: render ins.attackedBy / ins.legal with the LEGEND strings, never as a single "threat" number.
import { Chess } from "../vendor/chess.js";
import { absolutePins, pieceArray, sqName } from "./analysis.js";

const FILES = "abcdefgh";
export const validSquare = (sq) => typeof sq === "string" && /^[a-h][1-8]$/.test(sq);
const assertSquare = (sq) => { if (!validSquare(sq)) throw new RangeError("Invalid chess square"); };
const sqIndex = (sq) => FILES.indexOf(sq[0]) + 8 * (Number(sq[1]) - 1);
const fileOf = (i) => i % 8, rankOf = (i) => Math.floor(i / 8);
const other = (c) => (c === "w" ? "b" : "w");

export const LEGEND = Object.freeze({
  geometricAttack: "Geometric attack: the piece would capture on this square if it were empty of own pieces and the move were legal; pins and checks are ignored (chess.js attackers()).",
  legalMove: "Legal move: a move chess.js accepts for the side to move, including pins, checks, castling and en passant.",
  attackLegalToPlay: "attackLegalToPlay: whether that attacker's move to this square is legal. Exact for the side to move; for the other colour it means 'if that colour were to move' (en passant right dropped). null when no move exists to ask about: the target holds the enemy king (a check), holds an own piece (defender), or is an empty square a pawn only controls diagonally.",
  defenders: "Defenders: own pieces that geometrically attack this occupied square; a pinned defender still counts here but may not be able to recapture.",
  control: "Attack-count balance (white attackers minus black attackers, as controlGrid). It is not legal mobility and not a safety verdict.",
  pin: "Absolute pin: the piece is on a line between its own king and an enemy slider that moves along that line. It restricts legal moves; it does not remove attacks.",
  xray: "X-ray/battery: a geometric line through own sliders that move along it. It is not a legal capture sequence and ignores exchange value.",
  kingSafety: "Enemy-attacked (geometric): the occupant is left in place, so a king stepping along a slider's line is judged by the legal-move list, not by this flag.",
  destinations: "Destination markers show legal moves of the selected piece for the side to move only.",
  rays: "Rays join each geometric attacker (red = enemy, teal = defender, violet = x-ray); a dimmed ray means that attacker's move would be illegal.",
  pinRay: "Amber low ray with tick marks: absolute-pin line from the king (pinned piece); orange: lines this piece pins.",
});

export const COLORS = Object.freeze({
  halo: [1, 0.95, 0.4], quiet: [0.2, 0.95, 0.5], capture: [1, 0.35, 0.3], enPassant: [1, 0.4, 0.9],
  castle: [0.3, 0.85, 1], promotion: [1, 0.8, 0.15],
  attacker: [1, 0.3, 0.25], attackerDim: [0.45, 0.2, 0.2], defender: [0.2, 0.85, 0.8], defenderDim: [0.12, 0.35, 0.35],
  controlW: [0.95, 0.95, 1], controlB: [0.75, 0.5, 1], xray: [0.7, 0.45, 1],
  pinned: [1, 0.72, 0.1], pinning: [1, 0.5, 0.15],
});

// ---- keyboard navigation -------------------------------------------------------------------
export const NAV_START = "e4";
const KEYS = { ArrowUp: [0, 1], w: [0, 1], ArrowDown: [0, -1], s: [0, -1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
/** White at the bottom: Up/W = toward rank 8, Right/D = toward the h-file. Clamped, never wraps. */
export function navigate(square, key, mods = null) {
  if (square !== null) assertSquare(square);
  // browser/OS shortcuts (Ctrl+S, Ctrl+W, Cmd+D, Alt+Left ...) are never ours: pass the event as `mods`
  if (mods && (mods.ctrlKey || mods.metaKey || mods.altKey || mods.isComposing)) return { square, handled: false, changed: false };
  if (key === "Escape") return { square: null, handled: true, changed: square !== null };
  const k = typeof key === "string" && key.length === 1 ? key.toLowerCase() : key;
  const d = Object.prototype.hasOwnProperty.call(KEYS, k) ? KEYS[k] : null;
  if (!d) return { square, handled: false, changed: false };
  if (square === null) return { square: NAV_START, handled: true, changed: true };
  const f = Math.max(0, Math.min(7, FILES.indexOf(square[0]) + d[0])), r = Math.max(0, Math.min(7, Number(square[1]) - 1 + d[1]));
  const next = FILES[f] + (r + 1);
  return { square: next, handled: true, changed: next !== square };
}

// ---- episode identity ------------------------------------------------------------------------
export const makeInspectorState = (gen = 0) => ({ gen, fen: null, square: null, revision: 0 });
export function selectSquare(state, fen, square) {
  assertSquare(square);
  if (typeof fen !== "string") throw new TypeError("FEN must be text");
  state.revision++; state.fen = fen; state.square = square;
  return { gen: state.gen, fen, square, revision: state.revision };
}
export function clearSelection(state) { state.revision++; state.fen = null; state.square = null; }
export function newGeneration(state, gen) {
  if (!Number.isInteger(gen) || gen < state.gen) throw new RangeError("Generations must not go backwards");
  state.gen = gen; state.revision++; state.fen = null; state.square = null;
}
export function inspectionStaleReason(state, ins) {
  const e = ins && ins.episode;
  if (!e || typeof e !== "object") return "no episode identity";
  if (e.gen !== state.gen) return "generation changed";
  if (e.revision !== state.revision) return "newer selection or clear";
  if (e.square !== state.square || state.square === null) return "square changed";
  if (e.fen !== state.fen) return "position changed";
  return null;
}
export const acceptInspection = (state, ins) => inspectionStaleReason(state, ins) === null;

// ---- exact relations -----------------------------------------------------------------------
const ALL = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SLIDE = { r: ALL.slice(0, 4), b: ALL.slice(4), q: ALL };
const slidesAlong = (type, d) => type === "q" || (type === "r" && (d[0] === 0 || d[1] === 0)) || (type === "b" && d[0] !== 0 && d[1] !== 0);
const desc = (a, i) => (a[i] ? { square: sqName(i), type: a[i].type, color: a[i].color } : null);
const sign = Math.sign;

function rayFromKing(king, far) {
  const df = sign(fileOf(far) - fileOf(king)), dr = sign(rankOf(far) - rankOf(king)), out = [];
  for (let f = fileOf(king) + df, r = rankOf(king) + dr; ; f += df, r += dr) {
    out.push(sqName(r * 8 + f));
    if (r * 8 + f === far) return out;
  }
}

function moveRecord(m) {
  const flags = m.flags;
  return {
    from: m.from, to: m.to, san: m.san, uci: m.from + m.to + (m.promotion || ""), flags,
    capture: flags.includes("c") || flags.includes("e"), captured: m.captured || null,
    promotion: m.promotion || null, enPassant: flags.includes("e"),
    epCapturedSquare: flags.includes("e") ? m.to[0] + m.from[1] : null,
    castle: flags.includes("k") ? "k" : flags.includes("q") ? "q" : null,
    givesCheck: /[+#]$/.test(m.san),
  };
}

function groupDestinations(moves) {
  const by = new Map();
  for (const m of moves) {
    let d = by.get(m.to);
    if (!d) by.set(m.to, d = { to: m.to, capture: false, enPassant: false, castle: null, promotions: [], moves: 0 });
    d.capture ||= m.capture; d.enPassant ||= m.enPassant; d.castle ||= m.castle; d.moves++;
    if (m.promotion) d.promotions.push(m.promotion);
  }
  for (const d of by.values()) d.promotions.sort();
  return [...by.values()].sort((a, b) => (a.to < b.to ? -1 : 1));
}

/** Exact relations for `square` in `fen`. `episode` = {gen, revision} from selectSquare() (optional). */
export function inspect(fen, square, episode = null) {
  assertSquare(square);
  const chess = new Chess(fen); // throws on an invalid FEN
  const epField = String(fen).trim().split(/\s+/)[3] || "-"; // raw en passant target of the displayed position
  const norm = chess.fen(), turn = chess.turn(), arr = pieceArray(chess), idx = sqIndex(square);
  const piece = desc(arr, idx), pins = absolutePins(chess);
  let flipped; // lazily built position with the other colour to move
  const flip = () => {
    if (flipped === undefined) {
      const p = norm.split(" "); p[1] = other(turn); p[3] = "-";
      try { flipped = new Chess(p.join(" ")); } catch (_) { flipped = null; }
    }
    return flipped;
  };
  const pinOf = (sq) => {
    const rec = pins.find((p) => p.pinned === sq);
    if (!rec) return null;
    const ray = rayFromKing(sqIndex(rec.king), sqIndex(rec.attacker));
    return { pinner: rec.attacker, king: rec.king, rayFromKing: ray, lineSquares: ray.filter((s) => s !== sq) };
  };
  const attackerEntry = (from, color) => {
    const i = sqIndex(from), p = arr[i], pin = pinOf(from);
    let legal = null, basis = color === turn ? "side-to-move" : "turn-flipped";
    if (piece && piece.type === "k" && piece.color !== color) basis = "king-capture-is-check-not-a-move";
    else if (piece && piece.color === color) basis = "own-piece-on-target"; // a defender: a move onto an own piece never exists
    else if (!piece && p.type === "p" && sqIndex(from) % 8 !== idx % 8 && !(color === turn && epField === square)) {
      basis = "pawn-capture-needs-a-target"; // diagonal control of an empty square is not a move (no en passant target here)
    } else {
      const c = color === turn ? chess : flip();
      if (c) legal = c.moves({ square: from, verbose: true }).some((m) => m.to === square);
      else basis = "unavailable";
    }
    return { square: from, type: p.type, color, geometricAttack: true, pinned: !!pin, pin, attackLegalToPlay: legal, legalBasis: basis };
  };
  const attackedBy = { w: chess.attackers(square, "w").sort().map((s) => attackerEntry(s, "w")),
                       b: chess.attackers(square, "b").sort().map((s) => attackerEntry(s, "b")) };

  const kingIdx = arr.findIndex((p) => p && p.type === "k" && p.color === turn);
  const checkers = kingIdx < 0 ? [] : chess.attackers(sqName(kingIdx), other(turn)).sort();

  const verbose = piece && piece.color === turn ? chess.moves({ square, verbose: true }).map(moveRecord) : [];
  const legal = { sideToMove: !!piece && piece.color === turn, moves: verbose, destinations: groupDestinations(verbose),
    note: !piece ? "Empty square: no piece to move." : piece.color === turn ? "Legal moves of the side to move (chess.js)." : "Not this colour's turn: no legal moves are listed." };

  const pinning = piece ? pins.filter((p) => p.attacker === square).map((p) => ({ pinned: p.pinned, king: p.king, rayFromKing: rayFromKing(sqIndex(p.king), idx) })) : [];

  const xray = [];
  if (piece && SLIDE[piece.type]) {
    for (const d of SLIDE[piece.type]) {
      const members = []; let beyond = null;
      for (let f = fileOf(idx) + d[0], r = rankOf(idx) + d[1]; f >= 0 && f < 8 && r >= 0 && r < 8; f += d[0], r += d[1]) {
        const i = r * 8 + f, p = arr[i];
        if (!p) continue;
        if (p.color === piece.color && slidesAlong(p.type, d)) { members.push(sqName(i)); continue; }
        beyond = desc(arr, i); break;
      }
      if (members.length) xray.push({ direction: d.slice(), members, beyond });
    }
  }

  const relativeTo = piece ? piece.color : turn, enemyList = attackedBy[other(relativeTo)];
  const w = attackedBy.w.length, b = attackedBy.b.length;
  const pin = pinOf(square);
  return {
    schema: "x3dchess.inspection/1",
    episode: { gen: episode?.gen ?? 0, fen, square, revision: episode?.revision ?? 0 },
    fen: norm, turn, square, piece,
    position: { inCheck: chess.isCheck(), checkers, doubleCheck: checkers.length > 1 },
    attackedBy,
    enemyAttackers: piece ? attackedBy[other(piece.color)] : null,
    defenders: piece ? attackedBy[piece.color] : null,
    control: { white: w, black: b, balance: w - b, label: LEGEND.control },
    legal,
    pin: pin ? { pinned: true, ...pin } : { pinned: false },
    pinning, xray,
    kingSafety: { relativeTo, attackedByEnemy: enemyList.length > 0, enemyAttackers: enemyList.map((a) => a.square), label: LEGEND.kingSafety },
    legend: LEGEND,
  };
}

// ---- 3D geometry ---------------------------------------------------------------------------
const Y_DEST = 0.105, Y_HALO = 0.115, Y_PIN = 0.16, Y_RAY = 1.2;
const MAX_DEST = 64, MAX_RAYS = 40;
function center(sq, o, y) {
  assertSquare(sq);
  if (!Array.isArray(o) || o.length !== 3 || o.some((v) => !Number.isFinite(v))) throw new TypeError("origin must be three finite numbers");
  return [o[0] + FILES.indexOf(sq[0]) - 3.5, y, o[2] + 3.5 - (Number(sq[1]) - 1)];
}
const corners = (cx, cz, r, y, diamond) => diamond
  ? [[cx, y, cz - r], [cx + r, y, cz], [cx, y, cz + r], [cx - r, y, cz]]
  : [[cx - r, y, cz - r], [cx + r, y, cz - r], [cx + r, y, cz + r], [cx - r, y, cz + r]];
class Soup {
  constructor() { this.point = []; this.coordIndex = []; this.color = []; }
  face(pts, c) { const i = this.point.length; this.point.push(...pts); this.coordIndex.push(...pts.map((_, k) => i + k), -1); this.color.push(c.slice()); }
  line(pts, c) { const i = this.point.length; this.point.push(...pts); this.coordIndex.push(...pts.map((_, k) => i + k), -1); this.color.push(c.slice()); }
  ring(cx, cz, ro, ri, y, diamond, c) {
    const o = corners(cx, cz, ro, y, diamond), n = corners(cx, cz, ri, y, diamond);
    for (let k = 0; k < 4; k++) this.face([o[k], o[(k + 1) % 4], n[(k + 1) % 4], n[k]], c);
  }
  out() { return { point: this.point, coordIndex: this.coordIndex, color: this.color }; }
}
const arrow = (s, a, b, c) => { // shaft a->b plus two barbs, as three polylines in one colour
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len, bl = 0.22, bw = 0.1;
  s.line([a, b], c);
  s.line([b, [b[0] - ux * bl - uz * bw, b[1], b[2] - uz * bl + ux * bw]], c);
  s.line([b, [b[0] - ux * bl + uz * bw, b[1], b[2] - uz * bl - ux * bw]], c);
};

/** X3D-ready point lists (origin = board origin, same convention as sqPos). null inspection -> empty sets. */
export function inspectorGeometry(ins, origin) {
  const halo = new Soup(), dest = new Soup(), rays = new Soup(), pin = new Soup();
  let truncated = false;
  if (ins) {
    const sq = ins.square, [hx, , hz] = center(sq, origin, Y_HALO);
    halo.ring(hx, hz, 0.5, 0.43, Y_HALO, false, COLORS.halo);
    for (const d of ins.legal.destinations.slice(0, MAX_DEST)) {
      const [x, , z] = center(d.to, origin, Y_DEST);
      const c = d.castle ? COLORS.castle : d.enPassant ? COLORS.enPassant : d.promotions.length ? COLORS.promotion : d.capture ? COLORS.capture : COLORS.quiet;
      if (d.capture) dest.ring(x, z, 0.36, 0.22, Y_DEST, true, c); else dest.face(corners(x, z, 0.2, Y_DEST, true), c);
    }
    const to = center(sq, origin, Y_RAY);
    const lists = ins.piece
      ? [["enemy", ins.enemyAttackers, COLORS.attacker, COLORS.attackerDim], ["def", ins.defenders, COLORS.defender, COLORS.defenderDim]]
      : [["w", ins.attackedBy.w, COLORS.controlW, COLORS.attackerDim], ["b", ins.attackedBy.b, COLORS.controlB, COLORS.attackerDim]];
    let n = 0;
    for (const [, list, bright, dim] of lists) for (const a of list) {
      if (n++ >= MAX_RAYS) { truncated = true; break; }
      arrow(rays, center(a.square, origin, Y_RAY), to, a.attackLegalToPlay === false ? dim : bright);
    }
    for (const x of ins.xray) {
      const pts = [to, ...x.members.map((m) => center(m, origin, Y_RAY - 0.15))];
      if (x.beyond) pts.push(center(x.beyond.square, origin, Y_RAY - 0.15));
      rays.line(pts, COLORS.xray);
    }
    const ray = (kingSq, squares, c) => {
      const pts = [kingSq, ...squares].map((s) => center(s, origin, Y_PIN)); pin.line(pts, c);
      for (let k = 1; k < pts.length; k++) { // perpendicular ticks
        const a = pts[k - 1], b = pts[k], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, px = -dz / l * 0.18, pz = dx / l * 0.18;
        pin.line([[b[0] - px, Y_PIN, b[2] - pz], [b[0] + px, Y_PIN, b[2] + pz]], c);
      }
    };
    if (ins.pin.pinned) ray(ins.pin.king, ins.pin.rayFromKing, COLORS.pinned);
    for (const p of ins.pinning) ray(p.king, p.rayFromKing, COLORS.pinning);
  }
  return { halo: halo.out(), dest: dest.out(), rays: rays.out(), pin: pin.out(),
    counts: { destMarkers: dest.color.length, rayLines: rays.color.length, pinLines: pin.color.length }, truncated };
}

// ---- pre-created shapes + SAI update -------------------------------------------------------------
const PARTS = [["halo", "faces"], ["dest", "faces"], ["rays", "lines"], ["pin", "lines"]];
export const inspectorNodeNames = (def = "insp") => Object.fromEntries(PARTS.map(([p]) => [p, { shape: `${def}_${p}`, geometry: `${def}_${p}_g`, coord: `${def}_${p}_c`, color: `${def}_${p}_k` }]));
const v3 = (p) => p.map((x) => +x.toFixed(4)).join(" ");

/** Document with four Shapes (halo, dest, rays, pin), all pointerEvents='false'. With no `geometry` they
 *  hold one placeholder point at `origin` and draw nothing; pass a geometry to inline its data. */
export function inspectorXml(origin, { def = "insp", geometry = null } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(def)) throw new TypeError("def must be an X3D-safe identifier");
  const names = inspectorNodeNames(def), g = geometry || inspectorGeometry(null, origin);
  center("a1", origin, 0);
  const shapes = PARTS.map(([p, kind]) => {
    const s = g[p], n = names[p], empty = !s.point.length;
    const pts = empty ? [origin] : s.point, idx = empty ? [-1] : s.coordIndex, col = empty ? [[0, 0, 0]] : s.color;
    const attrs = `DEF='${n.geometry}' colorPerVertex='false' coordIndex='${idx.join(" ")}'`;
    const body = `<Coordinate DEF='${n.coord}' point='${pts.map(v3).join(", ")}'/><Color DEF='${n.color}' color='${col.map(v3).join(", ")}'/>`;
    return `<Shape DEF='${n.shape}' pointerEvents='false'><Appearance/>` +
      (kind === "faces" ? `<IndexedFaceSet ${attrs} solid='false'>${body}</IndexedFaceSet>` : `<IndexedLineSet ${attrs}>${body}</IndexedLineSet>`) + `</Shape>`;
  });
  return `<X3D profile='Interchange' version='4.0'><head><component name='Rendering' level='3'/><component name='Shape' level='1'/><component name='Grouping' level='1'/></head><Scene><Group DEF='${def}'>${shapes.join("")}</Group></Scene></X3D>`;
}

/** Writes geometry through SAI by assigning the inputOutput fields point / coordIndex / color (the same events as
 *  set_point / set_coordIndex / set_color). Not executed in a browser here: tested against a mock SAI only.
 *  `scene` is the object returned by createX3DFromString; `X3D` is the SAI namespace (X3D.MFVec3f etc.).
 *  Empty parts are reset to the placeholder, so one call fully replaces the previous overlay. */
export function applyInspectorGeometry(scene, geometry, X3D, def = "insp") {
  const names = inspectorNodeNames(def);
  for (const [p] of PARTS) { // coordIndex is cleared first so no frame sees indices beyond the new point list
    const n = names[p], s = geometry[p], empty = !s.point.length;
    const coord = scene.getNamedNode(n.coord), geo = scene.getNamedNode(n.geometry), col = scene.getNamedNode(n.color);
    const pts = empty ? [[0, 0, 0]] : s.point, idx = empty ? [-1] : s.coordIndex, cols = empty ? [[0, 0, 0]] : s.color;
    geo.coordIndex = new X3D.MFInt32(-1);
    coord.point = new X3D.MFVec3f(...pts.map((q) => new X3D.SFVec3f(...q)));
    col.color = new X3D.MFColor(...cols.map((q) => new X3D.SFColor(...q)));
    geo.coordIndex = new X3D.MFInt32(...idx);
  }
}
