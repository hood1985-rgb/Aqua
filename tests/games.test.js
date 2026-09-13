#!/usr/bin/env node
/* Tests Aqua's tic-tac-toe logic. Run: node tests/games.test.js */

"use strict";

const assert = require("assert");
const games = require("../games.js");
const { winner, isFull, emptyCells, parseMove, bestMove, opponent } = games;
const { RPS, GuessNumber, Hangman, SchoolQuiz, ConnectFour, Checkers, Chess } = games;

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

// ---- spelling quizzes ----
{
  const spelling = SchoolQuiz.BANK.filter((q) => q.subject === "spelling");
  assert.ok(spelling.length >= 10, "a real spelling word list");
  const friend = spelling[0];
  assert.strictEqual(SchoolQuiz.check(friend, "friend"), true);
  assert.strictEqual(SchoolQuiz.check(friend, "f r i e n d"), true);
  assert.strictEqual(SchoolQuiz.check(friend, "f-r-i-e-n-d"), true);
  assert.strictEqual(SchoolQuiz.check(friend, "frend"), false);
  const drill = SchoolQuiz.pick([], "spelling");
  assert.strictEqual(drill.subject, "spelling", "subject drill stays on spelling");
  const math = SchoolQuiz.pick([], "math");
  assert.strictEqual(math.subject, "math", "subject drill stays on math");
}
console.log("[ok] spelling quizzes");

// ---- connect four ----
{
  const g = ConnectFour.newGrid();
  assert.strictEqual(ConnectFour.drop(g, 3, "R"), 5);
  assert.strictEqual(ConnectFour.drop(g, 3, "Y"), 4);
  assert.strictEqual(ConnectFour.winner(g), null);
  // horizontal win
  const h = ConnectFour.newGrid();
  for (const c of [0, 1, 2, 3]) ConnectFour.drop(h, c, "R");
  assert.strictEqual(ConnectFour.winner(h), "R");
  // vertical win
  const v = ConnectFour.newGrid();
  for (let k = 0; k < 4; k++) ConnectFour.drop(v, 6, "Y");
  assert.strictEqual(ConnectFour.winner(v), "Y");
  // diagonal win
  const d = ConnectFour.newGrid();
  ConnectFour.drop(d, 0, "R");
  ConnectFour.drop(d, 1, "Y"); ConnectFour.drop(d, 1, "R");
  ConnectFour.drop(d, 2, "Y"); ConnectFour.drop(d, 2, "Y"); ConnectFour.drop(d, 2, "R");
  ConnectFour.drop(d, 3, "Y"); ConnectFour.drop(d, 3, "Y"); ConnectFour.drop(d, 3, "Y"); ConnectFour.drop(d, 3, "R");
  assert.strictEqual(ConnectFour.winner(d), "R");
  // parsing
  assert.strictEqual(ConnectFour.parse("column 4"), 3);
  assert.strictEqual(ConnectFour.parse("drop 1"), 0);
  assert.strictEqual(ConnectFour.parse("7"), 6);
  assert.strictEqual(ConnectFour.parse("hello"), null);
  assert.strictEqual(ConnectFour.parse("50"), null);
  // AI takes the win and blocks
  const w = ConnectFour.newGrid();
  for (const c of [0, 1, 2]) ConnectFour.drop(w, c, "Y");
  assert.strictEqual(ConnectFour.ai(w, "Y", "hard"), 3, "AI takes the win");
  const b = ConnectFour.newGrid();
  for (const c of [0, 1, 2]) ConnectFour.drop(b, c, "R");
  assert.strictEqual(ConnectFour.ai(b, "Y", "hard"), 3, "AI blocks the loss");
  for (const diff of ["easy", "medium", "hard"]) {
    const m = ConnectFour.ai(ConnectFour.newGrid(), "Y", diff);
    assert.ok(m >= 0 && m < 7, "AI move in range");
  }
}
console.log("[ok] connect four");

// ---- checkers ----
{
  const st = Checkers.initial();
  assert.strictEqual(Checkers.count(st, "r"), 12);
  assert.strictEqual(Checkers.count(st, "b"), 12);
  assert.strictEqual(Checkers.all(st, "r").length, 7, "red's 7 opening moves");
  assert.deepStrictEqual(Checkers.status(st), { over: false, winner: null });
  // forced capture: white… er, red must jump
  const b = Array(64).fill(null);
  b[Checkers.parseSq("c3")] = { c: "r", k: false };
  b[Checkers.parseSq("d4")] = { c: "b", k: false };
  b[Checkers.parseSq("a5")] = { c: "r", k: false };
  const pos = { b, t: "r" };
  const moves = Checkers.all(pos, "r");
  assert.ok(moves.length >= 1 && moves.every((m) => m.takes.length), "captures are forced");
  const jump = Checkers.parse("c3 e5", pos, "r");
  assert.ok(jump && jump.takes.length === 1, "c3 jumps to e5");
  const after = Checkers.apply(pos, jump);
  assert.strictEqual(after.b[Checkers.parseSq("d4")], null, "jumped piece removed");
  assert.ok(after.b[Checkers.parseSq("e5")] && after.b[Checkers.parseSq("e5")].c === "r");
  // crowning (red moves up the board, crowns on rank 8)
  const cb = Array(64).fill(null);
  cb[Checkers.parseSq("c7")] = { c: "r", k: false };
  const cpos = { b: cb, t: "r" };
  const cm = Checkers.parse("c7 b8", cpos, "r");
  assert.ok(cm && cm.king, "reaching the back rank crowns");
  assert.strictEqual(Checkers.apply(cpos, cm).b[Checkers.parseSq("b8")].k, true);
  // game over when a side has no pieces
  const eb = Array(64).fill(null);
  eb[Checkers.parseSq("h8")] = { c: "b", k: true };
  assert.deepStrictEqual(Checkers.status({ b: eb, t: "r" }), { over: true, winner: "b" });
  // AI always returns a legal move
  for (const diff of ["easy", "medium", "hard"]) {
    const m = Checkers.ai(Checkers.initial(), "b", diff);
    assert.ok(m && m.path.length, `checkers AI (${diff}) moves`);
  }
}
console.log("[ok] checkers");

// ---- chess ----
{
  const start = Chess.initial();
  assert.strictEqual(Chess.all(start).length, 20, "20 opening moves");
  // perft: the gold-standard move-generator check (start position)
  assert.strictEqual(Chess.perft(start, 1), 20, "perft(1)");
  assert.strictEqual(Chess.perft(start, 2), 400, "perft(2)");
  assert.strictEqual(Chess.perft(start, 3), 8902, "perft(3)");
  // Kiwipete (r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -)
  const kiwi = { b: Array(64).fill(null), t: "w",
    k: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0, full: 1 };
  const put = (sq, p) => { kiwi.b[Chess.parseSq(sq)] = p; };
  for (const [sq, p] of [["a8", "r"], ["e8", "k"], ["h8", "r"],
      ["a7", "p"], ["c7", "p"], ["d7", "p"], ["e7", "q"], ["f7", "p"], ["g7", "b"],
      ["a6", "b"], ["b6", "n"], ["e6", "p"], ["f6", "n"], ["g6", "p"],
      ["d5", "P"], ["e5", "N"], ["b4", "p"], ["e4", "P"],
      ["c3", "N"], ["f3", "Q"], ["h3", "p"],
      ["a2", "P"], ["b2", "P"], ["c2", "P"], ["d2", "B"], ["e2", "B"], ["f2", "P"], ["g2", "P"], ["h2", "P"],
      ["a1", "R"], ["e1", "K"], ["h1", "R"]]) put(sq, p);
  assert.strictEqual(Chess.perft(kiwi, 1), 48, "kiwipete perft(1)");
  assert.strictEqual(Chess.perft(kiwi, 2), 2039, "kiwipete perft(2)");
  // fool's mate = checkmate
  let fm = Chess.initial();
  for (const mv of ["f2 f3", "e7 e5", "g2 g4", "d8 h4"]) {
    fm = Chess.apply(fm, Chess.parse(mv, fm));
  }
  const fmStatus = Chess.status(fm);
  assert.strictEqual(fmStatus.over, true);
  assert.strictEqual(fmStatus.winner, "b", "fool's mate checkmates white");
  // stalemate: black to move, K h8 vs K f7 + Q g6 — no legal move, not in check
  const sb = Array(64).fill(null);
  sb[Chess.parseSq("h8")] = "k"; sb[Chess.parseSq("f7")] = "K"; sb[Chess.parseSq("g6")] = "Q";
  const stale = { b: sb, t: "b", k: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1 };
  assert.deepStrictEqual(Chess.status(stale), { over: true, winner: null, check: false });
  // en passant works
  let ep = Chess.initial();
  for (const mv of ["e2 e4", "g8 f6", "e4 e5", "d7 d5"]) ep = Chess.apply(ep, Chess.parse(mv, ep));
  const epm = Chess.parse("e5 d6", ep);
  assert.ok(epm && epm.epc, "en passant capture found");
  const epAfter = Chess.apply(ep, epm);
  assert.strictEqual(epAfter.b[Chess.parseSq("d5")], null, "bypassed pawn removed");
  assert.strictEqual(epAfter.b[Chess.parseSq("d6")], "P");
  // castling works
  let cs = Chess.initial();
  for (const mv of ["e2 e4", "e7 e5", "g1 f3", "g8 f6", "f1 c4", "f8 c5"]) cs = Chess.apply(cs, Chess.parse(mv, cs));
  const castle = Chess.parse("e1 g1", cs);
  assert.ok(castle && castle.castle === "K", "kingside castle found");
  const csAfter = Chess.apply(cs, castle);
  assert.strictEqual(csAfter.b[Chess.parseSq("g1")], "K");
  assert.strictEqual(csAfter.b[Chess.parseSq("f1")], "R");
  // promotion defaults to queen, explicit underpromotion respected
  const pb = Array(64).fill(null);
  pb[Chess.parseSq("e7")] = "P"; pb[Chess.parseSq("a1")] = "K"; pb[Chess.parseSq("h8")] = "k";
  const prom = { b: pb, t: "w", k: { K: false, Q: false, k: false, q: false }, ep: -1, half: 0, full: 1 };
  assert.strictEqual(Chess.parse("e7 e8", prom).promo, "Q");
  assert.strictEqual(Chess.parse("e7 e8 knight", prom).promo, "N");
  // AI returns legal moves and never hangs the game
  for (const diff of ["easy", "medium", "hard"]) {
    const m = Chess.ai(Chess.initial(), diff);
    assert.ok(m, `chess AI (${diff}) moves`);
  }
}
console.log("[ok] chess");

console.log("\nALL GAME CHECKS PASSED.");
