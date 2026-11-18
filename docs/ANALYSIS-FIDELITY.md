# Analysis fidelity: geometry, legal witnesses and scored positions

This revision corrects the inherited detector rather than preserving a wrong
answer merely to retain JavaScript/Python parity. `docs/RESULTS.md` remains a
record of the earlier port; its known-quirks section describes the old code.
The current source and the new known-answer controls have a narrower contract.

## Three different kinds of evidence

| Output | What is established | What is not established |
|---|---|---|
| Fork/skewer candidate | A bounded geometric arrangement of existing pieces | A safe capture, forced line, best move or material win |
| Absolute pin | King, one friendly blocker and the first appropriate enemy slider share an unobstructed ray | That the pinned piece stops attacking squares |
| Discovered-check candidate | At least one actual legal move exposes an unmoved friendly slider's check | Best play, a forced continuation, general discovery coverage or a win |
| Evaluation swing | The magnitude of change between two explicitly scored positions | A blunder, mistake, centipawn loss or causal attribution to one move |
| Material exchange | More than 15% of the sampled material total disappears over two sample intervals | An exact opening/middlegame/endgame boundary |
| Phase-space coordinates | The stated material/control/pawn-shield features | Win probability, an embedding learned from data or engine evaluation |

Every tactical record retains the original display fields and adds `status`,
`witness_moves`, and `revealed_square`. `severity` is now `candidate`, so a
plausible arrangement cannot be presented as a proven win. Static forks,
absolute pins and skewers inspect both colors; discovery witnesses apply only
to the actual side to move.

`detectTactics(chess)` and `TacticalDetector.detect_all_patterns(board)` retain
their public entrypoints. JavaScript also exports `absolutePins(chess)`, whose
records are `{attacker, pinned, king}` square names. These can drive a clear
X3D ray without inferring the ray from a prose label.

## Corrected tactical boundaries

Pins now scan from each king, through exactly one friendly blocker, toward the
first subsequent occupied square. The pinner's movement type must match the
ray. This rejects the old reversed-direction case, an additional blocker, and
a bishop incorrectly acting like a rook. The positive fixture is independently
checked with python-chess's pin query.

Fork candidates count current attacks on at least two enemy kings/queens/rooks,
using non-king attackers. Off-ray targets of an absolutely pinned attacker are
excluded from the fork display. This remains a deliberately bounded feature:
not every possible tactical fork is enumerated and material gain is not searched.

Skewers require a slider's first two occupied ray squares to contain an opposing
king/queen and a lower-valued opposing queen/rook/minor piece. A blocker cannot
be ignored, and a rook cannot act along a diagonal. The label explicitly says
that replies have not been searched.

Discoveries test legal moves, then read the actual resulting attack by the
named unmoved slider. Additional blockers and illegal moves therefore cannot
become witnesses. En passant is handled separately because it removes a pawn
from a square other than the destination. The positive fixture
`8/8/8/R2pP2k/8/8/8/7K w - d6 0 1` has the legal witness `e5d6`, which reveals
Ra5's check on Kh5. The JavaScript probe restores FEN, history and PGN after
trying a witness.

The old overloading heuristic is removed. A defender touching two pieces does
not prove that a deflection wins either of them. `detect_overloading` is a
reserved compatibility method returning no unproved labels; a future version
needs a concrete tactical witness or search result.

## Attacked squares are not legal moves

The pressure map deliberately retains geometric attack counts, including
attacks by pinned pieces. Its values are White attackers minus Black attackers,
not legal-move counts, square safety, engine scores or territorial probabilities.
This distinction is essential for king moves: the pinned knight on e7 can still
make f5 an attacked square even though that knight has no legal move off its pin.

Primary API context: [python-chess attacks and pins](https://python-chess.readthedocs.io/en/latest/core.html#attacks),
[chess.js attackers and legal moves](https://jhlywa.github.io/chess.js/).
The project's known-answer fixtures use these APIs as independent rule checks;
matching two project implementations alone would not establish the meaning.

## Score identity and neutral language

A UCI play-search score belongs to its pre-move position. The post-move board is
still the right source for tactic geometry and phase features. The analysis API
keeps those identities separate:

```js
analysis.onMove(currentBoard, postMovePly, scoreCp, {
  evalFen: searchedFen,
  evalPly: searchedPly,
  mateIn: search.mate,
  scoreBound: search.score_bound
});
```

The returned `critical_for_ply` identifies the sampled score position when a
swing exists. `large_swing`, `medium_swing`, and `small_swing` use absolute
thresholds of 1.0, 0.5 and 0.2 pawn units. Upward and downward changes use the
same neutral language. Mate proxies, unavailable scores and non-exact bounds
reset the numeric swing window, preventing incompatible samples from being
compared as ordinary centipawns. An engine score is itself search-dependent.
Replay's material proxy remains a different, labeled source.

Python's `BifurcationDetector.add_position(ply, score_pawns, move, scored_fen)`
retains its signature and now binds a moment to that sample's FEN. Both versions
reject nonfinite scores and nonincreasing sampled plies. The move text is context,
not a move-quality verdict. Comparing a played move against best alternatives
at an appropriate common search budget remains future work.

## Feature-space correction

Material uses P=1, N=3, B=3, R=5 and Q=9, with White minus Black. Weighted geometric
attack counts provide the control feature. Pawn shields and nearby enemy pieces
provide the king feature; it is a heuristic difference between separately clamped
side scores. An a/h-file king now counts its two actual neighboring shield files
once each, instead of counting an edge file twice. In the bare-king fixture with
White Ka1 and Black Ke8 the declared side heuristics are 4.0 and 3.5, giving +0.5.
These coordinates can be useful for visual comparison without a probability claim.

## Draw helper correction

The legacy, non-live `DrawDetector` now delegates rule outcomes and claims to
python-chess rather than comparing material dictionaries or placement strings.
`detect_draw(..., claim_draw=False)` reports automatic draws by default;
claim adjudication is explicit. Repetition requires retained legal move history,
not a repeated FEN-placement list. Checkmate takes precedence over move-count
claims. The repetition key includes side to move, castling rights and legally
available en-passant rights; it is not a cryptographic hash.

The old `get_draw_probability` name survives only as a documented compatibility
alias for an uncalibrated material indicator, now also named
`get_material_draw_indicator`. It is not used to make probability claims in the
viewer. The live GameManager's explicit auto-claim/ply-cap policy is documented
separately by the server; this helper does not silently change that policy.

## Executed checks

- 13 Python known-answer tests pass normally and with Python `-O`.
- `node tools/analysis.test.mjs` checks actual JS outputs, legal discovery moves,
  the pinned-attack distinction, edge files, mutation restoration, mate/bound
  handling and scored-position identity.
- The regenerated parity bank contains 635 unique positions, 425 tactical
  records and 1,178 critical-sample steps. The Python and JS outputs have zero
  mismatches for the three compared features, motifs and neutral labels.
- Fixture producer hashes are checked before parity runs. A source change
  requires regeneration instead of silently treating old expected output as current.

Reproduce from the repository root after installing server requirements:

```sh
PYTHONPATH=server python3 -m unittest discover -s server/tests -p test_analysis_fidelity.py
PYTHONPATH=server python3 -O -m unittest discover -s server/tests -p test_analysis_fidelity.py
node tools/analysis.test.mjs
PYTHONPATH=server python3 tools/parity_gen.py
node tools/parity.mjs
```

These are rule/analysis and cross-language checks. Native X3D pixels, Stockfish
strength, all possible tactics and human move-quality judgments are outside
this instrument's scope.
