// Perft ("performance test") counts every legal move sequence to a fixed depth
// and compares against numbers the chess-programming community has verified.
// If the counts match, the move generator in engine/board.js follows the rules
// exactly, including castling, en passant and promotion.
// Positions and counts from https://www.chessprogramming.org/Perft_Results
import { Position } from '../engine/board.js';

function perft(pos, depth) {
  if (depth === 0) return 1;
  let count = 0;
  for (const move of pos.generateMoves()) {
    if (!pos.makeMove(move)) continue;
    count += perft(pos, depth - 1);
    pos.unmakeMove();
  }
  return count;
}

const cases = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 4, 422333],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
  ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 3, 89890],
];

let failed = 0;
for (const [fen, depth, expected] of cases) {
  const pos = new Position(fen);
  const t = Date.now();
  const got = perft(pos, depth);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} perft(${depth}) = ${got} (expected ${expected}) ${Date.now() - t}ms  ${fen}`);
}
if (failed) {
  console.error(`${failed} perft test(s) failed`);
  process.exit(1);
}
console.log('All perft tests passed.');
