// evaluate.js — "how good is this position?" as a single number.
//
// This is the engine's whole sense of chess judgement, and it is deliberately
// simple. There is no neural network and no learning: just numbers a human
// chose, in the tradition of Claude Shannon's 1950 paper on chess programs.
//
// Scores are in "centipawns": 100 = one pawn. Positive means good for the side
// whose turn it is (the search needs it that way; see search.js).
//
// The score is the sum of two ideas:
//   1. Material: count the pieces (a queen is worth about 9 pawns, etc.).
//   2. Piece-square tables: a bonus or penalty for WHERE each piece stands
//      (knights like the center, pawns like to advance, the king likes to hide
//      in the corner early on and come to the center in the endgame).
// Plus one small endgame helper ("mop-up") so the engine can actually finish
// off a lone king instead of wandering around.

import {
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, EMPTY,
  pieceType, pieceColor, rankOf, fileOf,
} from './board.js';

// Material values, indexed by piece type (EMPTY, PAWN, KNIGHT, ... KING).
// The king has no material value: it can never be captured.
export const PIECE_VALUES = [0, 100, 320, 330, 500, 900, 0];

// Piece-square tables from Tomasz Michniewski's "Simplified Evaluation
// Function" (chessprogramming.org). They are written the way a board looks
// from White's side: the first row is rank 8, the last row is rank 1.
// Black uses the same tables mirrored vertically.
const PAWN_TABLE = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const KNIGHT_TABLE = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
const BISHOP_TABLE = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
const ROOK_TABLE = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
const QUEEN_TABLE = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
// Early in the game the king should stay safe behind its pawns...
const KING_MIDDLEGAME_TABLE = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];
// ...but once most pieces are gone it becomes a fighting piece.
const KING_ENDGAME_TABLE = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

const TABLES = [null, PAWN_TABLE, KNIGHT_TABLE, BISHOP_TABLE, ROOK_TABLE, QUEEN_TABLE];

// Total non-pawn material at the start (both sides): 2 * (2N + 2B + 2R + Q).
const OPENING_PIECE_MATERIAL = 2 * (2 * 320 + 2 * 330 + 2 * 500 + 900);

// Where in a table a piece on `sq` looks up its bonus.
function tableIndex(sq, color) {
  const rank = rankOf(sq);
  const row = color === WHITE ? 7 - rank : rank; // mirror for Black
  return row * 8 + fileOf(sq);
}

// How far a square is from the center (0 in the middle, 6 in a corner).
function centerDistance(sq) {
  const r = rankOf(sq);
  const f = fileOf(sq);
  return Math.max(3 - r, r - 4) + Math.max(3 - f, f - 4);
}

// Detailed breakdown, from White's point of view. The UI could show this; the
// search only needs the total (see evaluate() below).
export function evaluateBreakdown(pos) {
  const material = [0, 0];
  const placement = [0, 0];
  const pieceMaterial = [0, 0]; // non-pawn material, to tell middlegame from endgame

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = pos.board[sq];
    if (piece === EMPTY) continue;
    const type = pieceType(piece);
    const color = pieceColor(piece);
    material[color] += PIECE_VALUES[type];
    if (type !== PAWN && type !== KING) pieceMaterial[color] += PIECE_VALUES[type];
    if (type !== KING) placement[color] += TABLES[type][tableIndex(sq, color)];
  }

  // "Game phase": 1.0 at the start, sliding toward 0.0 as pieces come off.
  // The king's table is blended between its middlegame and endgame versions.
  const phase = Math.min(1, (pieceMaterial[WHITE] + pieceMaterial[BLACK]) / OPENING_PIECE_MATERIAL);
  for (const color of [WHITE, BLACK]) {
    const i = tableIndex(pos.kings[color], color);
    placement[color] += Math.round(
      KING_MIDDLEGAME_TABLE[i] * phase + KING_ENDGAME_TABLE[i] * (1 - phase),
    );
  }

  // Mop-up: when one side is clearly ahead in an endgame, reward pushing the
  // enemy king to the edge and bringing our own king closer. Without this a
  // shallow search often cannot see how to deliver mate with, say, K+Q vs K.
  let mopUp = 0;
  const diff = material[WHITE] - material[BLACK];
  if (phase < 0.5 && Math.abs(diff) >= 300) {
    const winner = diff > 0 ? WHITE : BLACK;
    const loserKing = pos.kings[winner ^ 1];
    const winnerKing = pos.kings[winner];
    const kingDistance =
      Math.abs(rankOf(loserKing) - rankOf(winnerKing)) + Math.abs(fileOf(loserKing) - fileOf(winnerKing));
    const bonus = Math.round((10 * centerDistance(loserKing) + 4 * (14 - kingDistance)) * (1 - phase));
    mopUp = winner === WHITE ? bonus : -bonus;
  }

  return {
    material: diff,
    placement: placement[WHITE] - placement[BLACK],
    mopUp,
    phase,
    total: diff + placement[WHITE] - placement[BLACK] + mopUp,
  };
}

// The number the search uses: positive = good for the side to move.
export function evaluate(pos) {
  const whiteScore = evaluateBreakdown(pos).total;
  return pos.side === WHITE ? whiteScore : -whiteScore;
}
