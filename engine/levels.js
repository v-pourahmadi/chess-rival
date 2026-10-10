// levels.js — what "beginner", "medium" and "hard" actually mean.
//
// All three levels use exactly the same rules (board.js), the same judgement
// (evaluate.js) and the same search (search.js). Difficulty only changes these
// few knobs:
//
//   depth          How many moves ahead to look (1 = only its own move,
//                  2 = its move and your reply, 3 = its move, your reply, its
//                  next move, ...). This is by far the biggest factor.
//   timeLimitMs    Stop deepening after this much thinking time.
//   quiescence     At the end of the look-ahead, keep following captures until
//                  things calm down, so it doesn't stop counting in the middle
//                  of a trade ("I win a knight!" ... missing that you take back).
//   moveOrdering   Try the most promising moves first. This makes alpha-beta
//                  pruning skip far more work, so it can search deeper in time.
//   randomness     Add up to +/- this many centipawns of random noise to each
//                  candidate move's score before choosing (100 = one pawn).
//                  Makes the engine pick slightly worse moves and vary its play.
//   blunderChance  Probability of ignoring the search and playing a random
//                  legal move instead.

export const LEVELS = {
  beginner: {
    label: 'Beginner',
    depth: 1,
    timeLimitMs: 1000,
    quiescence: false,
    moveOrdering: false,
    randomness: 150,
    blunderChance: 0.15,
    summary:
      'Looks only at its own move, never at your reply, so it walks into simple captures. ' +
      'Adds a lot of random noise and sometimes just plays a random move.',
  },
  medium: {
    label: 'Medium',
    depth: 3,
    timeLimitMs: 2000,
    quiescence: true,
    moveOrdering: true,
    randomness: 30,
    blunderChance: 0,
    summary:
      'Looks 3 moves ahead (its move, your reply, its next move) and finishes off trades. ' +
      'A little random noise keeps it from always playing the same way.',
  },
  hard: {
    label: 'Hard',
    depth: 8,
    timeLimitMs: 3000,
    quiescence: true,
    moveOrdering: true,
    randomness: 0,
    blunderChance: 0,
    summary:
      'Searches as deep as it can in about 3 seconds (usually 5 to 7 moves ahead on a computer, a bit less on a phone), ' +
      'finishes off trades, and always plays the move it thinks is best.',
  },
};
