#!/usr/bin/env python3
"""Write server/tests/parity_fixtures.json: positions + Python analysis outputs, for tools/parity.mjs.
Positions come from seeded random playouts so the file is reproducible. Needs: pip install -r server/requirements.txt"""
import json, random, sys
from pathlib import Path
import chess
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from x3dchess_server.analysis.phase_space import PhaseSpaceAnalyzer
from x3dchess_server.analysis.tactical_detector import TacticalDetector, TacticalPattern
from x3dchess_server.analysis.bifurcation_detector import BifurcationDetector

rng = random.Random(7)
pos = []
for g in range(400):
    b = chess.Board()
    for ply in range(rng.randint(10, 90)):
        mv = rng.choice(list(b.legal_moves)) if not b.is_game_over() else None
        if mv is None: break
        b.push(mv)
        if ply % 6 == 0: pos.append(b.fen())
pos += ["2q3k1/4N3/8/8/8/8/8/6K1 w - - 0 1", "r3k3/8/8/8/8/8/8/R3K2R b KQq - 0 1"]
ps, td = PhaseSpaceAnalyzer(), TacticalDetector()
# keep every position that has a fork/pin, plus a sample of the rest, so tactic coverage is not thin
has = lambda f: any(m.pattern != TacticalPattern.OVERLOAD for m in td.detect_all_patterns(chess.Board(f)))
rich = [f for f in pos if has(f)]; rest = [f for f in pos if f not in set(rich)]
pos = rich[:350] + rng.sample(rest, min(300, len(rest)))
out = {"positions": []}
for fen in pos:
    b = chess.Board(fen)
    p = ps.analyze_position("x", fen, 0).to_dict()
    tac = [m.to_dict() for m in td.detect_all_patterns(b) ]
    out["positions"].append({"fen": fen, "phase": {k: p[k] for k in ("material_balance", "space_control", "king_safety")}, "tactics": tac})
# critical-moment sequences: random eval walks over real game positions
out["critical"] = []
for g in range(30):
    b = chess.Board(); bd = BifurcationDetector(); seq = []; ev = 0.0
    for ply in range(1, rng.randint(12, 70)):
        if b.is_game_over(): break
        b.push(rng.choice(list(b.legal_moves)))
        ev += rng.choice([0, 0, 0.1, 0.3, -0.4, 0.6, -1.2, 1.5, -0.05])
        ev = round(ev, 2)
        bd.add_position(ply, ev, "m", b.fen())
        m = bd.get_latest_critical_moment()
        seq.append({"ply": ply, "eval": ev, "fen": b.fen(), "critical": m.severity if m and m.move_number == ply else None})
    out["critical"].append(seq)
Path("server/tests/parity_fixtures.json").write_text(json.dumps(out, separators=(",", ":")))
print(len(out["positions"]), "positions,", sum(len(s) for s in out["critical"]), "critical steps")
