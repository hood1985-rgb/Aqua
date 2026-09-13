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
     Connect Four — 6 rows x 7 columns, drop pieces, 4 in a row wins.
     Grid is grid[row][col], row 0 is the TOP. Pieces: "R" (you) / "Y" (Aqua).
     ============================================================ */
  const CF_ROWS = 6, CF_COLS = 7;

  function cfNew() {
    return Array.from({ length: CF_ROWS }, () => Array(CF_COLS).fill(null));
  }

  function cfCopy(grid) {
    return grid.map((row) => row.slice());
  }

  function cfLegalCols(grid) {
    const out = [];
    for (let c = 0; c < CF_COLS; c++) if (!grid[0][c]) out.push(c);
    return out;
  }

  /* Drop `piece` into column c. Returns the row it landed on, or -1 if full. */
  function cfDrop(grid, col, piece) {
    if (col < 0 || col >= CF_COLS || grid[0][col]) return -1;
    for (let r = CF_ROWS - 1; r >= 0; r--) {
      if (!grid[r][col]) { grid[r][col] = piece; return r; }
    }
    return -1;
  }

  function cfWinner(grid) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < CF_ROWS; r++) {
      for (let c = 0; c < CF_COLS; c++) {
        const p = grid[r][c];
        if (!p) continue;
        for (const [dr, dc] of dirs) {
          let n = 1, rr = r + dr, cc = c + dc;
          while (n < 4 && rr >= 0 && rr < CF_ROWS && cc >= 0 && cc < CF_COLS && grid[rr][cc] === p) {
            n++; rr += dr; cc += dc;
          }
          if (n === 4) return p;
        }
      }
    }
    return null;
  }

  function cfFull(grid) {
    return grid[0].every((c) => !!c);
  }

  /* "column 4", "drop 2", "c3", or a bare 1-7 (0-based index returned). */
  function cfParse(text) {
    const t = String(text || "").toLowerCase().trim();
    if (!t || t.split(/\s+/).length > 3) return null;
    let m = /(?:column|col|drop|slot|in)\s*([1-7])/.exec(t);
    if (m) return parseInt(m[1], 10) - 1;
    m = /^c\s?([1-7])$/.exec(t.replace(/\s+/g, ""));
    if (m) return parseInt(m[1], 10) - 1;
    if (/^[1-7]$/.test(t)) return parseInt(t, 10) - 1;
    return null;
  }

  /* Count open-ended runs of `piece` with at least `len` in a line. */
  function cfScoreGrid(grid, piece) {
    const foe = piece === "R" ? "Y" : "R";
    let score = 0;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < CF_ROWS; r++) {
      for (let c = 0; c < CF_COLS; c++) {
        for (const [dr, dc] of dirs) {
          let mine = 0, theirs = 0, rr = r, cc = c;
          for (let k = 0; k < 4; k++) {
            if (rr < 0 || rr >= CF_ROWS || cc < 0 || cc >= CF_COLS) { mine = -99; break; }
            if (grid[rr][cc] === piece) mine++;
            else if (grid[rr][cc] === foe) theirs++;
            rr += dr; cc += dc;
          }
          if (mine < 0) continue;
          if (theirs === 0) score += mine === 4 ? 100000 : mine === 3 ? 60 : mine === 2 ? 6 : mine === 1 ? 1 : 0;
          else if (mine === 0) score -= theirs === 3 ? 55 : theirs === 2 ? 5 : 0;
        }
      }
    }
    // slight love for the center column
    for (let r = 0; r < CF_ROWS; r++) if (grid[r][3] === piece) score += 2;
    return score;
  }

  function cfAi(grid, ai, difficulty = "medium") {
    const cols = cfLegalCols(grid);
    if (!cols.length) return -1;
    const foe = ai === "R" ? "Y" : "R";
    const r = Math.random();
    const playBest = difficulty === "hard" || (difficulty === "medium" ? r < 0.8 : r < 0.25);
    if (!playBest) return cols[Math.floor(Math.random() * cols.length)];
    // 1) take the win  2) block the loss
    for (const pass of [ai, foe]) {
      for (const c of cols) {
        const g = cfCopy(grid);
        cfDrop(g, c, pass);
        if (cfWinner(g) === pass) return c;
      }
    }
    // 3) best-scoring column (with a little noise so she's not robotic)
    let best = cols[0], bestScore = -Infinity;
    const order = cols.slice().sort(() => Math.random() - 0.5);
    for (const c of order) {
      const g = cfCopy(grid);
      cfDrop(g, c, ai);
      const s = cfScoreGrid(g, ai) + Math.random() * (difficulty === "hard" ? 1 : 8);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  const ConnectFour = {
    ROWS: CF_ROWS, COLS: CF_COLS, newGrid: cfNew, copy: cfCopy,
    legalCols: cfLegalCols, drop: cfDrop, winner: cfWinner,
    isFull: cfFull, parse: cfParse, ai: cfAi,
  };

  /* ============================================================
     Checkers (English draughts) — 8x8, dark squares only.
     Board is Array(64); a piece is { c: "r"|"b", k: bool }.
     Red ("r", you) starts at the bottom (rows 5-7) and moves up.
     State: { b, t } where t is the side to move.
     A move: { from, path: [to...], takes: [idx...], king: bool }.
     ============================================================ */
  function ckRC(i) { return [(i / 8) | 0, i % 8]; }
  function ckIdx(r, c) { return r * 8 + c; }
  function ckDark(r, c) { return (r + c) % 2 === 1; }
  function ckIn(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  function ckInitial() {
    const b = Array(64).fill(null);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
      if (ckDark(r, c)) b[ckIdx(r, c)] = { c: "b", k: false };
    }
    for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (ckDark(r, c)) b[ckIdx(r, c)] = { c: "r", k: false };
    }
    return { b, t: "r" };
  }

  function ckCopy(st) {
    return { b: st.b.map((p) => (p ? { c: p.c, k: p.k } : null)), t: st.t };
  }

  function ckDirs(piece) {
    if (piece.k) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    return piece.c === "r" ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
  }

  /* Depth-first search for every capture chain starting at i. */
  function ckJumps(b, i, piece, path, takes, out) {
    const [r, c] = ckRC(i);
    // A man that crowns mid-chain stops there (standard rule).
    if (!piece.k && takes.length > 0 &&
        ((piece.c === "r" && r === 0) || (piece.c === "b" && r === 7))) {
      out.push({ path, takes, king: true });
      return;
    }
    let jumped = false;
    for (const [dr, dc] of ckDirs(piece)) {
      const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
      if (!ckIn(lr, lc) || !ckDark(lr, lc)) continue;
      const mid = b[ckIdx(mr, mc)];
      if (!mid || mid.c === piece.c || b[ckIdx(lr, lc)]) continue;
      jumped = true;
      // hop along the board so longer chains see the updated position
      b[i] = null; b[ckIdx(mr, mc)] = null; b[ckIdx(lr, lc)] = piece;
      ckJumps(b, ckIdx(lr, lc), piece, path.concat([ckIdx(lr, lc)]), takes.concat([ckIdx(mr, mc)]), out);
      b[i] = piece; b[ckIdx(mr, mc)] = mid; b[ckIdx(lr, lc)] = null;
    }
    if (!jumped && takes.length) out.push({ path, takes, king: false });
  }

  /* All legal moves for the piece on i (captures only, if any exist). */
  function ckMovesFor(st, i) {
    const piece = st.b[i];
    if (!piece || piece.c !== st.t) return [];
    const caps = [];
    ckJumps(st.b.map((p) => (p ? { c: p.c, k: p.k } : null)), i, { c: piece.c, k: piece.k }, [], [], caps);
    for (const m of caps) m.from = i;
    if (caps.length) return caps;
    const [r, c] = ckRC(i);
    const quiet = [];
    for (const [dr, dc] of ckDirs(piece)) {
      const nr = r + dr, nc = c + dc;
      if (!ckIn(nr, nc) || !ckDark(nr, nc) || st.b[ckIdx(nr, nc)]) continue;
      const crown = !piece.k && ((piece.c === "r" && nr === 0) || (piece.c === "b" && nr === 7));
      quiet.push({ from: i, path: [ckIdx(nr, nc)], takes: [], king: crown });
    }
    return quiet;
  }

  /* Every legal move for `color` — captures are forced. */
  function ckAll(st, color) {
    const probe = { b: st.b, t: color };
    let moves = [];
    for (let i = 0; i < 64; i++) {
      if (st.b[i] && st.b[i].c === color) moves = moves.concat(ckMovesFor(probe, i));
    }
    const caps = moves.filter((m) => m.takes.length);
    return caps.length ? caps : moves;
  }

  function ckApply(st, move) {
    const next = ckCopy(st);
    const piece = next.b[move.from];
    next.b[move.from] = null;
    for (const t of move.takes) next.b[t] = null;
    const to = move.path[move.path.length - 1];
    next.b[to] = { c: piece.c, k: piece.k || move.king };
    next.t = st.t === "r" ? "b" : "r";
    return next;
  }

  function ckCount(st, color) {
    let n = 0;
    for (const p of st.b) if (p && p.c === color) n++;
    return n;
  }

  /* { over, winner } — winner is "r"|"b"|null (null = draw by 80 quiet moves? no: tie only by agreement; here ties never happen, but keep the shape). */
  function ckStatus(st) {
    if (ckCount(st, st.t) === 0) return { over: true, winner: st.t === "r" ? "b" : "r" };
    if (ckAll(st, st.t).length === 0) return { over: true, winner: st.t === "r" ? "b" : "r" };
    return { over: false, winner: null };
  }

  function ckEval(st, me) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = st.b[i];
      if (!p) continue;
      const [r, c] = ckRC(i);
      let v = p.k ? 140 : 100;
      v += p.k ? 0 : (p.c === "r" ? (7 - r) * 4 : r * 4);      // advancement
      if (c >= 2 && c <= 5) v += 4;                              // center files
      if (!p.k && ((p.c === "r" && r === 7) || (p.c === "b" && r === 0))) v += 6; // back rank guard
      score += p.c === me ? v : -v;
    }
    return score;
  }

  function ckSearch(st, me, depth, alpha, beta) {
    const status = ckStatus(st);
    if (status.over) return status.winner === me ? 100000 + depth : -100000 - depth;
    if (depth <= 0) return ckEval(st, me);
    const moves = ckAll(st, st.t);
    const maximizing = st.t === me;
    // longest captures first — they tend to be strongest
    moves.sort((a, b) => b.takes.length - a.takes.length);
    if (maximizing) {
      let best = -Infinity;
      for (const m of moves) {
        best = Math.max(best, ckSearch(ckApply(st, m), me, depth - 1, alpha, beta));
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (const m of moves) {
      best = Math.min(best, ckSearch(ckApply(st, m), me, depth - 1, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  function ckAi(st, color, difficulty = "medium") {
    const moves = ckAll(st, color);
    if (!moves.length) return null;
    const r = Math.random();
    const playBest = difficulty === "hard" || (difficulty === "medium" ? r < 0.75 : r < 0.25);
    if (!playBest) return moves[Math.floor(Math.random() * moves.length)];
    const depth = difficulty === "hard" ? 5 : difficulty === "medium" ? 3 : 1;
    let best = null, bestScore = -Infinity;
    const order = moves.slice().sort(() => Math.random() - 0.5);
    for (const m of order) {
      const s = ckSearch(ckApply(st, m), color, depth - 1, -Infinity, Infinity);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  /* Board coords: a1 is Red's bottom-left (row 7, col 0). */
  function ckParseSq(s) {
    s = String(s || "").toLowerCase();
    if (!/^[a-h][1-8]$/.test(s)) return -1;
    return (8 - (s.charCodeAt(1) - 48)) * 8 + (s.charCodeAt(0) - 97);
  }

  function ckSqName(i) {
    const [r, c] = ckRC(i);
    return "abcdefgh"[c] + (8 - r);
  }

  /* "a3 b4" / "a3 to b4" — finds the legal move matching from+first hop. */
  function ckParse(text, st, color) {
    const m = /([a-h][1-8])\s*(?:to|->|-)?\s*([a-h][1-8])/.exec(String(text || "").toLowerCase());
    if (!m) return null;
    const from = ckParseSq(m[1]), to = ckParseSq(m[2]);
    if (from < 0 || to < 0) return null;
    const moves = ckAll(st, color).filter((mv) => mv.from === from && mv.path[0] === to);
    if (!moves.length) return null;
    // if several chains share the first hop, take the longest capture
    moves.sort((a, b) => b.takes.length - a.takes.length);
    return moves[0];
  }

  const Checkers = {
    initial: ckInitial, copy: ckCopy, movesFor: ckMovesFor, all: ckAll,
    apply: ckApply, status: ckStatus, count: ckCount, ai: ckAi,
    parseSq: ckParseSq, sqName: ckSqName, parse: ckParse, rc: ckRC,
  };

  /* ============================================================
     Chess — complete rules: castling, en passant, promotion,
     check, checkmate, and stalemate.
     Square index = rank*8 + file, rank 0 is White's home rank.
     Pieces: white UPPERCASE, black lowercase. State:
     { b:[64], t:"w"|"b", k:{K,Q,k,q}, ep:index|-1, half, full }
     A move: { f, t, cap, promo, dbl, epc, castle }.
     ============================================================ */
  const CH_FILES = "abcdefgh";

  function chFR(i) { return [i % 8, (i / 8) | 0]; }
  function chSq(f, r) { return r * 8 + f; }
  function chName(i) { const [f, r] = chFR(i); return CH_FILES[f] + (r + 1); }
  function chParseSq(s) {
    s = String(s || "").toLowerCase();
    if (!/^[a-h][1-8]$/.test(s)) return -1;
    return (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
  }
  function chColor(p) { return p < "a" ? "w" : "b"; }   // uppercase = white
  function chType(p) { return p.toUpperCase(); }

  function chInitial() {
    const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
    const b = Array(64).fill(null);
    for (let f = 0; f < 8; f++) {
      b[chSq(f, 0)] = back[f];
      b[chSq(f, 1)] = "P";
      b[chSq(f, 6)] = "p";
      b[chSq(f, 7)] = back[f].toLowerCase();
    }
    return { b, t: "w", k: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0, full: 1 };
  }

  function chCopy(st) {
    return { b: st.b.slice(), t: st.t, k: { K: st.k.K, Q: st.k.Q, k: st.k.k, q: st.k.q }, ep: st.ep, half: st.half, full: st.full };
  }

  /* Is `sq` attacked by color `by`? */
  function chAttacked(st, sq, by) {
    const b = st.b;
    const [f, r] = chFR(sq);
    // pawns: a white attacker sits one rank below the target
    const pr = by === "w" ? r - 1 : r + 1;
    if (pr >= 0 && pr < 8) {
      for (const df of [-1, 1]) {
        const pf = f + df;
        if (pf >= 0 && pf < 8 && b[chSq(pf, pr)] === (by === "w" ? "P" : "p")) return true;
      }
    }
    // knights
    for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
      const nf = f + df, nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
      const p = b[chSq(nf, nr)];
      if (p && chColor(p) === by && chType(p) === "N") return true;
    }
    // sliders
    const rays = [
      [[1, 0], [-1, 0], [0, 1], [0, -1]],   // rook / queen
      [[1, 1], [1, -1], [-1, 1], [-1, -1]], // bishop / queen
    ];
    for (let k = 0; k < 2; k++) {
      for (const [df, dr] of rays[k]) {
        let nf = f + df, nr = r + dr;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const p = b[chSq(nf, nr)];
          if (p) {
            if (chColor(p) === by) {
              const t = chType(p);
              if (t === "Q" || (k === 0 && t === "R") || (k === 1 && t === "B")) return true;
            }
            break;
          }
          nf += df; nr += dr;
        }
      }
    }
    // king
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!df && !dr) continue;
        const nf = f + df, nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const p = b[chSq(nf, nr)];
        if (p && chColor(p) === by && chType(p) === "K") return true;
      }
    }
    return false;
  }

  function chKingSq(st, color) {
    const want = color === "w" ? "K" : "k";
    for (let i = 0; i < 64; i++) if (st.b[i] === want) return i;
    return -1;
  }

  function chInCheck(st, color) {
    const k = chKingSq(st, color);
    return k >= 0 && chAttacked(st, k, color === "w" ? "b" : "w");
  }

  /* Pseudo-legal moves for the piece on `from` (may leave the king in check). */
  function chPseudo(st, from) {
    const b = st.b;
    const piece = b[from];
    if (!piece) return [];
    const me = chColor(piece);
    const [f, r] = chFR(from);
    const moves = [];
    const push = (t, extra) => moves.push(Object.assign({ f: from, t, cap: b[t] || null, promo: null, dbl: false, epc: false, castle: null }, extra || {}));

    const type = chType(piece);
    if (type === "P") {
      const dir = me === "w" ? 1 : -1;
      const startRank = me === "w" ? 1 : 6;
      const promoRank = me === "w" ? 7 : 0;
      const one = r + dir;
      if (one >= 0 && one < 8 && !b[chSq(f, one)]) {
        if (one === promoRank) {
          for (const pr of ["Q", "R", "B", "N"]) push(chSq(f, one), { promo: me === "w" ? pr : pr.toLowerCase() });
        } else {
          push(chSq(f, one));
          const two = r + 2 * dir;
          if (r === startRank && !b[chSq(f, two)]) push(chSq(f, two), { dbl: true });
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df, nr = r + dir;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const t = chSq(nf, nr);
        if (b[t] && chColor(b[t]) !== me) {
          if (nr === promoRank) {
            for (const pr of ["Q", "R", "B", "N"]) push(t, { promo: me === "w" ? pr : pr.toLowerCase() });
          } else push(t);
        } else if (!b[t] && t === st.ep) {
          push(t, { epc: true, cap: me === "w" ? "p" : "P" });
        }
      }
    } else if (type === "N" || type === "K") {
      const steps = type === "N"
        ? [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
        : [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      for (const [df, dr] of steps) {
        const nf = f + df, nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const t = chSq(nf, nr);
        if (!b[t] || chColor(b[t]) !== me) push(t);
      }
      if (type === "K") {
        // castling: rights + empty + unattacked transit
        const foe = me === "w" ? "b" : "w";
        if (me === "w" && from === chSq(4, 0)) {
          if (st.k.K && !b[chSq(5, 0)] && !b[chSq(6, 0)] &&
              !chAttacked(st, chSq(4, 0), foe) && !chAttacked(st, chSq(5, 0), foe) && !chAttacked(st, chSq(6, 0), foe)) {
            push(chSq(6, 0), { castle: "K" });
          }
          if (st.k.Q && !b[chSq(3, 0)] && !b[chSq(2, 0)] && !b[chSq(1, 0)] &&
              !chAttacked(st, chSq(4, 0), foe) && !chAttacked(st, chSq(3, 0), foe) && !chAttacked(st, chSq(2, 0), foe)) {
            push(chSq(2, 0), { castle: "Q" });
          }
        } else if (me === "b" && from === chSq(4, 7)) {
          if (st.k.k && !b[chSq(5, 7)] && !b[chSq(6, 7)] &&
              !chAttacked(st, chSq(4, 7), foe) && !chAttacked(st, chSq(5, 7), foe) && !chAttacked(st, chSq(6, 7), foe)) {
            push(chSq(6, 7), { castle: "K" });
          }
          if (st.k.q && !b[chSq(3, 7)] && !b[chSq(2, 7)] && !b[chSq(1, 7)] &&
              !chAttacked(st, chSq(4, 7), foe) && !chAttacked(st, chSq(3, 7), foe) && !chAttacked(st, chSq(2, 7), foe)) {
            push(chSq(2, 7), { castle: "Q" });
          }
        }
      }
    } else {
      const dirs = type === "R" ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
        : type === "B" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
        : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const t = chSq(nf, nr);
          if (!b[t]) push(t);
          else {
            if (chColor(b[t]) !== me) push(t);
            break;
          }
          nf += df; nr += dr;
        }
      }
    }
    return moves;
  }

  function chApply(st, m) {
    const next = chCopy(st);
    const b = next.b;
    const piece = b[m.f];
    const me = chColor(piece);
    b[m.f] = null;
    if (m.epc) {
      const [tf, tr] = chFR(m.t);
      b[chSq(tf, tr + (me === "w" ? -1 : 1))] = null;   // remove the bypassed pawn
    }
    b[m.t] = m.promo || piece;
    if (m.castle) {
      if (m.t === chSq(6, 0)) { b[chSq(7, 0)] = null; b[chSq(5, 0)] = "R"; }
      else if (m.t === chSq(2, 0)) { b[chSq(0, 0)] = null; b[chSq(3, 0)] = "R"; }
      else if (m.t === chSq(6, 7)) { b[chSq(7, 7)] = null; b[chSq(5, 7)] = "r"; }
      else if (m.t === chSq(2, 7)) { b[chSq(0, 7)] = null; b[chSq(3, 7)] = "r"; }
    }
    // castling rights
    if (chType(piece) === "K") {
      if (me === "w") { next.k.K = false; next.k.Q = false; }
      else { next.k.k = false; next.k.q = false; }
    }
    const rookHome = { [chSq(0, 0)]: "Q", [chSq(7, 0)]: "K", [chSq(0, 7)]: "q", [chSq(7, 7)]: "k" };
    if (rookHome[m.f]) next.k[rookHome[m.f]] = false;
    if (m.cap && chType(m.cap) === "R" && rookHome[m.t]) next.k[rookHome[m.t]] = false;
    next.ep = m.dbl ? (m.f + m.t) / 2 : -1;
    next.half = (chType(piece) === "P" || m.cap) ? 0 : st.half + 1;
    next.t = me === "w" ? "b" : "w";
    if (me === "b") next.full = st.full + 1;
    return next;
  }

  function chLegal(st, from) {
    const piece = st.b[from];
    if (!piece || chColor(piece) !== st.t) return [];
    const me = st.t;
    return chPseudo(st, from).filter((m) => !chInCheck(chApply(st, m), me));
  }

  function chAll(st) {
    let moves = [];
    for (let i = 0; i < 64; i++) {
      if (st.b[i] && chColor(st.b[i]) === st.t) moves = moves.concat(chLegal(st, i));
    }
    return moves;
  }

  function chStatus(st) {
    const moves = chAll(st);
    if (moves.length) return { over: false, winner: null, check: chInCheck(st, st.t) };
    if (chInCheck(st, st.t)) return { over: true, winner: st.t === "w" ? "b" : "w", check: true };
    return { over: true, winner: null, check: false };   // stalemate
  }

  /* Node counter for tests / AI budgeting. */
  function chPerft(st, depth) {
    if (depth <= 0) return 1;
    let n = 0;
    for (const m of chAll(st)) n += chPerft(chApply(st, m), depth - 1);
    return n;
  }

  /* ---- evaluation: material + small, obviously-correct positional terms ---- */
  const CH_VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

  function chEval(st, me) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const p = st.b[i];
      if (!p) continue;
      const [f, r] = chFR(i);
      const t = chType(p);
      const adv = chColor(p) === "w" ? r : 7 - r;   // ranks advanced
      let v = CH_VAL[t];
      if (t === "P") v += adv * 8 + ((f >= 2 && f <= 5) ? 4 : 0);
      else if (t === "N") v += (f >= 2 && f <= 5 && adv >= 1 && adv <= 6 ? 12 : 0) + adv * 2;
      else if (t === "B" || t === "Q") v += adv * 2;
      else if (t === "R" && (r === 0 || r === 7)) v -= 4;
      else if (t === "K" && adv > 1) v -= 10 * adv;
      score += chColor(p) === me ? v : -v;
    }
    return score + (st.t === me ? 5 : -5);
  }

  function chOrder(moves) {
    // captures first, biggest victim first — alpha-beta's best friend
    const val = (m) => (m.cap ? CH_VAL[chType(m.cap)] : 0) + (m.promo ? 800 : 0);
    return moves.slice().sort((a, b) => val(b) - val(a));
  }

  function chSearch(st, me, depth, alpha, beta) {
    const status = chStatus(st);
    if (status.over) {
      if (!status.winner) return 0;
      return status.winner === me ? 100000 + depth : -100000 - depth;
    }
    if (depth <= 0) return chEval(st, me);
    let best = st.t === me ? -Infinity : Infinity;
    for (const m of chOrder(chAll(st))) {
      const s = chSearch(chApply(st, m), me, depth - 1, alpha, beta);
      if (st.t === me) {
        if (s > best) best = s;
        if (s > alpha) alpha = s;
      } else {
        if (s < best) best = s;
        if (s < beta) beta = s;
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  function chAi(st, difficulty = "medium") {
    const moves = chAll(st);
    if (!moves.length) return null;
    const me = st.t;
    const r = Math.random();
    const depth = difficulty === "hard" ? 3 : difficulty === "medium" ? 2 : 1;
    // Easy sometimes just wanders; medium/hard think (medium with noise).
    if (difficulty === "easy" && r < 0.45) return moves[Math.floor(Math.random() * moves.length)];
    const noise = difficulty === "hard" ? 4 : difficulty === "medium" ? 30 : 120;
    let best = null, bestScore = -Infinity;
    for (const m of chOrder(moves)) {
      const s = chSearch(chApply(st, m), me, depth - 1, -Infinity, Infinity) + Math.random() * noise;
      if (s > bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  /* "e2 e4" / "e2e4" / "e2 to e4" (+ optional promotion: "e7e8q", "…queen"). */
  function chParse(text, st) {
    const t = String(text || "").toLowerCase().replace(/-/g, " ");
    const m = /([a-h][1-8])\s*(?:to)?\s*([a-h][1-8])\s*(queen|rook|bishop|knight|[qrbn])?/.exec(t);
    if (!m) return null;
    const from = chParseSq(m[1]), to = chParseSq(m[2]);
    if (from < 0 || to < 0) return null;
    let promo = null;
    if (m[3]) {
      const w = { queen: "q", rook: "r", bishop: "b", knight: "n" }[m[3]] || m[3];
      promo = st.t === "w" ? w.toUpperCase() : w;
    }
    const legal = chAll(st).filter((mv) => mv.f === from && mv.t === to);
    if (!legal.length) return null;
    if (promo) return legal.find((mv) => mv.promo === promo) || null;
    return legal.find((mv) => mv.promo === (st.t === "w" ? "Q" : "q")) || legal[0];
  }

  const Chess = {
    initial: chInitial, copy: chCopy, legal: chLegal, all: chAll,
    apply: chApply, status: chStatus, inCheck: chInCheck, ai: chAi,
    parse: chParse, parseSq: chParseSq, sqName: chName, perft: chPerft,
    attacked: chAttacked,
  };

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
    // spelling (Angela's practice — she can answer "friend" or "f r i e n d")
    { id: "sp1", subject: "spelling", q: "Spell the word “friend”.", answers: ["friend"] },
    { id: "sp2", subject: "spelling", q: "Spell the word “because”.", answers: ["because"] },
    { id: "sp3", subject: "spelling", q: "Spell the word “school”.", answers: ["school"] },
    { id: "sp4", subject: "spelling", q: "Spell the word “water”.", answers: ["water"] },
    { id: "sp5", subject: "spelling", q: "Spell the word “turtle”.", answers: ["turtle"] },
    { id: "sp6", subject: "spelling", q: "Spell the word “rainbow”.", answers: ["rainbow"] },
    { id: "sp7", subject: "spelling", q: "Spell the word “cookie”.", answers: ["cookie"] },
    { id: "sp8", subject: "spelling", q: "Spell the word “happy”.", answers: ["happy"] },
    { id: "sp9", subject: "spelling", q: "Spell the word “light”.", answers: ["light"] },
    { id: "sp10", subject: "spelling", q: "Spell the word “train”.", answers: ["train"] },
    { id: "sp11", subject: "spelling", q: "Spell the word “dinosaur”.", answers: ["dinosaur"] },
    { id: "sp12", subject: "spelling", q: "Spell the word “monkey”.", answers: ["monkey"] },
  ];

  function quizNormalize(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join(" ");
  }

  /* True when the reply matches any acceptable answer (exact or contains).
     Spelling answers also match letter-by-letter ("f r i e n d"). */
  function quizCheck(item, reply) {
    if (!item) return false;
    const r = quizNormalize(reply);
    if (!r) return false;
    const nospace = r.replace(/ /g, "");
    for (const a of (item.answers || [])) {
      const want = quizNormalize(a);
      if (!want) continue;
      if (r === want) return true;
      if (item.subject === "spelling" && nospace === want.replace(/ /g, "")) return true;
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

  /* Pick a question, avoiding recently-asked ids when possible.
     Pass a subject ("math", "spelling", …) to drill just that. */
  function quizPick(excludeIds, subject) {
    const exclude = new Set(excludeIds || []);
    const want = String(subject || "").toLowerCase().trim();
    if (want === "math" && Math.random() < 0.6) return quizMakeMath();
    if (!want && Math.random() < 0.25) return quizMakeMath();   // fresh math, sometimes
    const bank = want ? QUIZ_BANK.filter((q) => q.subject === want) : QUIZ_BANK;
    const pool = bank.length ? bank : QUIZ_BANK;
    const fresh = pool.filter((q) => !exclude.has(q.id));
    const use = fresh.length ? fresh : pool;
    return use[Math.floor(Math.random() * use.length)];
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
  global.ConnectFour = ConnectFour;
  global.Checkers = Checkers;
  global.Chess = Chess;
  if (typeof module !== "undefined" && module.exports) {
    // Keep the TicTacToe fields on top for backward compatibility…
    module.exports = TicTacToe;
    // …and hang every game off the export for new code.
    module.exports.TicTacToe = TicTacToe;
    module.exports.RPS = RPS;
    module.exports.GuessNumber = GuessNumber;
    module.exports.Hangman = Hangman;
    module.exports.SchoolQuiz = SchoolQuiz;
    module.exports.ConnectFour = ConnectFour;
    module.exports.Checkers = Checkers;
    module.exports.Chess = Chess;
  }
})(typeof window !== "undefined" ? window : globalThis);
