// JS twins of the Python analysis modules (server/x3dchess_server/analysis), so the browser-only
// transports can emit the same fields. Ported FAITHFULLY, quirks included; tools/parity.mjs checks
// them against the Python outputs on a fixture set (server/tests/parity_fixtures.json).
import { Chess } from "../vendor/chess.js";

const FILES = "abcdefgh";
const PV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
export const sqName = (i) => FILES[i % 8] + (Math.floor(i / 8) + 1);

/** 64-entry array indexed like python-chess squares (a1=0 .. h8=63); entries {type,color} or null. */
export function pieceArray(chess) {
  const a = new Array(64).fill(null);
  chess.board().forEach((row, r) => row.forEach((p, f) => { if (p) a[(7 - r) * 8 + f] = p; }));
  return a;
}
const kingSq = (a, color) => a.findIndex((p) => p && p.type === "k" && p.color === color);
const rnd2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

// ---- phase space (phase_space.py) -------------------------------------------------------------
const CENTER = new Set([27, 28, 35, 36]);                              // d4 e4 d5 e5
const EXT = new Set([18, 19, 20, 21, 26, 29, 34, 37, 42, 43, 44, 45]); // c3..f3, c4 f4, c5 f5, c6..f6

function sideKingSafety(a, color) {
  const ks = kingSq(a, color);
  if (ks < 0) return 0;
  let safety = 5;
  const kr = Math.floor(ks / 8), kf = ks % 8, dir = color === "w" ? 1 : -1, sr = kr + dir;
  if (sr >= 0 && sr < 8) {
    for (const f of [Math.max(0, kf - 1), kf, Math.min(7, kf + 1)]) {
      const p = a[sr * 8 + f];
      safety += p && p.type === "p" && p.color === color ? 0.5 : -0.5;
    }
  }
  a.forEach((p, sq) => {
    if (p && p.color !== color && Math.abs(Math.floor(sq / 8) - kr) + Math.abs((sq % 8) - kf) <= 3) safety -= 0.3;
  });
  return Math.max(-5, Math.min(5, safety));
}

export function phaseSpacePoint(chess) {
  const a = pieceArray(chess);
  let mat = 0;
  a.forEach((p) => { if (p) mat += (p.color === "w" ? 1 : -1) * PV[p.type]; });
  let wc = 0, bc = 0;
  for (let sq = 0; sq < 64; sq++) {
    const w = CENTER.has(sq) ? 3 : EXT.has(sq) ? 2 : 1, name = sqName(sq);
    wc += chess.attackers(name, "w").length * w;
    bc += chess.attackers(name, "b").length * w;
  }
  const space = Math.max(-5, Math.min(5, ((wc - bc) / 200) * 10));
  const king = sideKingSafety(a, "w") - sideKingSafety(a, "b");
  return { material_balance: rnd2(mat), space_control: rnd2(space), king_safety: rnd2(king) };
}

// ---- tactics (tactical_detector.py): forks, pins, skewers, discoveries, overloading, quirks included ----
const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function steps(sq, deltas) {
  const r = Math.floor(sq / 8), f = sq % 8, out = [];
  for (const [df, dr] of deltas) { const nr = r + dr, nf = f + df; if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) out.push(nr * 8 + nf); }
  return out.sort((x, y) => x - y);
}
const motif = (pattern, piece, sq, targets, tPieces, severity, description) => ({
  pattern, piece: NAME[piece.type], piece_color: piece.color === "w" ? "white" : "black", piece_square: sqName(sq),
  target_squares: targets.map(sqName), target_pieces: tPieces.map((p) => NAME[p.type]), severity, description,
});
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function forks(a, turn) {
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = a[sq];
    if (!p || p.color !== turn || (p.type !== "n" && p.type !== "k")) continue;
    const hit = steps(sq, p.type === "n" ? KN : KG).filter((t) => a[t] && a[t].color !== turn && "qrk".includes(a[t].type));
    if (hit.length < 2) continue;
    const tp = hit.map((t) => a[t]);
    const sev = tp.some((x) => x.type === "k") ? "winning" : tp.some((x) => x.type === "q") ? "material" : "positional";
    const names = hit.map((t) => `${NAME[a[t].type]} on ${sqName(t)}`);
    out.push(motif("fork", p, sq, hit, tp, sev, `${cap(NAME[p.type])} fork from ${sqName(sq)} attacks ${names.slice(0, 2).join(", ")}`));
  }
  return out;
}

function pins(a, turn) {
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = a[sq];
    if (!p || p.color === turn) continue;
    const ks = kingSq(a, p.color);
    if (ks < 0) continue;
    const r1 = Math.floor(sq / 8), f1 = sq % 8, r2 = Math.floor(ks / 8), f2 = ks % 8;
    const aligned = r1 === r2 || f1 === f2 || Math.abs(r1 - r2) === Math.abs(f1 - f2);
    if (!aligned || (r1 === r2 && f1 === f2)) continue;
    const dr = Math.sign(r2 - r1), df = Math.sign(f2 - f1);          // quirk kept: steps TOWARD the king, as the original does
    let r = r1, f = f1;
    for (;;) {
      r += dr; f += df;
      if (r < 0 || r > 7 || f < 0 || f > 7) break;
      const cs = r * 8 + f, t = a[cs];
      if (t) {
        if (t.color === turn && "qrb".includes(t.type)) {
          out.push(motif("pin", t, cs, [sq], [p], p.type === "q" ? "winning" : "material", `${cap(NAME[t.type])} pins ${NAME[p.type]} on ${sqName(sq)}`));
        }
        break;
      }
    }
  }
  return out;
}

const DIRS = { r: [[1, 0], [-1, 0], [0, 1], [0, -1]], b: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
DIRS.q = [...DIRS.r, ...DIRS.b];
/** Squares attacked by a slider (blockers included), ascending like python-chess SquareSet. */
function sliderAttacks(a, sq, type) {
  const out = [];
  for (const [df, dr] of DIRS[type]) {
    let r = Math.floor(sq / 8) + dr, f = (sq % 8) + df;
    while (r >= 0 && r < 8 && f >= 0 && f < 8) { out.push(r * 8 + f); if (a[r * 8 + f]) break; r += dr; f += df; }
  }
  return out.sort((x, y) => x - y);
}
const dirOf = (from, to) => {                                   // _get_direction: unit step if aligned
  const dr = Math.floor(to / 8) - Math.floor(from / 8), df = (to % 8) - (from % 8);
  if (dr === 0 && df === 0) return null;
  if (!(dr === 0 || df === 0 || Math.abs(dr) === Math.abs(df))) return null;
  return [Math.sign(dr), Math.sign(df)];
};
const aligned = (x, y) => { const dr = Math.floor(x / 8) - Math.floor(y / 8), df = (x % 8) - (y % 8); return dr === 0 || df === 0 || Math.abs(dr) === Math.abs(df); };
const dist = (x, y) => Math.hypot(Math.floor(y / 8) - Math.floor(x / 8), (y % 8) - (x % 8));
const isBetween = (mid, start, end) => aligned(start, mid) && aligned(mid, end) && Math.abs(dist(start, mid) + dist(mid, end) - dist(start, end)) < 0.01;

function skewers(a, turn) {
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = a[sq];
    if (!p || p.color !== turn || !"qrb".includes(p.type)) continue;
    for (const t of sliderAttacks(a, sq, p.type)) {
      const target = a[t];
      if (!target || target.color === turn || !"kq".includes(target.type)) continue;
      const d = dirOf(sq, t);
      if (!d) continue;
      let r = Math.floor(t / 8), f = t % 8;
      for (;;) {
        r += d[0]; f += d[1];
        if (r < 0 || r > 7 || f < 0 || f > 7) break;
        const cs = r * 8 + f, bp = a[cs];
        if (bp) {
          if (bp.color !== turn && "qrbn".includes(bp.type)) {
            out.push(motif("skewer", p, sq, [t, cs], [target, bp], target.type === "k" ? "winning" : "material",
              `${cap(NAME[p.type])} skewers ${NAME[target.type]} on ${sqName(t)}, exposing ${NAME[bp.type]}`));
          }
          break;
        }
      }
    }
  }
  return out;
}

function discoveries(a, turn) {
  const out = [], ks = kingSq(a, turn === "w" ? "b" : "w");
  if (ks < 0) return out;
  for (let sq = 0; sq < 64; sq++) {
    const p = a[sq];
    if (!p || p.color !== turn) continue;
    for (let o = 0; o < 64; o++) {
      const op = a[o];
      if (!op || op.color !== turn || !"qrb".includes(op.type)) continue;
      if (isBetween(sq, o, ks)) {
        out.push(motif("discovery", p, sq, [ks], [a[ks]], "winning",
          `Discovered attack: moving ${NAME[p.type]} from ${sqName(sq)} reveals ${NAME[op.type]} attack on king`));
      }
    }
  }
  return out;
}

function overloads(a, turn, chess) {
  const out = [], opp = turn === "w" ? "b" : "w";
  for (let sq = 0; sq < 64; sq++) {
    const p = a[sq];
    if (!p || p.color === turn) continue;
    let value = 0, count = 0;
    for (let t = 0; t < 64; t++) {
      const tp = a[t];
      if (!tp || tp.color !== p.color) continue;
      if (chess.attackers(sqName(t), opp).length > 0 && (tp.type === "q" || tp.type === "r")) { value += PV[tp.type]; count++; }
    }
    if (count >= 2 && value >= 6) {
      out.push(motif("overload", p, sq, [], [], "positional", `Overloaded ${NAME[p.type]} at ${sqName(sq)} defending multiple targets`));
    }
  }
  return out;
}

/** Same order as the Python detector: forks, pins, skewers, discoveries, overloading. */
export function detectTactics(chess) {
  const a = pieceArray(chess), turn = chess.turn();
  return [...forks(a, turn), ...pins(a, turn), ...skewers(a, turn), ...discoveries(a, turn), ...overloads(a, turn, chess)];
}

// ---- critical moments (bifurcation_detector.py), incremental form ----------------------------------
const THR = { blunder: 1.0, mistake: 0.5, inaccuracy: 0.2 };
const materialOf = (fen) => { let m = 0; for (const ch of fen.split(" ")[0]) m += PV[ch.toLowerCase()] ?? 0; return m; };

export class BifurcationDetector {
  constructor() { this.evals = []; this.fens = []; }
  /** Same inputs as add_position. Returns the severity the Python get_latest_critical_moment would report for this ply, or null.
   *  Quirk kept: the swing is |eval_after - eval_before|, so a winning move is flagged like a blunder. */
  add(ply, evalPawns, fen) {
    this.evals.push([ply, evalPawns]); this.fens.push(fen);
    const i = this.evals.length - 1;
    if (i < 1) return null;
    const change = Math.abs(this.evals[i][1] - this.evals[i - 1][1]);
    let sev = change >= THR.blunder ? "blunder" : change >= THR.mistake ? "mistake" : change >= THR.inaccuracy ? "inaccuracy" : null;
    if (i >= 2) {
      const m = [materialOf(this.fens[i - 2]), materialOf(this.fens[i - 1]), materialOf(this.fens[i])];
      if (m[0] > 0 && (m[0] - m[2]) / m[0] > 0.15) sev = "phase_transition";   // sorted last among equal move numbers
    }
    return sev;
  }
}

/** Per-game analysis session shared by the browser transports: one call per move, returns the extra event fields. */
export class GameAnalysis {
  constructor() { this.reset(); }
  reset() { this.bif = new BifurcationDetector(); }
  /** @returns {{tactics:object[], critical:string|null, phase:object|null}} phase only every 4th ply (as the server does). */
  onMove(chess, ply, evalCp) {
    const tactics = detectTactics(chess).filter((m) => m.severity === "winning" || m.severity === "material").slice(0, 3);
    const critical = this.bif.add(ply, evalCp / 100, chess.fen());
    const phase = ply % 4 === 0 ? { ...phaseSpacePoint(chess), move_number: ply, fen: chess.fen() } : null;
    return { tactics, critical, phase };
  }
}

/** Net attacker count per square (white minus black), index a1=0..h8=63. Same counting as the phase-space space term. */
export function controlGrid(chess) {
  const g = new Array(64);
  for (let sq = 0; sq < 64; sq++) { const n = sqName(sq); g[sq] = chess.attackers(n, "w").length - chess.attackers(n, "b").length; }
  return g;
}
