// board.js — the rules of chess, written for speed and readability.
//
// The engine needs to try out hundreds of thousands of moves per second, so it
// keeps its own compact board instead of using the (slower, friendlier) chess.js
// library that the user interface uses. This file answers three questions:
//
//   1. What does the board look like?          -> Position.load()
//   2. Which moves are possible from here?      -> Position.generateMoves()
//   3. What happens when I play / take back a move? -> makeMove() / unmakeMove()
//
// Board layout: "0x88"
// --------------------
// The board is an array of 128 cells, laid out as 8 ranks of 16 cells. Only the
// left 8 cells of each rank are real squares; the right 8 are "off the board".
//
//     square index = rank * 16 + file        (a1 = 0, h1 = 7, a2 = 16, h8 = 119)
//
// The trick: an index is off the board exactly when (index & 0x88) !== 0. That
// makes "did this knight jump off the edge?" a single bit test, which is why
// many classic engines used this layout.

export const WHITE = 0;
export const BLACK = 1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

// A piece is stored as one small number: its type, plus 8 if it is black.
// For example a white knight is 2 and a black knight is 10.
export const makePiece = (color, type) => type | (color << 3);
export const pieceType = (piece) => piece & 7;
export const pieceColor = (piece) => piece >> 3;

// Move flags (a move can have several, e.g. a capture that promotes).
export const FLAG_CAPTURE = 1;
export const FLAG_EN_PASSANT = 2;
export const FLAG_CASTLE = 4;
export const FLAG_DOUBLE_PUSH = 8;
export const FLAG_PROMOTION = 16;

// Castling rights, one bit each.
const WHITE_KINGSIDE = 1;
const WHITE_QUEENSIDE = 2;
const BLACK_KINGSIDE = 4;
const BLACK_QUEENSIDE = 8;

// Directions on the 0x88 board.
const NORTH = 16;
const SOUTH = -16;
const EAST = 1;
const WEST = -1;
const KNIGHT_JUMPS = [33, 31, 18, 14, -14, -18, -31, -33];
const KING_STEPS = [NORTH, SOUTH, EAST, WEST, 15, 17, -15, -17];
const DIAGONALS = [15, 17, -15, -17];
const STRAIGHTS = [NORTH, SOUTH, EAST, WEST];

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const onBoard = (sq) => (sq & 0x88) === 0;
export const rankOf = (sq) => sq >> 4;
export const fileOf = (sq) => sq & 7;

export function squareName(sq) {
  return 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
}

export function parseSquare(name) {
  return (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
}

// Moving a piece from or to these squares removes some castling rights
// (the king or a rook has moved, or a rook was captured on its home square).
const CASTLING_MASK = new Array(128).fill(15);
CASTLING_MASK[parseSquare('e1')] = 15 & ~(WHITE_KINGSIDE | WHITE_QUEENSIDE);
CASTLING_MASK[parseSquare('h1')] = 15 & ~WHITE_KINGSIDE;
CASTLING_MASK[parseSquare('a1')] = 15 & ~WHITE_QUEENSIDE;
CASTLING_MASK[parseSquare('e8')] = 15 & ~(BLACK_KINGSIDE | BLACK_QUEENSIDE);
CASTLING_MASK[parseSquare('h8')] = 15 & ~BLACK_KINGSIDE;
CASTLING_MASK[parseSquare('a8')] = 15 & ~BLACK_QUEENSIDE;

const FEN_PIECES = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

export class Position {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  // Read a position written in FEN, the standard one-line notation for a chess
  // position, e.g. the start position above.
  load(fen) {
    const [placement, side, castling, ep, halfmove, fullmove] = fen.trim().split(/\s+/);
    this.board = new Array(128).fill(EMPTY);
    this.kings = [-1, -1];

    let rank = 7;
    let file = 0;
    for (const ch of placement) {
      if (ch === '/') {
        rank--;
        file = 0;
      } else if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        const color = ch === ch.toUpperCase() ? WHITE : BLACK;
        const type = FEN_PIECES[ch.toLowerCase()];
        const sq = rank * 16 + file;
        this.board[sq] = makePiece(color, type);
        if (type === KING) this.kings[color] = sq;
        file++;
      }
    }

    this.side = side === 'b' ? BLACK : WHITE;
    this.castling = 0;
    if (castling.includes('K')) this.castling |= WHITE_KINGSIDE;
    if (castling.includes('Q')) this.castling |= WHITE_QUEENSIDE;
    if (castling.includes('k')) this.castling |= BLACK_KINGSIDE;
    if (castling.includes('q')) this.castling |= BLACK_QUEENSIDE;
    this.epSquare = ep && ep !== '-' ? parseSquare(ep) : -1;
    this.halfmoveClock = Number(halfmove) || 0;
    this.fullmoveNumber = Number(fullmove) || 1;
    this.undoStack = [];
  }

  // Is `sq` attacked by any piece of color `by`? Used for check detection and
  // for castling (the king may not pass through an attacked square).
  isAttacked(sq, by) {
    const b = this.board;

    // Pawns. A white pawn on s attacks s+15 and s+17, so a white attacker of
    // sq would stand on sq-15 or sq-17 (and the mirror image for black).
    const pawn = makePiece(by, PAWN);
    const pawnFrom = by === WHITE ? [sq - 15, sq - 17] : [sq + 15, sq + 17];
    for (const from of pawnFrom) {
      if (onBoard(from) && b[from] === pawn) return true;
    }

    const knight = makePiece(by, KNIGHT);
    for (const d of KNIGHT_JUMPS) {
      const from = sq + d;
      if (onBoard(from) && b[from] === knight) return true;
    }

    const king = makePiece(by, KING);
    for (const d of KING_STEPS) {
      const from = sq + d;
      if (onBoard(from) && b[from] === king) return true;
    }

    // Sliding pieces: walk outward until we hit something.
    const bishop = makePiece(by, BISHOP);
    const rook = makePiece(by, ROOK);
    const queen = makePiece(by, QUEEN);
    for (const d of DIAGONALS) {
      for (let from = sq + d; onBoard(from); from += d) {
        const p = b[from];
        if (p === EMPTY) continue;
        if (p === bishop || p === queen) return true;
        break;
      }
    }
    for (const d of STRAIGHTS) {
      for (let from = sq + d; onBoard(from); from += d) {
        const p = b[from];
        if (p === EMPTY) continue;
        if (p === rook || p === queen) return true;
        break;
      }
    }
    return false;
  }

  inCheck(color = this.side) {
    return this.isAttacked(this.kings[color], color ^ 1);
  }

  // List every "pseudo-legal" move: moves that follow how the pieces move, but
  // might leave our own king in check. makeMove() throws those out later; that
  // is much cheaper than checking every move up front.
  //
  // With capturesOnly = true we only list captures and promotions. The search
  // uses that to finish off exchanges at the end of a line (quiescence search).
  generateMoves(capturesOnly = false) {
    const moves = [];
    const b = this.board;
    const us = this.side;
    const them = us ^ 1;

    for (let from = 0; from < 128; from++) {
      if (!onBoard(from)) {
        from += 7; // skip the 8 off-board cells at the end of this rank
        continue;
      }
      const piece = b[from];
      if (piece === EMPTY || pieceColor(piece) !== us) continue;
      const type = pieceType(piece);

      if (type === PAWN) {
        this.generatePawnMoves(from, piece, capturesOnly, moves);
        continue;
      }

      const add = (to, flags, captured) =>
        moves.push({ from, to, piece, captured, promotion: 0, flags });

      if (type === KNIGHT || type === KING) {
        const steps = type === KNIGHT ? KNIGHT_JUMPS : KING_STEPS;
        for (const d of steps) {
          const to = from + d;
          if (!onBoard(to)) continue;
          const target = b[to];
          if (target === EMPTY) {
            if (!capturesOnly) add(to, 0, EMPTY);
          } else if (pieceColor(target) === them) {
            add(to, FLAG_CAPTURE, target);
          }
        }
      } else {
        const dirs = type === BISHOP ? DIAGONALS : type === ROOK ? STRAIGHTS : KING_STEPS;
        for (const d of dirs) {
          for (let to = from + d; onBoard(to); to += d) {
            const target = b[to];
            if (target === EMPTY) {
              if (!capturesOnly) add(to, 0, EMPTY);
              continue;
            }
            if (pieceColor(target) === them) add(to, FLAG_CAPTURE, target);
            break;
          }
        }
      }
    }

    if (!capturesOnly) this.generateCastling(moves);
    return moves;
  }

  generatePawnMoves(from, piece, capturesOnly, moves) {
    const b = this.board;
    const us = this.side;
    const forward = us === WHITE ? NORTH : SOUTH;
    const startRank = us === WHITE ? 1 : 6;
    const lastRank = us === WHITE ? 7 : 0;

    const add = (to, flags, captured) => {
      if (rankOf(to) === lastRank) {
        // Reaching the last rank: one move for each piece we could promote to.
        // In captures-only mode we just consider the queen.
        const choices = capturesOnly ? [QUEEN] : [QUEEN, ROOK, BISHOP, KNIGHT];
        for (const promotion of choices) {
          moves.push({ from, to, piece, captured, promotion, flags: flags | FLAG_PROMOTION });
        }
      } else {
        moves.push({ from, to, piece, captured, promotion: 0, flags });
      }
    };

    // Straight ahead (only onto empty squares).
    const one = from + forward;
    if (onBoard(one) && b[one] === EMPTY) {
      if (!capturesOnly || rankOf(one) === lastRank) add(one, 0, EMPTY);
      const two = one + forward;
      if (!capturesOnly && rankOf(from) === startRank && b[two] === EMPTY) {
        add(two, FLAG_DOUBLE_PUSH, EMPTY);
      }
    }

    // Diagonal captures, including en passant.
    for (const side of [EAST, WEST]) {
      const to = from + forward + side;
      if (!onBoard(to)) continue;
      const target = b[to];
      if (target !== EMPTY && pieceColor(target) !== us) {
        add(to, FLAG_CAPTURE, target);
      } else if (to === this.epSquare) {
        add(to, FLAG_CAPTURE | FLAG_EN_PASSANT, makePiece(us ^ 1, PAWN));
      }
    }
  }

  generateCastling(moves) {
    const b = this.board;
    const us = this.side;
    const them = us ^ 1;
    const kingside = us === WHITE ? WHITE_KINGSIDE : BLACK_KINGSIDE;
    const queenside = us === WHITE ? WHITE_QUEENSIDE : BLACK_QUEENSIDE;
    const e = us === WHITE ? 4 : 116; // e1 or e8
    const king = makePiece(us, KING);
    if (b[e] !== king) return;

    // Squares between king and rook must be empty, and the king may not start
    // in, pass through, or land on an attacked square.
    if (this.castling & kingside &&
        b[e + 1] === EMPTY && b[e + 2] === EMPTY &&
        !this.isAttacked(e, them) && !this.isAttacked(e + 1, them) && !this.isAttacked(e + 2, them)) {
      moves.push({ from: e, to: e + 2, piece: king, captured: EMPTY, promotion: 0, flags: FLAG_CASTLE });
    }
    if (this.castling & queenside &&
        b[e - 1] === EMPTY && b[e - 2] === EMPTY && b[e - 3] === EMPTY &&
        !this.isAttacked(e, them) && !this.isAttacked(e - 1, them) && !this.isAttacked(e - 2, them)) {
      moves.push({ from: e, to: e - 2, piece: king, captured: EMPTY, promotion: 0, flags: FLAG_CASTLE });
    }
  }

  // Play a move on the board. Returns false (and puts everything back) if the
  // move would leave our own king in check, i.e. if it was not actually legal.
  makeMove(move) {
    const b = this.board;
    const us = this.side;
    const { from, to, flags } = move;

    // Remember everything that cannot be recomputed when taking the move back.
    this.undoStack.push({
      move,
      castling: this.castling,
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
    });

    b[to] = move.promotion ? makePiece(us, move.promotion) : move.piece;
    b[from] = EMPTY;

    if (flags & FLAG_EN_PASSANT) {
      // The captured pawn is not on the target square but just behind it.
      b[to + (us === WHITE ? SOUTH : NORTH)] = EMPTY;
    }
    if (flags & FLAG_CASTLE) {
      // Also move the rook: h-file rook to the f-file, or a-file rook to the d-file.
      const kingside = to > from;
      const rookFrom = kingside ? to + 1 : to - 2;
      const rookTo = kingside ? to - 1 : to + 1;
      b[rookTo] = b[rookFrom];
      b[rookFrom] = EMPTY;
    }
    if (pieceType(move.piece) === KING) this.kings[us] = to;

    this.castling &= CASTLING_MASK[from] & CASTLING_MASK[to];
    this.epSquare = flags & FLAG_DOUBLE_PUSH ? from + (us === WHITE ? NORTH : SOUTH) : -1;
    this.halfmoveClock =
      pieceType(move.piece) === PAWN || flags & FLAG_CAPTURE ? 0 : this.halfmoveClock + 1;
    if (us === BLACK) this.fullmoveNumber++;
    this.side = us ^ 1;

    if (this.isAttacked(this.kings[us], us ^ 1)) {
      this.unmakeMove();
      return false;
    }
    return true;
  }

  // Take back the last move played with makeMove().
  unmakeMove() {
    const { move, castling, epSquare, halfmoveClock } = this.undoStack.pop();
    const b = this.board;
    const us = this.side ^ 1; // the side that made the move
    const { from, to, flags } = move;

    b[from] = move.piece;
    if (flags & FLAG_EN_PASSANT) {
      b[to] = EMPTY;
      b[to + (us === WHITE ? SOUTH : NORTH)] = move.captured;
    } else {
      b[to] = move.captured;
    }
    if (flags & FLAG_CASTLE) {
      const kingside = to > from;
      const rookFrom = kingside ? to + 1 : to - 2;
      const rookTo = kingside ? to - 1 : to + 1;
      b[rookFrom] = b[rookTo];
      b[rookTo] = EMPTY;
    }
    if (pieceType(move.piece) === KING) this.kings[us] = from;

    this.castling = castling;
    this.epSquare = epSquare;
    this.halfmoveClock = halfmoveClock;
    if (us === BLACK) this.fullmoveNumber--;
    this.side = us;
  }

  // Only the moves that are really legal (slower; the search does not use it).
  legalMoves() {
    return this.generateMoves().filter((m) => {
      if (!this.makeMove(m)) return false;
      this.unmakeMove();
      return true;
    });
  }
}

// "e2e4", "e7e8q": the compact notation engines use to talk about moves.
export function moveToUci(move) {
  const promo = move.promotion ? ' nbrq'[move.promotion - 1] : '';
  return squareName(move.from) + squareName(move.to) + promo;
}
