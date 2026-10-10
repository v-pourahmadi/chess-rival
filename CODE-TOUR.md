# A guided tour of the rival's "brain"

This guide shows **where to look** in the code and **in what order**. To learn
*why* the method works (minimax, alpha-beta, the history), read
[HOW-THE-ENGINE-WORKS.md](HOW-THE-ENGINE-WORKS.md). This file is the map; that
one is the textbook.

---

## Where to look

**1. In the game itself.** After each of the rival's moves, open the
**"What the rival was thinking"** panel (on a phone, scroll down under the
board). It shows, live:

* how many moves ahead it looked (its *depth*),
* how many positions it checked,
* its verdict on the position, in pawns,
* the line of play it expects ("I play this, you reply that, then I..."),
* on Beginner and Medium, a table of candidate moves with their real score and
  their score **after random noise**. The highlighted row is the move it
  actually played.

Try the same position on Beginner and on Hard and compare the panels. That
shows you the effect of difficulty without reading any code.

**2. In the code, on GitHub.** Open https://github.com/v-pourahmadi/chess-rival
and click into the [`engine/`](engine/) folder. That folder is the entire
brain: four short files. The links in this guide jump straight to the
right lines. On a phone, GitHub's site works fine for reading; turn the phone
sideways for longer lines.

The rest of the repo is the game page (`index.html`, `style.css`, `app.js`),
which draws the board and asks the brain for moves. It contains no chess
thinking.

---

## Follow one move from start to finish

Here is exactly what happens between you making a move and the rival
answering. Read the stops in order.

### Stop 1: the page asks for a move. [`app.js`, `askEngine()`](app.js#L48)

```js
worker.postMessage({ id, fen, level });
```

The page sends two things: the current position as a line of text (a *FEN*,
e.g. `rnbqkbnr/pppppppp/8/...`) and the level name (`'beginner'`, `'medium'`
or `'hard'`). It sends them to a background worker, so the page doesn't
freeze while the rival thinks.

### Stop 2: the worker starts the engine. [`engine/worker.js`](engine/worker.js#L12)

```js
const result = findBestMove(new Position(fen), LEVELS[level]);
```

One line: build the engine's own board from the FEN, look up the settings for
the level, and search.

### Stop 3: the settings for each level. [`engine/levels.js`](engine/levels.js#L22)

```js
beginner: { depth: 1, quiescence: false, moveOrdering: false, randomness: 150, blunderChance: 0.15 },
medium:   { depth: 3, quiescence: true,  moveOrdering: true,  randomness: 30,  blunderChance: 0 },
hard:     { depth: 8, quiescence: true,  moveOrdering: true,  randomness: 0,   blunderChance: 0, timeLimitMs: 3000 },
```

(Simplified. The real file has a comment explaining every knob.) **This is
the only place the levels differ.** Everything below is shared by all three.

### Stop 4: the search's main loop. [`engine/search.js`, `run()`](engine/search.js#L187)

`run()` does three things:

1. **Lists the legal moves** it could play right now.
2. **Thinks deeper and deeper** ([line 209](engine/search.js#L209)): first 1
   move ahead, then 2, then 3... up to the level's `depth`, or until time runs
   out. It keeps the answer from the deepest search it finished.
3. **Chooses a move** ([lines 226–246](engine/search.js#L226-L246)). Hard
   simply takes the best one. Beginner and Medium add random noise to each
   move's score first and take the highest *noisy* score. Beginner also
   sometimes plays a completely random move:

   ```js
   entry.noisyScore = entry.score + (this.random() * 2 - 1) * this.level.randomness;
   ...
   if (this.random() < this.level.blunderChance) { /* play a random move */ }
   ```

### Stop 5: trying each of its moves. [`searchRoot()`](engine/search.js#L167)

For each move it can play now: make the move on its board, ask
`negamax()` how good the result is (from *your* point of view, so it flips
the sign), then take the move back.

### Stop 6: the heart of it. [`negamax()`](engine/search.js#L93)

This ~40-line function **is** the brain. Read it slowly:

```js
negamax(depth, alpha, beta, ply) {
  if (depth <= 0) {                        // looked far enough ahead:
    return this.level.quiescence           //   finish off any captures first (Stop 7),
      ? this.quiesce(alpha, beta, ply)     //   then judge the position (Stop 8)
      : this.leaf();
  }
  for (const move of moves) {              // try every move...
    if (!this.pos.makeMove(move)) continue;    // (skip illegal ones)
    const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);  // ...and see how the OTHER side does
    this.pos.unmakeMove();
    if (score > alpha) alpha = score;      // best found so far
    if (alpha >= beta) break;              // ALPHA-BETA PRUNING: the opponent won't allow this line, stop looking
  }
  if (no legal moves) return inCheck ? -MATE : 0;   // checkmate or stalemate
  return best;
}
```

Three things to notice:

* **It calls itself.** My move → your reply → my next move → ... Each call
  goes one move deeper until `depth` reaches 0. This is how it "looks ahead".
* **The minus sign** in `-this.negamax(...)`. What's good for you is bad for
  it, so it flips your best score to get its own. That single minus is
  minimax: it assumes you always find your best reply.
* **`break`** is alpha-beta pruning. Once a line is clearly worse than
  something it already found, it stops checking the rest of that line. Same
  answer, a tiny fraction of the work.

### Stop 7: don't stop mid-fight. [`quiesce()`](engine/search.js#L143)

When the look-ahead ends, it keeps following **captures only** until none
are left. Otherwise it might stop right after "I take your queen" and miss
that you take back. Beginner has this switched off
(`quiescence: false`). That's a big reason it walks into simple traps.

### Stop 8: judging a position. [`engine/evaluate.js`](engine/evaluate.js#L125)

At the end of every line, the position gets a score in **centipawns**
(100 = one pawn; positive = good for the side to move). It is just a sum:

* **Material** ([line 25](engine/evaluate.js#L25)): pawn 100, knight 320,
  bishop 330, rook 500, queen 900.
* **Placement**: a 64-square table of bonuses per piece type, e.g. the
  [knight table](engine/evaluate.js#L41) gives +20 for the center and -50
  for a corner.
* **King safety vs. king activity** ([line 143](engine/evaluate.js#L143)):
  the king prefers to hide early on and to come forward once most pieces are
  gone.
* **Mop-up** ([line 154](engine/evaluate.js#L154)): when well ahead in an
  endgame, push the enemy king to the edge to make checkmate possible.

**This is all the chess knowledge the engine has.** A person typed in every
number; nothing was learned. Everything clever it does comes from looking
ahead (Stops 4 to 7).

### Stop 9: the rules underneath. [`engine/board.js`](engine/board.js)

The search uses this file to ask "what moves are possible here?"
([`generateMoves()`](engine/board.js#L188)), to play a move
([`makeMove()`](engine/board.js#L312)) and to take it back
([`unmakeMove()`](engine/board.js#L357)). It is plumbing: you don't need to
read it to understand the brain. Its own comments explain the clever board
layout ("0x88") if you're curious.

### Stop 10: back to the page. [`app.js`, `onEngineReply()`](app.js#L58)

The page plays the move on the board and fills in the "What the rival was
thinking" panel ([`renderEngineInfo()`](app.js#L239)) from the numbers the
search returned.

---

## Where each difficulty setting takes effect

| Setting (in `levels.js`) | Used in `search.js` | What it changes |
|---|---|---|
| `depth` | [line 209](engine/search.js#L209) | How many moves ahead it looks. The biggest factor by far. |
| `timeLimitMs` | [line 189](engine/search.js#L189) | When Hard stops deepening. |
| `quiescence` | [line 101](engine/search.js#L101) | Whether it finishes off trades before judging. |
| `moveOrdering` | [line 55](engine/search.js#L55) | Whether it tries promising moves first, which lets pruning skip more and search deeper in the same time. |
| `randomness` | [line 233](engine/search.js#L233) | How much noise it adds to scores before choosing. |
| `blunderChance` | [line 241](engine/search.js#L241) | How often it ignores its search and plays a random move. |

---

## Experiments you can do right on GitHub

No software to install: open a file on GitHub, tap the **pencil icon (Edit)**,
change a number, and press **Commit changes**. About a minute later the live
game at https://v-pourahmadi.github.io/chess-rival/ uses your change. (Reload
the page.)

1. **Make Hard think longer.** In `engine/levels.js`, change Hard's
   `timeLimitMs: 3000` to `10000`. The panel will show it reaching a greater
   depth and checking far more positions.
2. **Make Beginner less random.** Set Beginner's `randomness` to `0` and
   `blunderChance` to `0`. It now always plays its "best" move, but since it
   still looks only 1 move ahead it still falls for simple traps.
3. **Give Medium no foresight.** Set Medium's `depth` to `1`. It suddenly
   plays much worse. This is the clearest demonstration that depth is what
   strength comes from.
4. **Change its taste.** In `engine/evaluate.js`, change the knight's value
   from `320` to `200` in `PIECE_VALUES`. It will now give up its knights far
   more readily, for example trading one for a bishop. Its "personality" is just these numbers.

If an edit breaks the game (for example the rival never moves, or the page
stays blank), a typo slipped in. Undo your change on GitHub (open the file's **History** and revert, or just edit
the number back).

---

## Words you'll see in the code

| Word | Meaning |
|---|---|
| **depth** | How many moves (by either side) it looks ahead. |
| **ply** | One move by one side. "Depth 3" = 3 plies: its move, your reply, its move. |
| **node** | One position it examined. The panel's "positions checked" counts these. |
| **centipawn** | 1/100 of a pawn. Scores are in these: +150 = "1.5 pawns better". |
| **evaluation** | The score `evaluate.js` gives a position without looking ahead. |
| **minimax / negamax** | Choose the move that's best assuming the opponent always replies with *their* best. Negamax is the same idea written with one function and a minus sign. |
| **alpha / beta** | The best score each side is already sure of. Used to prune. |
| **cutoff / pruning** | Skipping moves that can't change the answer. |
| **quiescence** | Following captures until the position is quiet, before judging it. |
| **PV (principal variation)** | The line of best play it expects. The panel shows it as "The line it expected". |
| **iterative deepening** | Searching depth 1, then 2, then 3... and keeping the last finished answer. |
| **FEN** | A one-line text description of a position. |
| **UCI move** | Compact move notation used inside the engine: `e2e4`, `e7e8q` (promote to queen). |
