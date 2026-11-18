// Opening book, ported 1:1 from chess-spectator backend/openings.py (10 openings, same FENs and weights).
export const OPENINGS = [
  { id: "italian", name: "Italian Game", weight: 1.0, fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3" },
  { id: "ruy_lopez", name: "Ruy Lopez", weight: 1.2, fen: "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3" },
  { id: "sicilian", name: "Sicilian Defense", weight: 1.5, fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1" },
  { id: "french", name: "French Defense", weight: 0.9, fen: "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3" },
  { id: "caro_kann", name: "Caro-Kann Defense", weight: 0.8, fen: "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1" },
  { id: "queens_gambit", name: "Queen's Gambit", weight: 1.1, fen: "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 1" },
  { id: "kings_indian", name: "King's Indian Defense", weight: 1.0, fen: "rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4" },
  { id: "english", name: "English Opening", weight: 0.7, fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  { id: "reti", name: "Reti Opening", weight: 0.6, fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  { id: "scotch", name: "Scotch Game", weight: 0.8, fen: "r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3" },
];

/** Weighted pick with a seeded rng (original used random.choices with the same weights). */
export function pickOpening(rng) {
  const total = OPENINGS.reduce((a, o) => a + o.weight, 0);
  let r = rng() * total;
  for (const o of OPENINGS) { r -= o.weight; if (r <= 0) return o; }
  return OPENINGS[0];
}
