# How the rival thinks

There is no neural network in this engine and no learning. It finds its moves
with a method worked out in the 1950s: **look ahead through possible moves, score
the positions at the end with a hand-written formula, and assume both players
always pick their best option.** Deep Blue used the same idea when it beat world
champion Garry Kasparov in 1997, just on special hardware that checked about 200
million positions per second.

The whole engine is four short files in [`engine/`](engine/). This guide walks
through them in the order the engine uses them.

| File | Question it answers |
|---|---|
| [`board.js`](engine/board.js) | What are the rules? Which moves are possible here? |
| [`evaluate.js`](engine/evaluate.js) | How good is this position, as a single number? |
| [`search.js`](engine/search.js) | Which move leads to the best position, if both sides play well? |
| [`levels.js`](engine/levels.js) | What makes Beginner weaker than Hard? |

---

## 1. The rules (`board.js`)

The engine keeps its own copy of the board, because it needs to try hundreds of
thousands of moves per second. The game page uses the friendlier chess.js
library, which is more than 100 times slower (measured).

* `generateMoves()` lists every move the pieces could make.
* `makeMove()` plays a move on the board and returns `false` if it would leave
  your own king in check, which makes it illegal. `unmakeMove()` takes it back.

The search plays a move, looks deeper, takes it back, and tries the next move,
millions of times.

`tests/perft.test.js` checks the rules. It counts every possible move sequence
from tricky positions and compares the totals with numbers the chess-programming
community has verified (197,281 sequences of 4 moves from the starting
position, for example). If castling, en passant or promotion had a bug, the
counts would not match.

## 2. Judging a position (`evaluate.js`)

At the end of each line it looks at, the engine has to say how good the position
is without looking further. It adds up two things.

**Material.** Pawn = 100, knight = 320, bishop = 330, rook = 500,
queen = 900. The unit is the *centipawn* (1/100 of a pawn), so +250 means
"two and a half pawns better".

**Piece placement.** Each piece type has a table of 64 bonuses, one per square:

```
Knight table (from White's side; top row is rank 8)
-50 -40 -30 -30 -30 -30 -40 -50
-40 -20   0   0   0   0 -20 -40
-30   0  10  15  15  10   0 -30
-30   5  15  20  20  15   5 -30      <- a knight in the center
-30   0  15  20  20  15   0 -30         controls more squares: +20
-30   5  10  15  15  10   5 -30
-40 -20   0   5   5   0 -20 -40
-50 -40 -30 -30 -30 -30 -40 -50      <- a knight in the corner: -50
```

These tables put basic chess advice into numbers: put knights in the center,
advance pawns, keep the king tucked away early and bring it out in the endgame.
A person chose every number. Nothing was learned from games.

One more helper, *mop-up*, kicks in when one side is well ahead in an endgame.
It rewards pushing the enemy king toward the edge, so the engine can actually
finish off a lone king instead of drifting around.

That is the engine's whole "chess knowledge". Everything else comes from
looking ahead.

## 3. Looking ahead (`search.js`)

### Minimax

Imagine every possible move as a branch, every reply as a smaller branch, and so
on: a *game tree*. The engine:

1. Grows the tree to a fixed **depth** (e.g. 3 = its move, your reply, its next move).
2. Scores every position at the tips with `evaluate()`.
3. Works back up. On its own turn it picks the **max**imum score. On your turn it
   assumes you pick the **min**imum, the reply that is worst for it.

That's *minimax*. It never hopes you'll blunder. It assumes you'll find your best
reply and picks the move whose worst case is best.

In the code this is `negamax()`, a common shortcut. Scores are always from
the point of view of the side to move, so "your best" is simply minus "my best"
and one function handles both players.

### Alpha-beta pruning: same answer, a fraction of the work

Suppose the engine already knows move A guarantees it at least +1. Now it looks
at move B and sees that your first reply to B leaves it at -3. It doesn't need to
check your other replies to B: you'd play *at least* that well, so B is already
worse than A. The engine skips the rest of B.

That's *alpha-beta pruning*. `alpha` is the score we're already guaranteed, and
`beta` is the most the opponent will allow. When a move reaches `beta`, the
loop `break`s. That's the "cutoff". It gives exactly the same result as plain
minimax.

Measured on a middlegame position with this engine:

| Depth | Plain minimax | Alpha-beta | Alpha-beta + good move ordering |
|---|---|---|---|
| 2 | 1,295 positions | 150 | 146 |
| 3 | 47,626 | 3,468 | 2,012 |
| 4 | 1,682,926 | 106,157 | **17,119** |

Each extra level multiplies the tree by about 35 (the number of moves in a
typical position), so pruning is what makes deeper search possible at all.

### Move ordering

Pruning works best when the best move is tried first. The engine can't know which
move that is, so it guesses (`orderMoves()`):

* captures first, especially **big piece taken by small piece** (pawn takes queen),
* then promotions,
* then "killer moves", quiet moves that caused a cutoff elsewhere at the same depth.

In the table above, ordering cut the work at depth 4 by another factor of 6.

### Iterative deepening

The Hard level doesn't jump straight to depth 7. It searches depth 1, then 2,
then 3, and so on, until its ~3 seconds are up. It keeps the answer from the last
depth it finished. That sounds wasteful but costs little: each depth starts with
the previous best move, which makes pruning very effective.

### Quiescence search: don't stop in the middle of a fight

Stop a search after "I take your queen" and it scores +9, even though you take
back on the next move. This mistake is called the *horizon effect*. So, at the
end of the normal search, `quiesce()` keeps following **captures only** until no
captures remain, and scores the position only once it's quiet.

## 4. What the difficulty levels change (`levels.js`)

All three levels share the same rules, the same evaluation and the same search.
They differ in a few settings:

| Setting | Beginner | Medium | Hard |
|---|---|---|---|
| Look-ahead depth | 1 (its own move only) | 3 | up to 8, about 3 s worth |
| Quiescence (finish trades) | no | yes | yes |
| Move ordering | no | yes | yes |
| Random noise on scores | ±1.5 pawns | ±0.3 pawns | none |
| Plays a random move | 15% of the time | never | never |

What this looks like in play:

* **Beginner** never considers your reply. It sees "I can take a pawn" but not
  "and then you take my queen". `tests/engine.test.js` checks this: it grabs a
  defended pawn with its queen, while Medium and Hard don't. The large noise
  means it often doesn't even play the move it rated best, and sometimes it plays
  a random move.
* **Medium** sees short tactics (forks, simple traps) and finishes trades
  correctly. The small amount of noise makes it vary between moves that are
  about equal, so games don't repeat.
* **Hard** always plays what it believes is the best move and sees several moves
  deeper. Each extra move of depth adds a lot of strength.

The game page's **"What the rival was thinking"** panel shows this for every
move: how deep it looked, how many positions it checked, the line of play it
expects, and on Beginner and Medium the score of each candidate move before
and after the noise.

### Try it yourself

* Make Hard stronger or weaker: change `timeLimitMs` or `depth` in `levels.js`.
* Make Medium more random: raise `randomness`.
* Give the engine a different style: edit a table in `evaluate.js`, e.g. make
  the pawn table reward advancing pawns more.
* Turn off quiescence for Medium and watch it start losing pieces in trades.

## 5. Where this sits in history

| Year | Milestone | Method |
|---|---|---|
| 1948–50 | Alan Turing and David Champernowne write *Turochamp*, a chess program run by hand on paper | 2-move look-ahead with a hand-made score |
| 1950 | Claude Shannon publishes *Programming a Computer for Playing Chess* | Proposes exactly this: minimax + an evaluation function |
| 1950s–70s | Alpha-beta pruning developed (McCarthy, Newell & Simon, others); Knuth & Moore analyse it in 1975 | Same answer as minimax, far fewer positions |
| 1997 | **Deep Blue beats Kasparov** | Alpha-beta on custom chips, ~200 million positions/s, a hand-tuned evaluation |
| 2008– | **Stockfish**, the strongest free engine | Alpha-beta with many refinements and a hand-tuned evaluation |
| 2017 | **AlphaZero** (DeepMind) | A neural network plus Monte-Carlo tree search, learned entirely by playing itself |
| 2020 | Stockfish 12 adds **NNUE** | A small neural network *replaces only the evaluation*; the search is still alpha-beta |

So, to answer "is it a neural network deciding?": for this engine, and for every
strong engine before about 2017, no. They are search engines, and their "intuition" is
a formula a person wrote. Today the strongest engines combine both approaches:
Stockfish still searches with alpha-beta, but a small neural network now scores
the positions at the end of each line, the job `evaluate.js` does here.

## 6. What this engine leaves out

Compared with a serious engine, this one skips features that would make it
stronger but harder to read:

* **Transposition table.** Remembering positions already searched (the same
  position can be reached by different move orders).
* **Repetition detection inside the search.** The game page does detect
  threefold repetition, but the engine doesn't plan around it.
* **Opening book and endgame tables.** Pre-computed best moves for the start
  and the very end of the game.
* **Smarter pruning** (null-move pruning, late-move reductions) and a richer
  evaluation (pawn structure, king safety, mobility).

Each one is a good next step if you want to experiment.
