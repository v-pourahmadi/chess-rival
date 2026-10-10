// search.js — how the engine decides which move to play.
//
// The idea is the one Claude Shannon described in 1950 and every classic chess
// program since (including Deep Blue, which beat Kasparov in 1997) has used:
//
//   1. Try every move. For each, try every reply. For each of those, every
//      counter-reply... down to a fixed depth. This is a "game tree".
//   2. At the bottom of the tree, score the position with evaluate().
//   3. Pass scores back up assuming both sides play their best: at our turn we
//      take the maximum, at the opponent's turn the minimum. This is MINIMAX.
//
// Two classic refinements make it practical:
//
//   * ALPHA-BETA PRUNING. Once we know one of our moves leads to at least +1,
//     and we find that another move lets the opponent reach -3 with some reply,
//     we can stop looking at that move's other replies: it is already worse.
//     Same answer as plain minimax, but often 100x less work.
//
//   * QUIESCENCE SEARCH. Stopping the look-ahead in the middle of a trade gives
//     nonsense ("I just took a queen!" while the recapture is next move). So at
//     the end we keep playing captures only, until the position is quiet.
//
// We write minimax in its "negamax" form: a score is always from the point of
// view of the side to move, so "the opponent's best" is just minus our score.
// One function then handles both sides.

import { evaluate, PIECE_VALUES } from './evaluate.js';
import { moveToUci, pieceType, FLAG_CAPTURE, FLAG_PROMOTION } from './board.js';

export const MATE = 100000; // score for delivering checkmate (minus the plies it takes)
const INFINITY = 1000000;

// Anything this close to MATE is "mate in N", not a material score.
export const isMateScore = (score) => Math.abs(score) > MATE - 1000;

class Search {
  constructor(pos, level, { now, random }) {
    this.pos = pos;
    this.level = level;
    this.now = now;
    this.random = random;
    this.nodes = 0; // positions visited: a good measure of "how hard it thought"
    this.deadline = Infinity;
    this.aborted = false;
    this.pv = []; // pv[ply] = best line found from that ply on ("principal variation")
    this.killers = []; // quiet moves that caused a cutoff at each ply (move ordering)
  }

  // ---- Move ordering -------------------------------------------------------
  // Alpha-beta prunes most when the best move is tried first. We cannot know
  // the best move in advance, so we guess: captures of big pieces by small
  // pieces first ("most valuable victim, least valuable attacker"), then
  // promotions, then quiet moves that were good elsewhere at this depth.
  orderMoves(moves, ply, firstMove = null) {
    if (!this.level.moveOrdering && !firstMove) return moves;
    const killers = this.killers[ply] || [];
    const scoreOf = (m) => {
      if (firstMove && sameMove(m, firstMove)) return 1e6;
      if (!this.level.moveOrdering) return 0;
      let s = 0;
      if (m.flags & FLAG_CAPTURE) {
        s += 10000 + 10 * PIECE_VALUES[pieceType(m.captured)] - PIECE_VALUES[pieceType(m.piece)];
      }
      if (m.flags & FLAG_PROMOTION) s += 9000 + PIECE_VALUES[m.promotion];
      if (s === 0 && killers.some((k) => sameMove(k, m))) s = 8000;
      return s;
    };
    for (const m of moves) m.order = scoreOf(m);
    return moves.sort((a, b) => b.order - a.order);
  }

  rememberKiller(move, ply) {
    if (move.flags & (FLAG_CAPTURE | FLAG_PROMOTION)) return;
    const k = this.killers[ply] || (this.killers[ply] = []);
    if (k.length && sameMove(k[0], move)) return;
    k.unshift(move);
    k.length = Math.min(k.length, 2);
  }

  timeUp() {
    // Checking the clock is slow, so only do it every 2048 positions.
    if ((this.nodes & 2047) === 0 && this.now() > this.deadline) this.aborted = true;
    return this.aborted;
  }

  // ---- The core: negamax with alpha-beta -----------------------------------
  // Returns the score of the current position, from the side to move's view,
  // looking `depth` moves ahead.
  //   alpha = the score we are already guaranteed elsewhere (a lower bound)
  //   beta  = the score the opponent will never allow us to exceed (upper bound)
  // If a move scores >= beta, the opponent would avoid this position entirely,
  // so we can stop searching it: that is the "beta cutoff" (the pruning).
  negamax(depth, alpha, beta, ply) {
    this.pv[ply] = [];
    if (this.timeUp()) return 0;

    // 50 moves without a capture or pawn move is a draw.
    if (ply > 0 && this.pos.halfmoveClock >= 100) return 0;

    if (depth <= 0) {
      return this.level.quiescence ? this.quiesce(alpha, beta, ply) : this.leaf();
    }
    this.nodes++;

    const moves = this.orderMoves(this.pos.generateMoves(), ply);
    let legalMoves = 0;
    let best = -INFINITY;

    for (const move of moves) {
      if (!this.pos.makeMove(move)) continue; // illegal: leaves our king in check
      legalMoves++;
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.pos.unmakeMove();
      if (this.aborted) return 0;

      if (score > best) best = score;
      if (score > alpha) {
        alpha = score;
        this.pv[ply] = [move, ...this.pv[ply + 1]];
      }
      if (alpha >= beta) {
        this.rememberKiller(move, ply);
        break; // beta cutoff: the opponent won't let us get here
      }
    }

    if (legalMoves === 0) {
      // No legal moves: checkmate if we are in check, otherwise stalemate.
      // Subtracting ply makes the engine prefer faster mates (and slower losses).
      return this.pos.inCheck() ? -(MATE - ply) : 0;
    }
    return best;
  }

  leaf() {
    this.nodes++;
    return evaluate(this.pos);
  }

  // ---- Quiescence search ----------------------------------------------------
  // Only captures (and promotions). "Stand pat": the side to move may also
  // decline to capture, so the static evaluation is a floor on its score.
  quiesce(alpha, beta, ply) {
    this.nodes++;
    if (this.timeUp()) return 0;

    const standPat = evaluate(this.pos);
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;

    const moves = this.orderMoves(this.pos.generateMoves(true), ply);
    for (const move of moves) {
      if (!this.pos.makeMove(move)) continue;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      this.pos.unmakeMove();
      if (this.aborted) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  // ---- The root: the moves we can actually play now --------------------------
  // scoreEveryMove = true gives every root move an exact score (needed when we
  // add random noise to the scores). false uses alpha-beta at the root too,
  // which is faster but only tells us which move is best.
  searchRoot(depth, rootMoves, scoreEveryMove) {
    let alpha = -INFINITY;
    let best = null;
    for (const entry of rootMoves) {
      this.pos.makeMove(entry.move);
      const score = scoreEveryMove
        ? -this.negamax(depth - 1, -INFINITY, INFINITY, 1)
        : -this.negamax(depth - 1, -INFINITY, -alpha, 1);
      this.pos.unmakeMove();
      if (this.aborted) return null;
      entry.score = score;
      if (score > alpha) {
        alpha = score;
        best = entry;
        this.pv[0] = [entry.move, ...this.pv[1]];
      }
    }
    return { best, score: alpha, pv: this.pv[0] };
  }

  run() {
    const start = this.now();
    this.deadline = start + this.level.timeLimitMs;

    // The legal moves available right now.
    const rootMoves = this.pos.generateMoves()
      .filter((m) => {
        if (!this.pos.makeMove(m)) return false;
        this.pos.unmakeMove();
        return true;
      })
      .map((move) => ({ move, score: 0 }));
    if (rootMoves.length === 0) return null;

    const scoreEveryMove = this.level.randomness > 0;
    let result = null;
    let completedDepth = 0;

    // Iterative deepening: search depth 1, then 2, then 3... Each finished
    // depth gives a usable answer, so when time runs out we keep the last one.
    // The best move from the previous depth is tried first at the next one,
    // which makes alpha-beta much more effective.
    for (let depth = 1; depth <= this.level.depth; depth++) {
      if (completedDepth > 0 && this.now() > this.deadline) break;
      if (completedDepth === 0) this.deadline = Infinity; // always finish depth 1
      if (result) {
        rootMoves.sort((a, b) => (a === result.best ? -1 : b === result.best ? 1 : b.score - a.score));
      } else if (this.level.moveOrdering) {
        const ordered = this.orderMoves(rootMoves.map((e) => e.move), 0);
        rootMoves.sort((a, b) => ordered.indexOf(a.move) - ordered.indexOf(b.move));
      }
      const attempt = this.searchRoot(depth, rootMoves, scoreEveryMove);
      if (completedDepth === 0) this.deadline = start + this.level.timeLimitMs;
      if (!attempt) break; // ran out of time partway: discard the unfinished depth
      result = attempt;
      completedDepth = depth;
      if (isMateScore(result.score) && result.score > 0) break; // found a forced mate
    }

    // ---- Choosing the move: where the lower levels get weaker ----
    let chosen = result.best;
    let reason = 'best';
    if (this.level.randomness > 0) {
      // Add noise to every score and take the highest noisy score.
      let bestNoisy = -Infinity;
      for (const entry of rootMoves) {
        entry.noisyScore = entry.score + (this.random() * 2 - 1) * this.level.randomness;
        if (entry.noisyScore > bestNoisy) {
          bestNoisy = entry.noisyScore;
          chosen = entry;
        }
      }
      if (chosen !== result.best) reason = 'noise';
    }
    if (this.random() < this.level.blunderChance) {
      chosen = rootMoves[Math.floor(this.random() * rootMoves.length)];
      reason = chosen === result.best ? 'best' : 'random';
    }

    const candidates = scoreEveryMove
      ? [...rootMoves].sort((a, b) => b.score - a.score)
      : [result.best];

    return {
      move: moveToUci(chosen.move),
      score: chosen === result.best ? result.score : chosen.score,
      bestMove: moveToUci(result.best.move),
      bestScore: result.score,
      reason, // 'best', 'noise' (randomness changed the choice) or 'random' (a blunder)
      depth: completedDepth,
      nodes: this.nodes,
      timeMs: Math.round(this.now() - start),
      pv: result.pv.map(moveToUci), // the line it expects: its move, your reply, ...
      candidates: candidates.map((e) => ({
        move: moveToUci(e.move),
        score: e.score,
        noisyScore: e.noisyScore,
      })),
    };
  }
}

function sameMove(a, b) {
  return a.from === b.from && a.to === b.to && a.promotion === b.promotion;
}

// Pick a move for the side to move in `pos` at the given level (see levels.js).
// Scores in the result are from the engine's point of view, in centipawns.
export function findBestMove(pos, level, {
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  random = Math.random,
} = {}) {
  return new Search(pos, level, { now, random }).run();
}
