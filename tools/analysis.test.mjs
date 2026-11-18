import assert from "node:assert/strict";
import { Chess } from "../viewer/vendor/chess.js";
import {
  absolutePins,
  detectTactics,
  phaseSpacePoint,
  controlGrid,
  BifurcationDetector,
  GameAnalysis,
} from "../viewer/js/analysis.js";
const kinds = (fen, kind) =>
  detectTactics(new Chess(fen)).filter((t) => t.pattern === kind);
const fork = kinds("2q3k1/4N3/8/8/8/8/8/6K1 b - - 0 1", "fork")[0];
assert.equal(fork.piece_color, "white");
assert.deepEqual(fork.target_squares, ["c8", "g8"]);
assert.equal(fork.severity, "candidate");
const pinFen = "4k3/4n3/8/8/8/8/8/K3R3 w - - 0 1";
assert.deepEqual(absolutePins(new Chess(pinFen)), [
  { attacker: "e1", pinned: "e7", king: "e8" },
]);
assert.equal(controlGrid(new Chess(pinFen))[37], -1); // f5 remains geometrically attacked by the pinned knight.
for (const fen of [
  "4k3/8/8/4R3/8/8/4n3/K7 b - - 0 1",
  "4k3/8/4n3/8/4p3/8/8/4R1K1 w - - 0 1",
  "4k3/4n3/8/8/8/8/8/4B1K1 w - - 0 1",
])
  assert.equal(kinds(fen, "pin").length, 0);
assert.equal(
  kinds("k3r3/8/8/8/3q4/6r1/4N3/4K3 w - - 0 1", "fork").some(
    (t) => t.piece_square === "e2",
  ),
  false,
);
const c = new Chess("4k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1"),
  before = c.fen(),
  history = c.history(),
  pgn = c.pgn();
const discovery = detectTactics(c).find((t) => t.pattern === "discovery");
assert.equal(discovery.revealed_square, "e1");
for (const uci of discovery.witness_moves) {
  const p = new Chess(before);
  p.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    ...(uci[4] ? { promotion: uci[4] } : {}),
  });
  assert.equal(p.isCheck(), true);
  assert.equal(p.attackers("e8", "w").includes("e1"), true);
}
assert.equal(c.fen(), before);
assert.deepEqual(c.history(), history);
assert.equal(c.pgn(), pgn);
for (const fen of [
  "4k3/8/4p3/8/4B3/8/8/4R1K1 w - - 0 1",
  "4k3/8/8/8/4B3/8/8/4B1K1 w - - 0 1",
])
  assert.equal(kinds(fen, "discovery").length, 0);
assert.deepEqual(
  kinds("8/8/8/R2pP2k/8/8/8/7K w - d6 0 1", "discovery")[0].witness_moves,
  ["e5d6"],
);
assert.equal(
  detectTactics(new Chess()).some((t) => t.pattern === "overload"),
  false,
);
assert.equal(
  phaseSpacePoint(new Chess("4k3/8/8/8/8/8/8/K7 w - - 0 1")).king_safety,
  0.5,
);
for (const value of [2, -2]) {
  const d = new BifurcationDetector();
  assert.equal(d.add(0, 0, before), null);
  assert.equal(d.add(1, value, before), "large_swing");
  assert.throws(() => d.add(1, 0, before));
}
assert.throws(() => new BifurcationDetector().add(0, NaN, before));
const an = new GameAnalysis(),
  game = new Chess();
let source = game.fen();
game.move("e4");
let result = an.onMove(game, 1, 0, {
  evalPly: 0,
  evalFen: source,
  mateIn: null,
});
assert.equal(result.critical, null);
source = game.fen();
game.move("e5");
result = an.onMove(game, 2, 200, { evalPly: 1, evalFen: source, mateIn: null });
assert.equal(result.critical, "large_swing");
assert.equal(result.critical_for_ply, 1);
source = game.fen();
game.move("Nf3");
result = an.onMove(game, 3, 100000, { evalPly: 2, evalFen: source, mateIn: 1 });
assert.equal(result.critical, null);
source = game.fen();
game.move("Nc6");
result = an.onMove(game, 4, 100, { evalPly: 3, evalFen: source, mateIn: null });
assert.equal(result.critical, null);
source = game.fen();
game.move("Bc4");
result = an.onMove(game, 5, 200, {
  evalPly: 4,
  evalFen: source,
  scoreBound: "lowerbound",
});
assert.equal(result.critical, null);
console.log(
  "PASS known chess meaning: pin rays and attack semantics, legal discoveries/en passant, neutral score scope, shield edges and non-mutation",
);
