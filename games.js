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

  /* ============================================================
     Rock-paper-scissors — single-round logic, no state needed.
     ============================================================ */
  const RPS_MOVES = ["rock", "paper", "scissors"];
  const RPS_EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };
  const RPS_BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };

  function rpsParse(text) {
    const t = String(text || "").toLowerCase().trim();
    if (/\brock\b/.test(t)) return "rock";
    if (/\bpaper\b/.test(t)) return "paper";
    if (/\bscissors?\b/.test(t)) return "scissors";
    if (/✊/.test(t)) return "rock";
    if (/✋/.test(t)) return "paper";
    if (/✌/.test(t)) return "scissors";
    return null;
  }

  function rpsRandomMove() {
    return RPS_MOVES[Math.floor(Math.random() * RPS_MOVES.length)];
  }

  /* 'win' | 'lose' | 'tie' from the player's point of view. */
  function rpsResult(player, aqua) {
    if (player === aqua) return "tie";
    return RPS_BEATS[player] === aqua ? "win" : "lose";
  }

  const RPS = {
    MOVES: RPS_MOVES, EMOJI: RPS_EMOJI, BEATS: RPS_BEATS,
    parse: rpsParse, randomMove: rpsRandomMove, result: rpsResult,
  };

  /* ============================================================
     Guess the number — Aqua picks, you narrow it down.
     ============================================================ */
  function guessNew(min = 1, max = 100, target) {
    const lo = Math.min(min, max), hi = Math.max(min, max);
    const pick = Number.isInteger(target)
      ? Math.min(hi, Math.max(lo, target))
      : lo + Math.floor(Math.random() * (hi - lo + 1));
    return { min: lo, max: hi, target: pick, attempts: 0, over: false, guesses: [] };
  }

  function guessParse(text) {
    const m = String(text || "").match(/-?\d+/);
    if (!m) return null;
    const n = parseInt(m[0], 10);
    return Number.isFinite(n) ? n : null;
  }

  /* Returns 'low' | 'high' | 'win'. Mutates state. */
  function guessTry(state, n) {
    if (!state || state.over) return "done";
    n = Number(n);
    if (!Number.isFinite(n)) return null;
    state.attempts += 1;
    state.guesses.push(n);
    if (n < state.target) return "low";
    if (n > state.target) return "high";
    state.over = true;
    return "win";
  }

  const GuessNumber = { newGame: guessNew, parse: guessParse, guess: guessTry };

  /* ============================================================
     Word guess (hangman-lite) — guess letters, 6 misses allowed.
     ============================================================ */
  const WORD_BANK = [
    // pool shop words
    "chlorine", "filter", "pump", "skimmer", "alkalinity", "backwash",
    "shock", "calcium", "salt", "heater",
    // kid-friendly words
    "turtle", "rocket", "puppy", "rainbow", "piano", "soccer",
    "cookie", "monkey", "beach", "starfish", "dinosaur", "cupcake",
  ];

  function hangmanNew(word) {
    const w = String(word || WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)])
      .toLowerCase().replace(/[^a-z]/g, "") || "aqua";
    return { word: w, guessed: [], misses: 0, maxMisses: 6, over: false, won: false };
  }

  function hangmanDisplay(state) {
    return state.word.split("").map((c) => (state.guessed.includes(c) ? c : "_")).join(" ");
  }

  function hangmanParse(text) {
    // Strict on purpose: only a bare letter ("e") or an explicit
    // guess ("letter e", "guess e") — never mid-sentence letters.
    const low = String(text || "").toLowerCase().trim();
    const m = /^(?:guess|letter|try|is it) ([a-z])$/.exec(low);
    if (m) return m[1];
    if (/^[a-z]$/.test(low)) return low;
    return null;
  }

  /* Guess one letter. Returns { correct, already, won, lost, display, missesLeft }. */
  function hangmanGuess(state, letter) {
    letter = String(letter || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 1);
    if (!letter || !state || state.over) return null;
    if (state.guessed.includes(letter)) {
      return { correct: null, already: true, won: false, lost: false,
        display: hangmanDisplay(state), missesLeft: state.maxMisses - state.misses };
    }
    state.guessed.push(letter);
    const correct = state.word.includes(letter);
    if (!correct) state.misses += 1;
    const won = state.word.split("").every((c) => state.guessed.includes(c));
    const lost = !won && state.misses >= state.maxMisses;
    if (won) { state.over = true; state.won = true; }
    if (lost) { state.over = true; state.won = false; }
    return { correct, already: false, won, lost,
      display: hangmanDisplay(state), missesLeft: state.maxMisses - state.misses };
  }

  const Hangman = {
    WORDS: WORD_BANK, newGame: hangmanNew, display: hangmanDisplay,
    parse: hangmanParse, guess: hangmanGuess,
  };

  /* ============================================================
     School quiz — short questions for Angela (and any kid).
     Each item: { id, subject, q, answers[] }. `answers` holds every
     acceptable reply, lowercased, punctuation-free.
     ============================================================ */
  const QUIZ_BANK = [
    // math
    { id: "m1", subject: "math", q: "What's 7 + 5?", answers: ["12", "twelve"] },
    { id: "m2", subject: "math", q: "What's 9 − 4?", answers: ["5", "five"] },
    { id: "m3", subject: "math", q: "What's 3 × 4?", answers: ["12", "twelve"] },
    { id: "m4", subject: "math", q: "What's half of 20?", answers: ["10", "ten"] },
    { id: "m5", subject: "math", q: "What's 15 + 6?", answers: ["21", "twenty one", "twenty-one"] },
    { id: "m6", subject: "math", q: "If you have 3 dimes, how many cents is that?", answers: ["30", "thirty", "30 cents"] },
    // science
    { id: "s1", subject: "science", q: "What planet do we live on?", answers: ["earth"] },
    { id: "s2", subject: "science", q: "What do plants need from the sky to make food? (Hint: it shines.)", answers: ["sun", "sunlight", "light", "the sun"] },
    { id: "s3", subject: "science", q: "Is ice a solid, a liquid, or a gas?", answers: ["solid", "a solid"] },
    { id: "s4", subject: "science", q: "What do we call water when it turns into cold, hard cubes?", answers: ["ice"] },
    { id: "s5", subject: "science", q: "How many legs does a spider have?", answers: ["8", "eight"] },
    { id: "s6", subject: "science", q: "What force pulls things down to the ground?", answers: ["gravity"] },
    // language arts
    { id: "e1", subject: "language arts", q: "What do you call a word that means the opposite? (Like hot and cold.)", answers: ["antonym", "antonyms", "opposite", "opposites"] },
    { id: "e2", subject: "language arts", q: "In the sentence 'The puppy runs fast,' what is the puppy doing?", answers: ["runs", "run", "running", "runs fast"] },
    { id: "e3", subject: "language arts", q: "Which word is a noun: run, happy, or dog?", answers: ["dog"] },
    { id: "e4", subject: "language arts", q: "What letter does the word 'apple' start with?", answers: ["a"] },
    { id: "e5", subject: "language arts", q: "How many syllables are in 'butterfly'? (Clap them out!)", answers: ["3", "three"] },
    // history / social studies
    { id: "h1", subject: "history", q: "Who was the first president of the United States?", answers: ["george washington", "washington"] },
    { id: "h2", subject: "history", q: "What country is directly south of Texas?", answers: ["mexico"] },
    { id: "h3", subject: "history", q: "What do we celebrate on the Fourth of July?", answers: ["independence day", "independence", "america's birthday", "the fourth of july", "july 4th"] },
    { id: "h4", subject: "history", q: "What city is the capital of Texas?", answers: ["austin"] },
    { id: "h5", subject: "history", q: "Long ago, people traveled west in covered what?", answers: ["wagons", "wagon", "covered wagons"] },
    // just-for-fun thinking
    { id: "f1", subject: "thinking", q: "What has hands but can't clap? (Hint: it tells time.)", answers: ["clock", "a clock", "watch", "a watch"] },
    { id: "f2", subject: "thinking", q: "What gets wetter the more it dries? (Hint: it's in your bathroom.)", answers: ["towel", "a towel"] },
  ];

  function quizNormalize(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join(" ");
  }

  /* True when the reply matches any acceptable answer (exact or contains). */
  function quizCheck(item, reply) {
    if (!item) return false;
    const r = quizNormalize(reply);
    if (!r) return false;
    for (const a of (item.answers || [])) {
      const want = quizNormalize(a);
      if (!want) continue;
      if (r === want) return true;
      // accept "the answer is X" style replies
      if (want.length >= 2 && r.includes(want)) return true;
    }
    return false;
  }

  /* A fresh random math question (numbers change every time). */
  function quizMakeMath() {
    const kind = Math.floor(Math.random() * 3);
    const a = 2 + Math.floor(Math.random() * 10);
    const b = 2 + Math.floor(Math.random() * 10);
    if (kind === 0) return { id: "mx" + Date.now().toString(36), subject: "math", q: `What's ${a} + ${b}?`, answers: [String(a + b)] };
    if (kind === 1) {
      const hi = Math.max(a, b), lo = Math.min(a, b);
      return { id: "mx" + Date.now().toString(36), subject: "math", q: `What's ${hi} − ${lo}?`, answers: [String(hi - lo)] };
    }
    const x = 2 + Math.floor(Math.random() * 5), y = 2 + Math.floor(Math.random() * 5);
    return { id: "mx" + Date.now().toString(36), subject: "math", q: `What's ${x} × ${y}?`, answers: [String(x * y)] };
  }

  /* Pick a question, avoiding recently-asked ids when possible. */
  function quizPick(excludeIds) {
    const exclude = new Set(excludeIds || []);
    // Sometimes generate a fresh math question so they never run out.
    if (Math.random() < 0.25) return quizMakeMath();
    const fresh = QUIZ_BANK.filter((q) => !exclude.has(q.id));
    const pool = fresh.length ? fresh : QUIZ_BANK;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const SchoolQuiz = {
    BANK: QUIZ_BANK, normalize: quizNormalize, check: quizCheck,
    makeMath: quizMakeMath, pick: quizPick,
  };

  global.TicTacToe = TicTacToe;
  global.RPS = RPS;
  global.GuessNumber = GuessNumber;
  global.Hangman = Hangman;
  global.SchoolQuiz = SchoolQuiz;
  if (typeof module !== "undefined" && module.exports) {
    // Keep the TicTacToe fields on top for backward compatibility…
    module.exports = TicTacToe;
    // …and hang every game off the export for new code.
    module.exports.TicTacToe = TicTacToe;
    module.exports.RPS = RPS;
    module.exports.GuessNumber = GuessNumber;
    module.exports.Hangman = Hangman;
    module.exports.SchoolQuiz = SchoolQuiz;
  }
})(typeof window !== "undefined" ? window : globalThis);
