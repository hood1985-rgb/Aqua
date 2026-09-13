#!/usr/bin/env node
/* Tests Aqua's tic-tac-toe logic. Run: node tests/games.test.js */

"use strict";

const assert = require("assert");
const { winner, isFull, emptyCells, parseMove, bestMove, opponent } = require("../games.js");

// ---- winner detection ----
assert.strictEqual(winner(["X", "X", "X", null, "O", null, null, "O", null]), "X", "top row X");
assert.strictEqual(winner(["O", null, null, "O", "X", "X", "O", null, null]), "O", "left column O");
assert.strictEqual(winner(["X", "O", null, null, "X", "O", null, null, "X"]), "X", "diagonal X");
assert.strictEqual(winner([null, "O", "X", null, "X", "O", "X", null, "O"]), "X", "anti-diagonal X");
assert.strictEqual(winner(["X", "O", "X", "O", "O", "X", "X", "X", "O"]), null, "full board, no winner");
console.log("[ok] winner detection");

// ---- fullness ----
assert.strictEqual(isFull(["X", "O", "X", "O", "O", "X", "X", "X", "O"]), true);
assert.strictEqual(isFull(["X", "O", null, "O", "O", "X", "X", "X", "O"]), false);
assert.deepStrictEqual(emptyCells(["X", null, "O", null, "X", null, "O", null, "X"]), [1, 3, 5, 7]);
console.log("[ok] isFull / emptyCells");

// ---- opponent ----
assert.strictEqual(opponent("X"), "O");
assert.strictEqual(opponent("O"), "X");
console.log("[ok] opponent");

// ---- move parsing ----
const cases = [
  ["top left", 0],
  ["top middle", 1],
  ["top right", 2],
  ["middle left", 3],
  ["center", 4],
  ["middle right", 5],
  ["bottom left", 6],
  ["bottom middle", 7],
  ["bottom right", 8],
  ["upper right", 2],
  ["lower middle", 7],
  ["a1", 0],
  ["b2", 4],
  ["c3", 8],
  ["2b", 4],
  ["1", 0],
  ["9", 8],
  ["row 2 column 3", 5],
  ["row two col one", 3],
  ["  top   left  ", 0],
];
for (const [txt, idx] of cases) {
  assert.strictEqual(parseMove(txt), idx, `parseMove("${txt}") should be ${idx}`);
}
assert.strictEqual(parseMove("hello there"), null);
assert.strictEqual(parseMove("top"), null);
assert.strictEqual(parseMove(""), null);
assert.strictEqual(parseMove("tell me about the pool"), null);
console.log("[ok] parseMove:", cases.length, "cases");

// ---- AI: takes the win ----
let b = ["O", "O", null, "X", "X", null, null, null, null];
assert.strictEqual(bestMove(b, "O", "hard"), 2, "O should take the win");
b = ["O", null, null, "O", "X", "X", null, null, null];
assert.strictEqual(bestMove(b, "O", "hard"), 6, "O should take the column win");
console.log("[ok] AI takes an available win");

// ---- AI: blocks the opponent ----
b = ["X", "X", null, "O", null, null, null, null, null];
assert.strictEqual(bestMove(b, "O", "hard"), 2, "O must block the row");
b = ["X", null, null, null, null, null, "X", null, "O"];
assert.strictEqual(bestMove(b, "O", "hard"), 3, "O must block the column");
console.log("[ok] AI blocks a win");

// ---- AI: always legal, every difficulty ----
for (const diff of ["easy", "medium", "hard"]) {
  for (let t = 0; t < 30; t++) {
    const board = Array(9).fill(null);
    // scatter a few random pieces
    for (let i = 0; i < 5; i++) {
      const j = Math.floor(Math.random() * 9);
      if (!board[j]) board[j] = Math.random() < 0.5 ? "X" : "O";
    }
    const m = bestMove(board, "O", diff);
    if (emptyCells(board).length === 0) { assert.strictEqual(m, -1); continue; }
    assert.ok(m >= 0 && m < 9, "move in range");
    assert.ok(!board[m], "move must be on an empty cell");
  }
}
console.log("[ok] AI moves are legal across difficulties");

// ---- AI never loses a game it can win (perfect play sanity) ----
{
  let board = Array(9).fill(null);
  let turn = "X";
  // play AI (hard) vs a blundering player that always picks the first empty cell
  for (let n = 0; n < 9; n++) {
    if (winner(board) || isFull(board)) break;
    if (turn === "X") {
      const moves = emptyCells(board);
      board[moves[0]] = "X";          // naive player
    } else {
      const m = bestMove(board, "O", "hard");
      board[m] = "O";
    }
    turn = turn === "X" ? "O" : "X";
  }
  const w = winner(board);
  assert.ok(w !== "X", "hard AI should never lose to a naive player");
  console.log("[ok] hard AI never loses to a naive player (result: " + (w || "tie") + ")");
}

console.log("\nALL GAME CHECKS PASSED.");
