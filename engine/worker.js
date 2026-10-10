// worker.js — runs the engine in a background thread (a Web Worker) so the
// page stays responsive while the engine thinks.
//
// The page sends:   { id, fen, level: 'beginner' | 'medium' | 'hard' }
// The worker sends: { id, result }   (see findBestMove() in search.js)
import { Position } from './board.js';
import { findBestMove } from './search.js';
import { LEVELS } from './levels.js';

self.onmessage = (event) => {
  const { id, fen, level } = event.data;
  const result = findBestMove(new Position(fen), LEVELS[level]);
  self.postMessage({ id, result });
};
