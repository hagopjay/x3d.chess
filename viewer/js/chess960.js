// Fischer Random (Chess960) rules on top of the vendored chess.js, which has no 960 castling.
//
// Design: the wrapped chess.js always holds castling "-", so it generates every ordinary move correctly and never
// emits a bogus O-O. Castling is generated here from per-rook-file rights, and performed by moving the two pieces and
// passing the turn with chess.js's own null move (that keeps the move number, half-move clock and history right).
//
//  * fen()      is chess.js-compatible (castling field "-"), so every overlay that does `new Chess(ev.fen)` keeps working.
//  * fen960()   is the full Shredder-FEN (castling as rook file letters) that Stockfish and python-chess need.
//  * UCI uses the Chess960 convention: castling is "king takes own rook" (e.g. b1a1), the same as UCI_Chess960.
//  * moves()    stays chess.js's list WITHOUT castling (analysis probes use it); legalMoves960() is the complete list.
// Independent oracle: tools/chess960-test.mjs replays python-chess (chess960=True) games, castling-biased, and compares
// every legal-move set, FEN and terminal flag.
import { Chess } from "../vendor/chess.js";

export const STANDARD_960_ID = 518;
const FILES = "abcdefgh";
const KNIGHTS = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];

/** Scharnagl numbering (the one python-chess and Wikipedia use): 0..959 -> back-rank piece string, 518 = RNBQKBNR. */
export function scharnaglBackRank(id) {
  if (!Number.isInteger(id) || id < 0 || id > 959) throw new RangeError("Chess960 position id must be an integer 0–959");
  const rank = Array(8).fill(null), free = () => [0, 1, 2, 3, 4, 5, 6, 7].filter((f) => rank[f] === null);
  let n = id;
  rank[1 + 2 * (n % 4)] = "b"; n = Math.floor(n / 4);       // light-squared bishop on b, d, f or h
  rank[2 * (n % 4)] = "b"; n = Math.floor(n / 4);           // dark-squared bishop on a, c, e or g
  rank[free()[n % 6]] = "q"; n = Math.floor(n / 6);
  const [k1, k2] = KNIGHTS[n], spots = free();
  rank[spots[k1]] = "n"; rank[spots[k2]] = "n";
  const rest = free(); rank[rest[0]] = "r"; rank[rest[1]] = "k"; rank[rest[2]] = "r";
  return rank.join("");
}
/** Inverse of scharnaglBackRank for a legal 960 back rank; returns null for anything that is not one of the 960. */
export function scharnaglId(backRank) {
  const target = String(backRank).toLowerCase();
  if (!/^[rnbqk]{8}$/.test(target)) return null;
  for (let id = 0; id < 960; id++) if (scharnaglBackRank(id) === target) return id;
  return null;
}
export function chess960StartFen(id) {
  const rank = scharnaglBackRank(id), rooks = [...rank].flatMap((p, f) => (p === "r" ? [FILES[f]] : []));
  const castle = rooks.map((f) => f.toUpperCase()).reverse().join("") + rooks.map((f) => f).reverse().join("");
  return `${rank}/pppppppp/8/8/8/8/PPPPPPPP/${rank.toUpperCase()} w ${castle} - 0 1`;
}
export function randomChess960Id(rng) { return Math.min(959, Math.floor(rng() * 960)); }

// "KQkq" (X-FEN: outermost rook) or Shredder file letters -> {w:{k,q},b:{k,q}} as file indices; also validates the placement.
function parseRights(placement, castling) {
  const rows = placement.split("/"), rights = { w: { k: null, q: null }, b: { k: null, q: null } };
  if (castling === "-") return rights;
  const expand = (row) => row.replace(/\d/g, (d) => ".".repeat(+d));
  const back = { w: expand(rows[7]), b: expand(rows[0]) };
  for (const ch of castling) {
    const color = ch === ch.toUpperCase() ? "w" : "b", row = back[color], king = row.indexOf(color === "w" ? "K" : "k"), rook = color === "w" ? "R" : "r";
    if (king < 0) throw new Error("Castling rights without a king on its back rank");
    const lower = ch.toLowerCase();
    let file;
    if (lower === "k") { file = -1; for (let f = 7; f > king; f--) if (row[f] === rook) { file = f; break; } }
    else if (lower === "q") { file = -1; for (let f = 0; f < king; f++) if (row[f] === rook) { file = f; break; } }
    else file = FILES.indexOf(lower);
    if (file < 0 || row[file] !== rook || file === king) throw new Error(`Castling right ${ch} names no rook`);
    const side = file > king ? "k" : "q";
    if (rights[color][side] !== null) throw new Error("Two castling rooks on one side");
    rights[color][side] = file;
  }
  return rights;
}

export class Chess960 extends Chess {
  constructor(fen = chess960StartFen(STANDARD_960_ID)) {
    const fields = String(fen).trim().split(/\s+/);
    if (fields.length !== 6) throw new Error("Invalid FEN: expected six fields");
    const rights = parseRights(fields[0], fields[2]);
    super([fields[0], fields[1], "-", fields[3], fields[4], fields[5]].join(" "));
    this._startFen960 = null; this._rights = rights; this._rightStack = []; this._castleStack = [];
    this._startFen960 = this.fen960(); this._keys = [this._key()];
  }
  static fromId(id) { return new Chess960(chess960StartFen(id)); }
  reset() { this.load960(this._startFen960); }
  load960(fen) {
    const fresh = new Chess960(fen);
    super.load(fresh.fen());
    this._rights = fresh._rights; this._rightStack = []; this._castleStack = []; this._startFen960 = fresh._startFen960; this._keys = [this._key()];
  }
  _castlingField() {
    let out = "";
    for (const [color, upper] of [["w", true], ["b", false]]) {
      const files = ["k", "q"].map((s) => this._rights[color][s]).filter((f) => f !== null).sort((a, b) => b - a);
      for (const f of files) out += upper ? FILES[f].toUpperCase() : FILES[f];
    }
    return out || "-";
  }
  /** Shredder-FEN: the position as Stockfish (UCI_Chess960) and python-chess (chess960=True) read it. */
  fen960() { const f = this.fen().split(" "); f[2] = this._castlingField(); return f.join(" "); }
  _key() { return this.fen960().split(" ").slice(0, 4).join(" "); }
  /** How many times the current position (rights included) has occurred in this game. */
  repetitionCount() { const k = this._key(); return this._keys.filter((x) => x === k).length; }
  isThreefoldRepetition() { return this.repetitionCount() >= 3; }
  isStalemate() { return super.isStalemate() && this._castles().length === 0; }   // chess.js alone would call a castle-only position stalemate
  isDraw() { return this.isDrawByFiftyMoves() || this.isStalemate() || this.isInsufficientMaterial() || this.isThreefoldRepetition(); }
  isGameOver() { return this.isCheckmate() || this.isDraw(); }
  rights() { return JSON.parse(JSON.stringify(this._rights)); }

  _castlePlan(color, side) {
    const file = this._rights[color][side];
    if (file === null) return null;
    const rank = color === "w" ? "1" : "8", them = color === "w" ? "b" : "w", kingSq = this._findKing(color);
    if (!kingSq || kingSq[1] !== rank) return null;
    const kf = FILES.indexOf(kingSq[0]), kingTo = side === "k" ? 6 : 2, rookTo = side === "k" ? 5 : 3;
    const rook = this.get(FILES[file] + rank);
    if (!rook || rook.type !== "r" || rook.color !== color) return null;
    const between = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b), out = []; for (let f = lo; f <= hi; f++) out.push(f); return out; };
    for (const f of new Set([...between(kf, kingTo), ...between(file, rookTo)])) {
      if (f === kf || f === file) continue;
      if (this.get(FILES[f] + rank)) return null;
    }
    for (const f of between(kf, kingTo)) if (this.isAttacked(FILES[f] + rank, them)) return null;
    // The final position must be safe too: moving the castling rook can open a line onto the king.
    const scratch = new Chess(this.fen()); scratch.remove(kingSq); scratch.remove(FILES[file] + rank);
    scratch.put({ type: "r", color }, FILES[rookTo] + rank); scratch.put({ type: "k", color }, FILES[kingTo] + rank);
    if (scratch.isAttacked(FILES[kingTo] + rank, them)) return null;
    return { color, side, rank, kingFrom: kingSq, kingTo: FILES[kingTo] + rank, rookFrom: FILES[file] + rank, rookTo: FILES[rookTo] + rank };
  }
  _findKing(color) { for (const row of this.board()) for (const p of row) if (p && p.type === "k" && p.color === color) return p.square; return null; }
  _castles() { const c = this.turn(); return ["k", "q"].map((s) => this._castlePlan(c, s)).filter(Boolean); }

  /** Every legal move as {uci, from, to, san, castle}; castling uses the UCI_Chess960 king-takes-rook encoding. */
  legalMoves960() {
    const moves = super.moves({ verbose: true }).map((m) => ({ uci: m.from + m.to + (m.promotion || ""), from: m.from, to: m.to, san: m.san, castle: null, promotion: m.promotion || null }));
    for (const p of this._castles()) moves.push({ uci: p.kingFrom + p.rookFrom, from: p.kingFrom, to: p.rookFrom, san: p.side === "k" ? "O-O" : "O-O-O", castle: p.side, promotion: null });
    return moves;
  }
  legalUci() { return this.legalMoves960().map((m) => m.uci).sort(); }

  _planFor(arg) {
    const castles = this._castles();
    if (typeof arg === "string") {
      const san = arg.replace(/[+#]+$/, "");
      if (san === "O-O" || san === "0-0") return castles.find((p) => p.side === "k") || null;
      if (san === "O-O-O" || san === "0-0-0") return castles.find((p) => p.side === "q") || null;
      return null;
    }
    if (!arg || !arg.from || !arg.to) return null;
    const own = castles.find((p) => p.kingFrom === arg.from && p.rookFrom === arg.to);        // king takes own rook
    if (own) return own;
    const dist = Math.abs(FILES.indexOf(arg.from[0]) - FILES.indexOf(arg.to[0]));
    return dist >= 2 ? castles.find((p) => p.kingFrom === arg.from && p.kingTo === arg.to) || null : null;   // standard e1g1 style
  }
  move(arg, options) {
    const plan = this._planFor(arg);
    if (plan) return this._castle(plan);
    const before = this.rights(), mover = this.turn(), them = mover === "w" ? "b" : "w";
    const m = super.move(arg, options);
    this._rightStack.push(before); this._castleStack.push(null);
    this._afterMove(m, mover, them);
    this._keys.push(this._key());
    return m;
  }
  _afterMove(m, mover, them) {
    const r = this._rights;
    if (m.piece === "k") r[mover].k = r[mover].q = null;
    const backOf = (color) => (color === "w" ? "1" : "8");
    for (const side of ["k", "q"]) {
      if (r[mover][side] !== null && m.piece === "r" && m.from === FILES[r[mover][side]] + backOf(mover)) r[mover][side] = null;
      if (r[them][side] !== null && m.to === FILES[r[them][side]] + backOf(them)) r[them][side] = null;
    }
  }
  _castle(p) {
    const before = this.rights(), beforeFen = this.fen();
    this.remove(p.kingFrom); this.remove(p.rookFrom);
    this.put({ type: "r", color: p.color }, p.rookTo); this.put({ type: "k", color: p.color }, p.kingTo);
    super.move(null);
    this._rightStack.push(before); this._castleStack.push(p);
    this._rights[p.color].k = this._rights[p.color].q = null;
    this._keys.push(this._key());
    const san = (p.side === "k" ? "O-O" : "O-O-O") + (this.isCheckmate() ? "#" : this.isCheck() ? "+" : "");
    return { color: p.color, piece: "k", from: p.kingFrom, to: p.kingTo, san, lan: san, flags: p.side, before: beforeFen, after: this.fen(), castle: p.side,
      uci: p.kingFrom + p.rookFrom, displayUci: p.kingFrom + p.kingTo, isKingsideCastle: () => p.side === "k", isQueensideCastle: () => p.side === "q" };
  }
  undo() {
    if (!this._rightStack.length) return null;
    const castle = this._castleStack.pop(), rights = this._rightStack.pop();
    this._keys.pop();
    const out = super.undo();
    if (castle) {                       // the null move is undone; put the king and rook back where they started
      this.remove(castle.kingTo); this.remove(castle.rookTo);
      this.put({ type: "r", color: castle.color }, castle.rookFrom); this.put({ type: "k", color: castle.color }, castle.kingFrom);
    }
    this._rights = rights;
    return out;
  }
}
