// app.js — the game page: draws the board, handles taps and clicks, and asks
// the engine (running in engine/worker.js) for the rival's moves.
//
// The page uses the chess.js library to keep track of the game (legal moves,
// move names like "Nf3", checkmate and draw rules). The engine has its own,
// faster copy of the rules in engine/board.js.

import { Chess } from './vendor/chess.js';
import { LEVELS } from './engine/levels.js';
import { MATE, isMateScore } from './engine/search.js';

const PIECE_GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT_STYLE = '︎'; // ask phones to draw the glyph as text, not as an emoji
const STORAGE_KEY = 'chess-rival-v1';

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const statusEl = $('status');

let game = new Chess();
let playerColor = 'w';
let level = 'medium';
let selected = null; // square the player has picked up a piece from
let engineInfo = null; // details of the rival's last move, for the side panel
let thinking = false;
let requestId = 0;
let worker = null;

// ---------------------------------------------------------------------------
// Engine (Web Worker)

function startWorker() {
  worker = new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onEngineReply;
  worker.onerror = (e) => {
    thinking = false;
    setStatus(`The rival crashed: ${e.message || 'unknown error'}. Try "New game".`);
  };
}

function stopThinking() {
  if (!thinking) return;
  worker.terminate(); // the only way to interrupt a running search
  startWorker();
  thinking = false;
}

function askEngine() {
  if (game.isGameOver() || game.turn() === playerColor) return;
  thinking = true;
  const id = ++requestId;
  const fen = game.fen();
  worker.postMessage({ id, fen, level });
  worker.lastRequest = { id, fen, level };
  updateStatus();
}

function onEngineReply({ data }) {
  const request = worker.lastRequest;
  if (!request || data.id !== requestId) return; // an outdated answer
  thinking = false;
  const { result } = data;
  const uci = result.move;
  game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  engineInfo = { result, fen: request.fen, level: request.level };
  save();
  render();
}

// ---------------------------------------------------------------------------
// Board

function squareAt(row, col) {
  // Row 0 is the top of the screen. The player's pieces are always at the bottom.
  const file = playerColor === 'w' ? col : 7 - col;
  const rank = playerColor === 'w' ? 7 - row : row;
  return 'abcdefgh'[file] + (rank + 1);
}

function renderBoard() {
  const last = game.history({ verbose: true }).at(-1);
  const targets = selected ? game.moves({ square: selected, verbose: true }) : [];
  const checkSquare = game.inCheck() ? findKing(game.turn()) : null;

  const frag = document.createDocumentFragment();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = squareAt(row, col);
      const el = document.createElement('div');
      const isLight = (sq.charCodeAt(0) - 97 + Number(sq[1])) % 2 === 0;
      el.className = `sq ${isLight ? 'light' : 'dark'}`;
      el.dataset.square = sq;
      if (last && (last.from === sq || last.to === sq)) el.classList.add('last');
      if (sq === selected) el.classList.add('selected');
      if (sq === checkSquare) el.classList.add('check');
      const target = targets.find((m) => m.to === sq);
      if (target) el.classList.add('target', ...(target.captured ? ['capture'] : []));

      const piece = game.get(sq);
      if (piece) {
        const p = document.createElement('span');
        p.className = `piece ${piece.color}`;
        p.textContent = PIECE_GLYPHS[piece.type] + TEXT_STYLE;
        el.appendChild(p);
      }
      if (col === 0) el.insertAdjacentHTML('beforeend', `<span class="coord rank">${sq[1]}</span>`);
      if (row === 7) el.insertAdjacentHTML('beforeend', `<span class="coord file">${sq[0]}</span>`);
      frag.appendChild(el);
    }
  }
  boardEl.replaceChildren(frag);
}

function findKing(color) {
  for (const row of game.board()) {
    for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  }
  return null;
}

boardEl.addEventListener('click', (e) => {
  const sqEl = e.target.closest('.sq');
  if (!sqEl || thinking || game.isGameOver() || game.turn() !== playerColor) return;
  const sq = sqEl.dataset.square;

  if (selected) {
    const moves = game.moves({ square: selected, verbose: true }).filter((m) => m.to === sq);
    if (moves.length) {
      if (moves.some((m) => m.promotion)) {
        choosePromotion(selected, sq);
      } else {
        playerMove(selected, sq);
      }
      return;
    }
  }
  const piece = game.get(sq);
  selected = piece && piece.color === playerColor && sq !== selected ? sq : null;
  renderBoard();
});

function playerMove(from, to, promotion) {
  selected = null;
  game.move({ from, to, promotion });
  save();
  render();
  // A short pause so the player sees their own move before the rival replies.
  setTimeout(askEngine, 150);
}

function choosePromotion(from, to) {
  const dialog = $('promotion');
  const choices = $('promotion-choices');
  choices.replaceChildren(...['q', 'r', 'b', 'n'].map((type) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = PIECE_GLYPHS[type] + TEXT_STYLE;
    b.setAttribute('aria-label', { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[type]);
    b.onclick = () => {
      dialog.close();
      playerMove(from, to, type);
    };
    return b;
  }));
  dialog.showModal();
}

// ---------------------------------------------------------------------------
// Status, move list and the "what the rival was thinking" panel

function setStatus(text, busy = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('thinking', busy);
}

function updateStatus() {
  const you = game.turn() === playerColor;
  if (game.isCheckmate()) {
    setStatus(you ? 'Checkmate. The rival wins.' : 'Checkmate. You win! 🎉');
  } else if (game.isStalemate()) {
    setStatus('Draw by stalemate.');
  } else if (game.isThreefoldRepetition()) {
    setStatus('Draw by threefold repetition.');
  } else if (game.isInsufficientMaterial()) {
    setStatus('Draw: not enough pieces left to checkmate.');
  } else if (game.isDraw()) {
    setStatus('Draw by the 50-move rule.');
  } else if (thinking) {
    setStatus(`Rival (${LEVELS[level].label}) is thinking…`, true);
  } else {
    setStatus(you ? (game.inCheck() ? 'Check! Your move.' : 'Your move.') : 'Rival to move.');
  }
}

function renderMoves() {
  const history = game.history();
  const items = [];
  for (let i = 0; i < history.length; i += 2) {
    items.push(`<li><span>${history[i]}</span><span>${history[i + 1] || ''}</span></li>`);
  }
  const list = $('moves');
  list.innerHTML = items.join('');
  list.scrollTop = list.scrollHeight;
}

// Engine scores are in centipawns from the rival's point of view.
function describeScore(score) {
  if (isMateScore(score)) {
    const moves = Math.ceil((MATE - Math.abs(score)) / 2);
    return score > 0 ? `it can force checkmate in ${moves}` : `it expects to be checkmated in ${moves}`;
  }
  const pawns = (Math.abs(score) / 100).toFixed(2);
  if (Math.abs(score) < 20) return 'roughly equal';
  return score > 0 ? `the rival is ahead by ${pawns} pawns` : `you are ahead by ${pawns} pawns`;
}

function formatScore(score) {
  if (isMateScore(score)) {
    const moves = Math.ceil((MATE - Math.abs(score)) / 2);
    return score > 0 ? `mate in ${moves}` : `mated in ${moves}`;
  }
  return (score > 0 ? '+' : '') + (score / 100).toFixed(2);
}

// Turn engine notation ("g1f3") into the usual move names ("Nf3").
function uciLineToSan(fen, uciMoves) {
  const board = new Chess(fen);
  const names = [];
  for (const uci of uciMoves) {
    try {
      names.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return names;
}

function renderEngineInfo() {
  const box = $('engine-info');
  if (!engineInfo) return;
  const { result, fen, level: lvl } = engineInfo;
  const settings = LEVELS[lvl];
  const sanOf = (uci) => uciLineToSan(fen, [uci])[0];
  const played = sanOf(result.move);
  const best = sanOf(result.bestMove);
  const line = uciLineToSan(fen, result.pv);
  const seconds = (result.timeMs / 1000).toFixed(1);

  let html = `
    <p><strong>${settings.label}</strong> looked <strong>${result.depth}</strong> move${result.depth === 1 ? '' : 's'} ahead
      ${settings.quiescence ? '(plus captures until things calmed down)' : ''}
      and examined <strong>${result.nodes.toLocaleString()}</strong> positions in ${seconds} s.</p>
    <p>Its verdict: ${describeScore(result.bestScore)} (score ${formatScore(result.bestScore)}).</p>`;

  if (line.length > 1) {
    html += `<p>The line it expected: <span class="line">${line.join(' ')}</span></p>`;
  }

  if (result.reason === 'noise') {
    html += `<p>It played <strong>${played}</strong>, although its search liked <strong>${best}</strong> best.
      This level adds up to ±${settings.randomness / 100} pawns of random noise to every score, and that tipped the choice.</p>`;
  } else if (result.reason === 'random') {
    html += `<p>It played <strong>${played}</strong> at random, ignoring its search (which preferred <strong>${best}</strong>).
      Beginner does this ${Math.round(settings.blunderChance * 100)}% of the time.</p>`;
  } else {
    html += `<p>It played the move its search rated best: <strong>${played}</strong>.</p>`;
  }

  if (result.candidates.length > 1) {
    const shown = result.candidates.slice(0, 8);
    const chosen = result.candidates.find((c) => c.move === result.move);
    if (chosen && !shown.includes(chosen)) shown.push(chosen);
    const rows = shown.map((c) => `
      <tr class="${c.move === result.move ? 'chosen' : ''}">
        <td>${sanOf(c.move)}</td>
        <td class="num">${formatScore(c.score)}</td>
        <td class="num">${c.noisyScore === undefined ? '' : formatScore(Math.round(c.noisyScore))}</td>
      </tr>`).join('');
    html += `
      <table>
        <thead><tr><th>Candidate</th><th class="num">Score</th><th class="num">With noise</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small">Scores are from the rival's side, in pawns. Showing the top ${Math.min(8, result.candidates.length)} of ${result.candidates.length} legal moves${shown.length > 8 ? ', plus the one it played' : ''}.</p>`;
  }
  box.innerHTML = html;
}

function renderControls() {
  for (const b of document.querySelectorAll('#levels button')) {
    b.setAttribute('aria-checked', String(b.dataset.level === level));
  }
  for (const b of document.querySelectorAll('#colors button')) {
    b.setAttribute('aria-checked', String(b.dataset.color === playerColor));
  }
  $('level-summary').textContent = LEVELS[level].summary;
  $('undo').disabled = game.history().length === 0;
}

function render() {
  renderBoard();
  renderMoves();
  renderEngineInfo();
  renderControls();
  updateStatus();
}

// ---------------------------------------------------------------------------
// Buttons

function newGame() {
  stopThinking();
  game = new Chess();
  selected = null;
  engineInfo = null;
  $('engine-info').innerHTML = '<p class="muted">Waiting for the rival\'s first move.</p>';
  save();
  render();
  askEngine(); // if the player chose Black, the rival opens
}

$('new-game').onclick = newGame;

$('undo').onclick = () => {
  if (game.history().length === 0) return;
  stopThinking();
  selected = null;
  game.undo();
  // Keep taking back until it is the player's turn again.
  while (game.turn() !== playerColor && game.history().length) game.undo();
  engineInfo = null;
  save();
  render();
  askEngine();
};

$('levels').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  level = b.dataset.level;
  save();
  renderControls();
  updateStatus();
};

$('colors').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.color === playerColor) return;
  playerColor = b.dataset.color;
  newGame();
};

// ---------------------------------------------------------------------------
// Remember the game between visits (only in this browser).

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pgn: game.pgn(), playerColor, level }));
  } catch {
    // Private browsing or storage disabled: just don't remember.
  }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (saved.playerColor === 'w' || saved.playerColor === 'b') playerColor = saved.playerColor;
    if (LEVELS[saved.level]) level = saved.level;
    if (saved.pgn) game.loadPgn(saved.pgn);
  } catch {
    game = new Chess();
  }
}

restore();
startWorker();
render();
askEngine();
