/* ============================================================
   Aqua's games — pure logic (no DOM) so it's unit-testable.
   Starts with tic-tac-toe: board state, winner detection,
   spoken/typed move parsing, and a minimax AI with difficulty.
   ============================================================ */

"use strict";

(function (global) {
  /* 0 1 2
     3 4 5
     6 7 8 */
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],   // columns
    [0, 4, 8], [2, 4, 6],              // diagonals
  ];

  function opponent(player) {
    return player === "X" ? "O" : "X";
  }

  function winner(board) {
    for (const [a, b, c] of LINES) {
      if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return null;
  }

  function isFull(board) {
    return board.every((c) => !!c);
  }

  function emptyCells(board) {
    const out = [];
    for (let i = 0; i < 9; i++) if (!board[i]) out.push(i);
    return out;
  }

  /* Turn "top left", "center", "b2", "row 2 column 3", or "9" into a 0-8 index. */
  function parseMove(text) {
    const t = String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/).filter(Boolean).join(" ");
    if (!t) return null;

    // chess-style coords: a1, b2, c3 (letter first or last)
    let m = /^([abc])\s?([123])$/.exec(t);
    if (m) return (parseInt(m[2], 10) - 1) * 3 + (m[1].charCodeAt(0) - 97);
    m = /^([123])\s?([abc])$/.exec(t);
    if (m) return (parseInt(m[1], 10) - 1) * 3 + (m[2].charCodeAt(0) - 97);

    // "row 2 column 3" / "row two col one"
    m = /^row\s*(one|two|three|[123])\s*(?:col(?:umn)?)?\s*(one|two|three|[123])$/.exec(t);
    if (m) {
      const n = (w) => ({ one: 1, two: 2, three: 3 }[w] || parseInt(w, 10));
      return (n(m[1]) - 1) * 3 + (n(m[2]) - 1);
    }

    // phone-style 1-9
    if (/^[1-9]$/.test(t)) return parseInt(t, 10) - 1;

    // "center" / "middle" alone = the middle square
    if (/^(middle|center|centre)$/.test(t)) return 4;

    const ROW_EDGE = { top: 0, upper: 0, bottom: 2, lower: 2 };
    const COL_EDGE = { left: 0, right: 2 };

    let row = null, col = null, mids = 0;
    for (const w of t.split(" ")) {
      if (Object.prototype.hasOwnProperty.call(ROW_EDGE, w)) {
        if (row === null) row = ROW_EDGE[w];
      } else if (Object.prototype.hasOwnProperty.call(COL_EDGE, w)) {
        if (col === null) col = COL_EDGE[w];
      } else if (/^(middle|center|centre)$/.test(w)) {
        mids++;
      }
    }
    // "middle"/"center" fills whichever axis is still unknown.
    if (mids >= 1) {
      if (row === null && col === null) { row = 1; col = 1; }
      else if (row === null) row = 1;
      else if (col === null) col = 1;
    }
    if (row === null || col === null) return null;
    return row * 3 + col;
  }

  /* Minimax — the AI prefers quick wins and delays losses. */
  function minimax(board, ai, current, depth) {
    const w = winner(board);
    if (w) return w === ai ? 10 - depth : depth - 10;
    if (isFull(board)) return 0;

    const moves = emptyCells(board);
    if (current === ai) {
      let best = -Infinity;
      for (const i of moves) {
        board[i] = current;
        best = Math.max(best, minimax(board, ai, opponent(current), depth + 1));
        board[i] = null;
      }
      return best;
    }
    let best = Infinity;
    for (const i of moves) {
      board[i] = current;
      best = Math.min(best, minimax(board, ai, opponent(current), depth + 1));
      board[i] = null;
    }
    return best;
  }

  /* Pick a move for `ai`. hard = perfect; medium/easy take some bad moves. */
  function bestMove(board, ai, difficulty = "medium") {
    const moves = emptyCells(board);
    if (!moves.length) return -1;

    const r = Math.random();
    const playBest =
      difficulty === "hard" ||
      (difficulty === "medium" ? r < 0.7 : r < 0.3);

    if (playBest) {
      let bestScore = -Infinity;
      let best = [];
      for (const i of moves) {
        board[i] = ai;
        const score = minimax(board, ai, opponent(ai), 1);
        board[i] = null;
        if (score > bestScore) { bestScore = score; best = [i]; }
        else if (score === bestScore) best.push(i);
      }
      return best[Math.floor(Math.random() * best.length)];
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  const TicTacToe = { LINES, opponent, winner, isFull, emptyCells, parseMove, bestMove };
  global.TicTacToe = TicTacToe;
  if (typeof module !== "undefined" && module.exports) module.exports = TicTacToe;
})(typeof window !== "undefined" ? window : globalThis);
