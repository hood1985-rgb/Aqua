#!/usr/bin/env node
/* Tests Aqua's tic-tac-toe logic. Run: node tests/games.test.js */

"use strict";

const assert = require("assert");
const games = require("../games.js");
const { winner, isFull, emptyCells, parseMove, bestMove, opponent } = games;
const { RPS, GuessNumber, Hangman, SchoolQuiz } = games;

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

// ---- rock-paper-scissors ----
assert.strictEqual(RPS.parse("rock"), "rock");
assert.strictEqual(RPS.parse("I choose Paper!"), "paper");
assert.strictEqual(RPS.parse("scissors"), "scissors");
assert.strictEqual(RPS.parse("✊"), "rock");
assert.strictEqual(RPS.parse("hello"), null);
assert.strictEqual(RPS.result("rock", "scissors"), "win");
assert.strictEqual(RPS.result("rock", "paper"), "lose");
assert.strictEqual(RPS.result("paper", "paper"), "tie");
assert.ok(RPS.MOVES.includes(RPS.randomMove()));
// every matchup resolves sanely
for (const a of RPS.MOVES) for (const b of RPS.MOVES) {
  assert.ok(["win", "lose", "tie"].includes(RPS.result(a, b)));
}
console.log("[ok] rock-paper-scissors");

// ---- guess the number ----
{
  const st = GuessNumber.newGame(1, 100, 42);
  assert.strictEqual(GuessNumber.guess(st, 10), "low");
  assert.strictEqual(GuessNumber.guess(st, 90), "high");
  assert.strictEqual(GuessNumber.guess(st, 42), "win");
  assert.strictEqual(st.attempts, 3);
  assert.strictEqual(st.over, true);
  assert.strictEqual(GuessNumber.parse("I guess 42"), 42);
  assert.strictEqual(GuessNumber.parse("no number here"), null);
  const r = GuessNumber.newGame(1, 10);
  assert.ok(r.target >= 1 && r.target <= 10);
}
console.log("[ok] guess the number");

// ---- word guess (hangman-lite) ----
{
  const st = Hangman.newGame("pool");
  let res = Hangman.guess(st, "o");
  assert.strictEqual(res.correct, true);
  assert.strictEqual(res.display, "_ o o _");
  res = Hangman.guess(st, "o");
  assert.strictEqual(res.already, true);
  res = Hangman.guess(st, "z");
  assert.strictEqual(res.correct, false);
  assert.strictEqual(res.missesLeft, 5);
  Hangman.guess(st, "p");
  res = Hangman.guess(st, "l");
  assert.strictEqual(res.won, true);
  assert.strictEqual(Hangman.parse("e"), "e");
  assert.strictEqual(Hangman.parse("letter e"), "e");
  assert.strictEqual(Hangman.parse("guess t"), "t");
  assert.strictEqual(Hangman.parse("hello"), null);
  assert.strictEqual(Hangman.parse("123"), null);
  const lose = Hangman.newGame("zz");
  for (const c of ["a", "b", "c", "d", "e", "f"]) Hangman.guess(lose, c);
  assert.strictEqual(lose.over, true);
  assert.strictEqual(lose.won, false);
}
console.log("[ok] word guess");

// ---- school quiz ----
{
  assert.ok(SchoolQuiz.BANK.length >= 20, "quiz bank has plenty of questions");
  const subjects = new Set(SchoolQuiz.BANK.map((q) => q.subject));
  for (const s of ["math", "science", "language arts", "history"]) {
    assert.ok(subjects.has(s), `bank covers ${s}`);
  }
  const m1 = SchoolQuiz.BANK.find((q) => q.id === "m1");
  assert.strictEqual(SchoolQuiz.check(m1, "12"), true);
  assert.strictEqual(SchoolQuiz.check(m1, "twelve"), true);
  assert.strictEqual(SchoolQuiz.check(m1, "The answer is 12!"), true);
  assert.strictEqual(SchoolQuiz.check(m1, "thirteen"), false);
  assert.strictEqual(SchoolQuiz.check(m1, ""), false);
  const h1 = SchoolQuiz.BANK.find((q) => q.id === "h1");
  assert.strictEqual(SchoolQuiz.check(h1, "George Washington"), true);
  const math = SchoolQuiz.makeMath();
  assert.ok(math.q && math.answers.length, "generated math has an answer");
  const picked = SchoolQuiz.pick(["m1", "m2"]);
  assert.ok(picked && picked.q, "pick returns a question");
}
console.log("[ok] school quiz");

console.log("\nALL GAME CHECKS PASSED.");
