// Opening FENs derive from legal SAN prefixes. Python parity tests check every field.
import { Chess } from "../vendor/chess.js";

function opening(id, name, weight, san) {
  const moves = san.split(" "), chess = new Chess();
  for (const move of moves) chess.move(move);
  return Object.freeze({ id, name, weight, moves: Object.freeze(moves), fen: chess.fen() });
}

export const OPENINGS = Object.freeze([
  opening("italian", "Italian Game", 1.0, "e4 e5 Nf3 Nc6 Bc4"),
  opening("ruy_lopez", "Ruy Lopez", 1.2, "e4 e5 Nf3 Nc6 Bb5"),
  opening("sicilian", "Sicilian Defense", 1.5, "e4 c5"),
  opening("french", "French Defense", 0.9, "e4 e6 d4 d5 e5"),
  opening("caro_kann", "Caro-Kann Defense", 0.8, "e4 c6"),
  opening("queens_gambit", "Queen's Gambit", 1.1, "d4 d5 c4"),
  opening("kings_indian", "King's Indian Defense", 1.0, "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6"),
  opening("english", "English Opening", 0.7, "c4"),
  opening("reti", "Reti Opening", 0.6, "Nf3"),
  opening("scotch", "Scotch Game", 0.8, "e4 e5 Nf3 Nc6 d4"),
]);

/** Weighted pick with a seeded RNG; the book preserves the existing weights. */
export function pickOpening(rng) {
  const total = OPENINGS.reduce((a, o) => a + o.weight, 0);
  let r = rng() * total;
  for (const o of OPENINGS) { r -= o.weight; if (r <= 0) return o; }
  return OPENINGS[0];
}
