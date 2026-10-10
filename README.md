# Chess Rival

Play chess in your browser (desktop or phone) against a computer rival with
three levels: **Beginner**, **Medium** and **Hard**.

**Play:** https://v-pourahmadi.github.io/chess-rival/

The rival is a small, classic chess engine written to be read. There is no
neural network: it looks ahead with minimax and alpha-beta pruning and judges
positions with a hand-written formula. The method dates back to Claude Shannon
(1950) and Deep Blue (1997).

📖 **[How the rival thinks](HOW-THE-ENGINE-WORKS.md)** explains how it picks moves
and what each difficulty level changes.

## Project layout

```
index.html, style.css, app.js   the game page (board, buttons, "what the rival was thinking" panel)
engine/board.js                 chess rules: board, move generation, make/unmake move
engine/evaluate.js              scoring a position: material + piece-square tables
engine/search.js                minimax / alpha-beta, quiescence, move ordering, iterative deepening
engine/levels.js                the settings behind Beginner, Medium and Hard
engine/worker.js                runs the engine in the background so the page stays smooth
vendor/chess.js                 chess.js 1.0.0 (BSD-2-Clause), used by the page for game rules and move names
tests/                          rule tests (perft) and engine behaviour tests
```

## Run it locally

It's a static site with no build step. Serve the folder with any web server
(browsers block the engine's background worker when you open the file directly):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the tests (Node 18+):

```sh
npm test
```
