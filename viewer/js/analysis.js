// JS counterparts of the corrected Python analysis. Known-answer controls test
// chess meaning; tools/parity.mjs separately checks cross-language agreement.
import { Chess } from "../vendor/chess.js";

const FILES = "abcdefgh";
const PV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
export const sqName = (i) => FILES[i % 8] + (Math.floor(i / 8) + 1);

/** 64-entry array indexed like python-chess squares (a1=0 .. h8=63); entries {type,color} or null. */
export function pieceArray(chess) {
  const a = new Array(64).fill(null);
  chess.board().forEach((row, r) =>
    row.forEach((p, f) => {
      if (p) a[(7 - r) * 8 + f] = p;
    }),
  );
  return a;
}
const kingSq = (a, color) =>
  a.findIndex((p) => p && p.type === "k" && p.color === color);
const rnd2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

// ---- phase space (phase_space.py) -------------------------------------------------------------
const CENTER = new Set([27, 28, 35, 36]); // d4 e4 d5 e5
const EXT = new Set([18, 19, 20, 21, 26, 29, 34, 37, 42, 43, 44, 45]); // c3..f3, c4 f4, c5 f5, c6..f6

function sideKingSafety(a, color) {
  const ks = kingSq(a, color);
  if (ks < 0) return 0;
  let safety = 5;
  const kr = Math.floor(ks / 8),
    kf = ks % 8,
    dir = color === "w" ? 1 : -1,
    sr = kr + dir;
  if (sr >= 0 && sr < 8) {
    for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
      const p = a[sr * 8 + f];
      safety += p && p.type === "p" && p.color === color ? 0.5 : -0.5;
    }
  }
  a.forEach((p, sq) => {
    if (
      p &&
      p.color !== color &&
      Math.abs(Math.floor(sq / 8) - kr) + Math.abs((sq % 8) - kf) <= 3
    )
      safety -= 0.3;
  });
  return Math.max(-5, Math.min(5, safety));
}

export function phaseSpacePoint(chess) {
  const a = pieceArray(chess);
  let mat = 0;
  a.forEach((p) => {
    if (p) mat += (p.color === "w" ? 1 : -1) * PV[p.type];
  });
  let wc = 0,
    bc = 0;
  for (let sq = 0; sq < 64; sq++) {
    const w = CENTER.has(sq) ? 3 : EXT.has(sq) ? 2 : 1,
      name = sqName(sq);
    wc += chess.attackers(name, "w").length * w;
    bc += chess.attackers(name, "b").length * w;
  }
  const space = Math.max(-5, Math.min(5, ((wc - bc) / 200) * 10));
  const king = sideKingSafety(a, "w") - sideKingSafety(a, "b");
  return {
    material_balance: rnd2(mat),
    space_control: rnd2(space),
    king_safety: rnd2(king),
  };
}

// ---- conservative tactical geometry ---------------------------------------------------------
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const SD = { r: DIRS.slice(0, 4), b: DIRS.slice(4), q: DIRS };
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const KN = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];
function ray(square, [df, dr]) {
  const out = [];
  let f = (square % 8) + df,
    r = Math.floor(square / 8) + dr;
  while (f >= 0 && f < 8 && r >= 0 && r < 8) {
    out.push(r * 8 + f);
    f += df;
    r += dr;
  }
  return out;
}
function steps(square, deltas) {
  const f = square % 8,
    r = Math.floor(square / 8);
  return deltas
    .map(([df, dr]) => [f + df, r + dr])
    .filter(([x, y]) => x >= 0 && x < 8 && y >= 0 && y < 8)
    .map(([x, y]) => y * 8 + x)
    .sort((x, y) => x - y);
}
function attacks(a, square, p) {
  if (p.type === "n") return steps(square, KN);
  if (p.type === "k") return steps(square, DIRS);
  if (p.type === "p")
    return steps(square, [
      [1, p.color === "w" ? 1 : -1],
      [-1, p.color === "w" ? 1 : -1],
    ]);
  const out = [];
  for (const d of SD[p.type] || []) {
    for (const t of ray(square, d)) {
      out.push(t);
      if (a[t]) break;
    }
  }
  return out.sort((x, y) => x - y);
}
const tupleSort = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
function pinsFrom(a) {
  const out = [];
  for (let king = 0; king < 64; king++) {
    const royal = a[king];
    if (!royal || royal.type !== "k") continue;
    for (const d of DIRS) {
      let blocked = null;
      for (const sq of ray(king, d)) {
        const p = a[sq];
        if (!p) continue;
        if (blocked === null) {
          if (p.color !== royal.color) break;
          blocked = sq;
        } else {
          if (
            p.color !== royal.color &&
            (SD[p.type] || []).some((x) => x[0] === d[0] && x[1] === d[1])
          )
            out.push([sq, blocked, king]);
          break;
        }
      }
    }
  }
  return out.sort(tupleSort);
}
/** Exact king-ray absolute pins; attacks by a pinned piece still belong in controlGrid. */
export function absolutePins(chess) {
  return pinsFrom(pieceArray(chess)).map(([attacker, pinned, king]) => ({
    attacker: sqName(attacker),
    pinned: sqName(pinned),
    king: sqName(king),
  }));
}
function motif(
  pattern,
  p,
  sq,
  hit,
  targets,
  description,
  status = "geometric_candidate",
  witnessMoves = [],
  revealed = null,
) {
  return {
    pattern,
    piece: NAME[p.type],
    piece_color: p.color === "w" ? "white" : "black",
    piece_square: sqName(sq),
    target_squares: hit.map(sqName),
    target_pieces: targets.map((t) => NAME[t.type]),
    severity: "candidate",
    description,
    status,
    witness_moves: witnessMoves,
    revealed_square: revealed === null ? null : sqName(revealed),
  };
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
function forks(a, pins) {
  const constrained = new Map();
  for (const [attacker, blocked, king] of pins) {
    const df = Math.sign((attacker % 8) - (king % 8)),
      dr = Math.sign(Math.floor(attacker / 8) - Math.floor(king / 8));
    const allowed = [];
    for (const t of ray(king, [df, dr])) {
      allowed.push(t);
      if (t === attacker) break;
    }
    constrained.set(blocked, new Set(allowed));
  }
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = a[sq];
    if (!p || p.type === "k") continue;
    const hit = attacks(a, sq, p).filter(
      (t) =>
        a[t] &&
        a[t].color !== p.color &&
        "qrk".includes(a[t].type) &&
        (!constrained.has(sq) || constrained.get(sq).has(t)),
    );
    if (hit.length < 2) continue;
    const targets = hit.map((t) => a[t]),
      names = hit.map((t) => `${NAME[a[t].type]} on ${sqName(t)}`);
    out.push(
      motif(
        "fork",
        p,
        sq,
        hit,
        targets,
        `${cap(NAME[p.type])} fork geometry from ${sqName(sq)} attacks ${names.slice(0, 2).join(", ")}; no material win is proven`,
      ),
    );
  }
  return out;
}
function pins(a, records) {
  return records.map(([attacker, blocked, king]) => {
    const p = a[attacker],
      target = a[blocked];
    return motif(
      "pin",
      p,
      attacker,
      [blocked, king],
      [target, a[king]],
      `${cap(NAME[p.type])} on ${sqName(attacker)} absolutely pins ${NAME[target.type]} on ${sqName(blocked)} to king on ${sqName(king)}`,
      "absolute_pin",
    );
  });
}
function skewers(a) {
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = a[sq];
    if (!p || !SD[p.type]) continue;
    const pairs = [];
    for (const d of SD[p.type]) {
      const occupied = ray(sq, d).filter((t) => a[t]);
      if (occupied.length < 2) continue;
      const [front, rear] = occupied,
        first = a[front],
        second = a[rear];
      if (
        first.color !== p.color &&
        second.color !== p.color &&
        "kq".includes(first.type) &&
        "qrbn".includes(second.type) &&
        VALUES[second.type] < VALUES[first.type]
      )
        pairs.push([front, rear]);
    }
    for (const [front, rear] of pairs.sort(tupleSort)) {
      out.push(
        motif(
          "skewer",
          p,
          sq,
          [front, rear],
          [a[front], a[rear]],
          `${cap(NAME[p.type])} skewer geometry from ${sqName(sq)} aligns ${NAME[a[front].type]} on ${sqName(front)} with ${NAME[a[rear].type]} on ${sqName(rear)}; replies are not searched`,
        ),
      );
    }
  }
  return out;
}
function discoveries(chess, a) {
  const color = chess.turn(),
    king = kingSq(a, color === "w" ? "b" : "w");
  if (king < 0) return [];
  const candidates = new Map();
  for (let slider = 0; slider < 64; slider++) {
    const p = a[slider];
    if (!p || p.color !== color || !SD[p.type]) continue;
    for (const d of SD[p.type]) {
      const between = [];
      for (const sq of ray(slider, d)) {
        if (sq === king) {
          if (between.length === 1 && a[between[0]].color === color) {
            if (!candidates.has(between[0]))
              candidates.set(between[0], new Set());
            candidates.get(between[0]).add(slider);
          }
          break;
        }
        if (a[sq]) {
          between.push(sq);
          if (between.length > 1) break;
        }
      }
    }
  }
  if (!candidates.size && chess.fen().split(" ")[3] === "-") return [];
  const found = new Map(),
    toIndex = (s) => "abcdefgh".indexOf(s[0]) + 8 * (Number(s[1]) - 1);
  const moves = chess.moves({ verbose: true });
  for (const move of moves) {
    const from = toIndex(move.from),
      sliders = new Set(candidates.get(from) || []);
    if (move.flags.includes("e"))
      for (let s = 0; s < 64; s++)
        if (a[s] && a[s].color === color && SD[a[s].type]) sliders.add(s);
    if (!sliders.size) continue;
    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });
    try {
      const after = pieceArray(chess);
      for (const slider of [...sliders].sort((x, y) => x - y)) {
        if (
          slider === from ||
          attacks(a, slider, a[slider]).includes(king) ||
          !after[slider] ||
          !attacks(after, slider, after[slider]).includes(king)
        )
          continue;
        const key = from + ":" + slider;
        if (!found.has(key)) found.set(key, { from, slider, moves: [] });
        found.get(key).moves.push(move.from + move.to + (move.promotion || ""));
      }
    } finally {
      chess.undo();
    }
  }
  return [...found.values()]
    .sort((x, y) => x.from - y.from || x.slider - y.slider)
    .map(({ from, slider, moves }) => {
      const p = a[from],
        attacker = a[slider];
      return motif(
        "discovery",
        p,
        from,
        [king],
        [a[king]],
        `Legal discovered-check candidate: moving ${NAME[p.type]} from ${sqName(from)} can reveal ${NAME[attacker.type]} on ${sqName(slider)} against king on ${sqName(king)}`,
        "legal_move_witness",
        moves.sort(),
        slider,
      );
    });
}
/** Bounded motif candidates, not an engine search or a claim of a forced win.
 * Static forks/pins/skewers scan both colors. Discoveries require legal moves now.
 * No overloaded-defender label is inferred from defense counts alone. */
export function detectTactics(chess) {
  const a = pieceArray(chess),
    records = pinsFrom(a);
  return [
    ...forks(a, records),
    ...pins(a, records),
    ...skewers(a),
    ...discoveries(chess, a),
  ];
}

// ---- neutral changes between scored positions -----------------------------------------------
const THR = { large_swing: 1, medium_swing: 0.5, small_swing: 0.2 };
const materialOf = (fen) => {
  let m = 0;
  for (const ch of fen.split(" ")[0]) m += PV[ch.toLowerCase()] ?? 0;
  return m;
};
export class BifurcationDetector {
  constructor() {
    this.evals = [];
    this.fens = [];
  }
  add(ply, evalPawns, fen) {
    if (
      !Number.isInteger(ply) ||
      ply < 0 ||
      !Number.isFinite(evalPawns) ||
      typeof fen !== "string"
    )
      throw new Error("Invalid scored-position sample");
    if (this.evals.length && ply <= this.evals.at(-1)[0])
      throw new Error("Scored plies must strictly increase");
    this.evals.push([ply, evalPawns]);
    this.fens.push(fen);
    const i = this.evals.length - 1;
    if (i < 1) return null;
    const change = Math.abs(this.evals[i][1] - this.evals[i - 1][1]);
    let severity =
      change >= THR.large_swing
        ? "large_swing"
        : change >= THR.medium_swing
          ? "medium_swing"
          : change >= THR.small_swing
            ? "small_swing"
            : null;
    if (i >= 2) {
      const m = [
        materialOf(this.fens[i - 2]),
        materialOf(this.fens[i - 1]),
        materialOf(this.fens[i]),
      ];
      if (m[0] > 0 && (m[0] - m[2]) / m[0] > 0.15)
        severity = "material_exchange";
    }
    return severity;
  }
}
/** Position geometry and score history are separate. evalFen/evalPly identify the
 * pre-move source of a UCI score; mate proxies never enter centipawn swings. */
export class GameAnalysis {
  constructor() {
    this.reset();
  }
  reset() {
    this.bif = new BifurcationDetector();
  }
  onMove(chess, ply, evalCp, context = {}) {
    const tactics = detectTactics(chess).slice(0, 3),
      scorePly = context.evalPly ?? ply,
      scoreFen = context.evalFen ?? chess.fen();
    let critical = null;
    if (
      context.mateIn != null ||
      !Number.isFinite(evalCp) ||
      (context.scoreBound != null && context.scoreBound !== "exact")
    )
      this.bif = new BifurcationDetector();
    else critical = this.bif.add(scorePly, evalCp / 100, scoreFen);
    const phase =
      ply % 4 === 0
        ? { ...phaseSpacePoint(chess), move_number: ply, fen: chess.fen() }
        : null;
    return {
      tactics,
      critical,
      critical_for_ply: critical ? scorePly : null,
      phase,
    };
  }
}
/** Net geometric attacker count, not a count of legal moves or an engine value. */
export function controlGrid(chess) {
  const out = [];
  for (let sq = 0; sq < 64; sq++) {
    const name = sqName(sq);
    out.push(
      chess.attackers(name, "w").length - chess.attackers(name, "b").length,
    );
  }
  return out;
}
