// Sanity checks that each level behaves the way levels.js describes.
import { Position } from '../engine/board.js';
import { findBestMove, isMateScore } from '../engine/search.js';
import { LEVELS } from '../engine/levels.js';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`);
}

// A fixed "random" sequence so the noisy levels are repeatable in tests.
function seeded(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const noNoise = (level) => ({ ...level, randomness: 0, blunderChance: 0 });

// 1. Mate in one: a back-rank mate. White to move plays Ra8#.
const mateIn1 = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
for (const name of ['medium', 'hard']) {
  const r = findBestMove(new Position(mateIn1), LEVELS[name]);
  check(`${name} finds mate in one`, r.move === 'a1a8' && isMateScore(r.score), `(${r.move}, score ${r.score})`);
}

// 2. Free queen: Black's queen on d5 is undefended, White's knight on c3 can take it.
const freeQueen = 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3';
for (const name of ['beginner', 'medium', 'hard']) {
  const r = findBestMove(new Position(freeQueen), noNoise(LEVELS[name]));
  check(`${name} (no noise) takes a free queen`, r.move === 'c3d5', `(${r.move})`);
}

// 3. Poisoned pawn: the pawn on d5 is defended by the e6 pawn, so Qxd5 loses the queen.
//    Beginner (depth 1, no quiescence) falls for it; medium and hard do not.
const poisoned = 'rnbqkbnr/ppp2ppp/4p3/3p4/8/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 0 3';
{
  const b = findBestMove(new Position(poisoned), noNoise(LEVELS.beginner));
  check('beginner (no noise) grabs a defended pawn with its queen', b.move === 'f3d5', `(${b.move})`);
  for (const name of ['medium', 'hard']) {
    const r = findBestMove(new Position(poisoned), LEVELS[name], { random: seeded(1) });
    check(`${name} avoids losing its queen`, r.move !== 'f3d5', `(${r.move})`);
  }
}

// 4. Speed: hard must answer within its time limit (plus a little slack).
for (const fen of [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8',
]) {
  const r = findBestMove(new Position(fen), LEVELS.hard);
  check('hard answers in time', r.timeMs < LEVELS.hard.timeLimitMs + 1500,
    `(depth ${r.depth}, ${r.nodes} nodes, ${r.timeMs} ms, ${r.move}, pv ${r.pv.join(' ')})`);
}

// 5. Every level returns a legal move from the start position.
for (const [name, level] of Object.entries(LEVELS)) {
  const pos = new Position();
  const legal = pos.legalMoves().length;
  const r = findBestMove(pos, level);
  check(`${name} returns a move`, typeof r.move === 'string' && legal === 20,
    `(${r.move}, depth ${r.depth}, ${r.nodes} nodes, ${r.timeMs} ms)`);
}

if (failed) {
  console.error(`${failed} engine test(s) failed`);
  process.exit(1);
}
console.log('All engine tests passed.');
