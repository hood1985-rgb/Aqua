/* ============================================================
   Aqua — chat UI, voice, and commands (desktop app).

   - Her brain & memory live in brain.js (localStorage).
   - Her smart brain is OpenAI (called via the Electron bridge).
   - Her ears are OpenAI Whisper (recorded here, transcribed in main).
   - Her voice uses the Windows voices (Web Speech synthesis).
   ============================================================ */

"use strict";

/* ---------------- tiny helpers ---------------- */
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function msText(ms) {
  ms = Math.max(0, Math.round(ms / 1000) * 1000);
  const min = Math.round(ms / 60000);
  if (min < 1) return "a moment";
  if (min < 60) return `about ${min} minute${min === 1 ? "" : "s"}`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  if (!rem) return `about ${hr} hour${hr === 1 ? "" : "s"}`;
  return `about ${hr}h ${rem}m`;
}

function whenText(at) {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ap = hh >= 12 ? "pm" : "am";
  const hr12 = hh % 12 === 0 ? 12 : hh % 12;
  const time = `${hr12}:${mm}${ap}`;
  if (sameDay) return `today at ${time}`;
  if (d.toDateString() === new Date(now.getTime() + 86400000).toDateString()) return `tomorrow at ${time}`;
  return `${d.toLocaleDateString()} at ${time}`;
}

/* ---------------- the Electron bridge (absent when opened in a plain browser) ---------------- */
const bridge = window.aqua || null;

/* ---------------- Aqua's mind ---------------- */
const mem = new Memory(window.localStorage);
let brain = new Brain(mem);

/* smart brain state (OpenAI) */
const smart = { on: false, model: "gpt-4o-mini" };

/* ---------------- who's talking (speaker recognition) ---------------- */
const personMemories = new Map();      // person id -> their own Memory instance
let activePersonId = null;             // null = the boss (default profile)
const greetedThisSession = new Set();  // people she's already said hi to

function roster() {
  return mem.data.people || [];
}

function personById(id) {
  return roster().find((p) => p.id === id) || null;
}

function personByName(name) {
  const q = String(name || "").toLowerCase();
  return roster().find((p) => p.name && String(p.name).toLowerCase() === q) || null;
}

function getPersonMemory(id) {
  if (!id) return mem;
  if (!personMemories.has(id)) {
    const m = new Memory(window.localStorage, "aqua.profile.v1:person:" + id);
    const p = personById(id);
    if (p && p.name && !m.data.name) m.data.name = p.name;
    personMemories.set(id, m);
  }
  return personMemories.get(id);
}

function getSpeakerBrain() {
  if (!activePersonId) return brain;
  const m = getPersonMemory(activePersonId);
  if (!m._brain) m._brain = new Brain(m);
  return m._brain;
}

function getSpeakerMemory() {
  return activePersonId ? getPersonMemory(activePersonId) : mem;
}

function speakerName() {
  if (!activePersonId) return null;
  const p = personById(activePersonId);
  return p ? p.name : null;
}

function updateSpeakerChip() {
  const el = $("speaker-chip");
  if (!el) return;
  const name = speakerName();
  el.textContent = name ? `with ${name}` : "the boss";
  el.title = name
    ? `She's talking with ${name}`
    : "She's talking with the boss (no one else is on the mic)";
}

function setActiveSpeaker(name) {
  const p = name ? personByName(name) : null;
  const changed = (p ? p.id : null) !== activePersonId;
  activePersonId = p ? p.id : null;
  updateSpeakerChip();
  if (p && !greetedThisSession.has(p.id)) {
    greetedThisSession.add(p.id);
    addDivider(`now talking with ${p.name}`);
    toast(`Heard ${p.name} — hey there.`);
  }
  if (p && changed) maybeWakeUp(p);
  return p || null;
}

function daypart() {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : "evening";
}

/* First time she hears someone each day, she lights up with a daypart
   greeting — plus a little something she remembers, when she's got it. */
function maybeWakeUp(p) {
  try {
    const today = Journal.todayKey();
    if (p.lastDaily === today) return;
    p.lastDaily = today;
    mem.save();
    const part = daypart();
    let greet = part === "morning" ? `Good morning, ${p.name}!`
      : part === "afternoon" ? `Good afternoon, ${p.name}!`
      : `Good evening, ${p.name}!`;
    const pm = getPersonMemory(p.id);
    const fact = pm && pm.randomFact && pm.randomFact();
    if (fact && Math.random() < 0.5) {
      const prefix = ["favorite", "person", "pet"].includes(fact.kind) ? "your" : "you";
      greet += ` Still thinking about ${prefix} ${fact.text} — love that.`;
    }
    const out = forAudience(greet);
    addMessage("aqua", out);
    Speaker.say(out);
  } catch (e) { /* wake-ups are best-effort */ }
}

/* ---------------- audience: kids, Rhonda, Angela ---------------- */
function activePerson() {
  return activePersonId ? personById(activePersonId) : null;
}

/* Kid-safe when flagged as a kid, or enrolled with an age under 13. */
function isChildSpeaker() {
  const p = activePerson();
  if (!p) return false;
  if (p.kid === true) return true;
  const age = Number(p.age);
  return Number.isFinite(age) && age > 0 && age < 13;
}

/* Rhonda Hood — and ONLY Rhonda Hood — gets the Canadian flavour. */
function isRhonda() {
  const n = speakerName();
  return !!n && n.trim().toLowerCase() === "rhonda hood";
}

function isAngela() {
  const n = speakerName();
  return !!n && n.trim().toLowerCase() === "angela";
}

function audience() {
  return { child: isChildSpeaker(), rhonda: isRhonda(), spanish: !!mem.data.spanish };
}

/* Poolside Spanish cheat sheet — pool words and phrases for the crew. */
const POOL_ES = `🇪🇸 Poolside Spanish cheat sheet:
• chlorine = cloro • pH = pe-ache • alkalinity = alcalinidad
• shock = tratamiento de choque • filter = filtro • pump = bomba
• skimmer = desnatador • backwash = retrolavado • salt cell = celda de sal
• gallons = galones • pool = piscina / alberca
• "The pool needs chlorine." = "La piscina necesita cloro."
• "Test the water." = "Analiza el agua."
• "Clean the filter." = "Limpia el filtro."
• "I'll be there tomorrow." = "Llego mañana."
Say /spanish on and I'll answer en español (best with the OpenAI brain).`;

/* Rewrite a conversational reply for who's listening. Never applied to
   command output (code samples must stay exact). */
function forAudience(text) {
  let out = String(text ?? "");
  try {
    if (isChildSpeaker() && typeof kidSafe === "function") out = kidSafe(out);
    if (isRhonda() && typeof canadianize === "function") out = canadianize(out, Math.random() < 0.4);
  } catch (e) { /* audience flavour is best-effort */ }
  return out;
}

function sayForAudience(text) {
  Speaker.say(forAudience(text));
}

/* Strict voice mode: the mic only obeys enrolled voices. Typing always works. */
function strictVoices() {
  return mem.data.strict_voices !== false;
}

const STRANGER_VOICE_MSG =
  "Hmm — I don't recognize that voice, and I'm set to only listen to enrolled voices. " +
  "You can still type to me, or add the voice in 👥 People.";

/* ---------------- her voice (speaking) ---------------- */
const OPENAI_VOICES = [
  ["nova", "Nova — bright & cheerful"],
  ["shimmer", "Shimmer — airy & gentle"],
  ["coral", "Coral — warm & friendly"],
  ["sage", "Sage — calm & wise"],
  ["fable", "Fable — soft & youthful"],
  ["alloy", "Alloy — balanced & neutral"],
  ["echo", "Echo — warm & steady"],
  ["ash", "Ash — deep & mature"],
  ["onyx", "Onyx — deep & confident"],
  ["ballad", "Ballad — expressive & melodic"],
];

const Speaker = {
  available: ("speechSynthesis" in window),
  enabled: true,
  voice: null,        // Windows fallback voice (SpeechSynthesisVoice)
  rate: 1.0,
  volume: 1.2,        // a little louder by default
  voices: [],
  _queue: [],
  _speaking: false,
  _gen: 0,
  _audio: null,
  _source: null,
  _ctx: null,

  loadVoices() {
    if (!this.available) return [];
    this.voices = window.speechSynthesis.getVoices() || [];
    return this.voices;
  },

  clean(text) {
    return String(text || "")
      .replace(/[\u{1F000}-\u{1FAFF}\u2190-\u27BF\u2B00-\u2BFF\uFE0F\u200D]/gu, "")
      .replace(/[*#`]/g, "")
      .split(/\s+/).join(" ").trim();
  },

  say(text) {
    if (!this.enabled) return;
    const spoken = this.clean(text);
    if (!spoken) return;
    this._queue.push(spoken);
    this._drain();
  },

  async _drain() {
    if (this._speaking) return;
    this._speaking = true;
    setFaceState("talking");
    while (this._queue.length) {
      const text = this._queue.shift();
      await this._speakOne(text);
    }
    this._speaking = false;
    setFaceState("idle");
  },

  async _speakOne(text) {
    const gen = ++this._gen;
    if (voiceEngine() === "openai" && bridge) {
      try {
        const { audio, mime } = await bridge.speak({
          text,
          voice: mem.data.openai_voice || "nova",
          speed: clamp(this.rate, 0.25, 4),
          model: mem.data.tts_model || "tts-1",
        });
        if (gen !== this._gen) return;
        await playAudioFromBase64(audio, mime || "audio/mpeg");
        return;
      } catch (e) {
        // fall through to the Windows voice
      }
    }
    if (gen !== this._gen) return;
    await synthSpeak(text);
  },

  stop() {
    this._gen++;
    this._queue.length = 0;
    if (this._source) { try { this._source.stop(); } catch (e) {} this._source = null; }
    if (this._audio) { try { this._audio.pause(); } catch (e) {} this._audio = null; }
    if (this.available) try { window.speechSynthesis.cancel(); } catch (e) {}
    setFaceState("idle");
  },
};

function voiceEngine() {
  // OpenAI neural voices when a key is present, unless the user picked Windows.
  if (!smart.on) return "windows";
  return mem.data.voice_engine === "windows" ? "windows" : "openai";
}

function synthSpeak(text) {
  return new Promise((resolve) => {
    if (!Speaker.available) { resolve(); return; }
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (Speaker.voice) u.voice = Speaker.voice;
      u.rate = clamp(Speaker.rate, 0.5, 2);
      u.pitch = 1.0;
      u.volume = clamp(Speaker.volume, 0, 2);
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {
      resolve();
    }
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function getAudioContext() {
  if (!Speaker._ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    Speaker._ctx = new AC();
  }
  if (Speaker._ctx.state === "suspended") Speaker._ctx.resume();
  return Speaker._ctx;
}

function playAudioFromBase64(b64, mime) {
  return new Promise((resolve, reject) => {
    const finish = (err) => {
      Speaker._source = null;
      if (err) reject(err); else resolve();
    };
    try {
      const ctx = getAudioContext();
      const bytes = base64ToBytes(b64);
      ctx.decodeAudioData(bytes.buffer, (audioBuf) => {
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        const gain = ctx.createGain();
        gain.gain.value = clamp(Speaker.volume, 0, 2);   // boost makes her louder
        src.connect(gain);
        gain.connect(ctx.destination);
        Speaker._source = src;
        src.onended = () => finish(null);
        src.start();
      }, (err) => {
        // fall back to a plain <audio> element if decoding fails
        fallbackAudioPlay(b64, mime).then(finish).catch(finish);
      });
    } catch (e) {
      fallbackAudioPlay(b64, mime).then(finish).catch(finish);
    }
  });
}

function fallbackAudioPlay(b64, mime) {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([base64ToBytes(b64)], { type: mime || "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.volume = clamp(Speaker.volume, 0, 2);
      Speaker._audio = a;
      a.onended = () => { URL.revokeObjectURL(url); Speaker._audio = null; resolve(); };
      a.onerror = () => { URL.revokeObjectURL(url); Speaker._audio = null; reject(new Error("audio play failed")); };
      a.play().catch((e) => { URL.revokeObjectURL(url); Speaker._audio = null; reject(e); });
    } catch (e) {
      reject(e);
    }
  });
}

async function previewOpenAIVoice(vid) {
  if (!bridge || !smart.on) { toast("Add your OpenAI key first to preview voices."); return; }
  toast(`Previewing ${vid}…`);
  try {
    const { audio, mime } = await bridge.speak({
      text: "Hi, I'm Aqua. This is what I sound like.",
      voice: vid,
      speed: clamp(Speaker.rate, 0.25, 4),
    });
    await playAudioFromBase64(audio, mime || "audio/mpeg");
  } catch (e) {
    console.error(e);
    toast("Couldn't preview — check your key and internet.");
  }
}

function pickPreferredVoice(voices) {
  if (!voices || !voices.length) return null;
  const has = (pred) => voices.find(pred);
  return has((v) => /aria/i.test(v.name || "")) ||
         has((v) => /jenny/i.test(v.name || "")) ||
         has((v) => /zira/i.test(v.name || "")) ||
         has((v) => /natural/i.test(v.name || "") && /en[-_]us/i.test(v.lang || "")) ||
         has((v) => /^en[-_]us/i.test(v.lang || "")) ||
         has((v) => /^en/i.test(v.lang || "")) ||
         voices[0];
}

function setupVoices() {
  if (!Speaker.available) {
    const b = $("btn-voice");
    if (b) { b.disabled = true; b.title = "Voice not supported in this browser"; }
    return;
  }
  const apply = () => {
    const voices = Speaker.loadVoices();
    if (Speaker.voice) return;
    const saved = mem.data.voice_id;
    let v = saved ? voices.find((x) => x.voiceURI === saved || x.name === saved) : null;
    if (!v) v = pickPreferredVoice(voices);
    Speaker.voice = v || voices[0] || null;
  };
  apply();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = apply;
  }
  Speaker.rate = clamp(Number(mem.data.rate) || 1.0, 0.5, 2);
  Speaker.volume = clamp(Number(mem.data.volume) || 1.2, 0, 2);
}

/* ---------------- state ---------------- */
let busy = false;
let recording = false;
let handsfreeOn = false;
let wakeOn = false;
let wakeRec = null;
let wakeBusy = false;

/* side games state (the games live in the dock beside the chat) */
const dock = { tab: "ttt" };   // ttt | rps | guess | word

const game = {
  active: false,
  board: Array(9).fill(null),
  player: "X",
  aqua: "O",
  turn: "X",
  difficulty: "medium",
  root: null,        // the board container in the dock
  status: null,      // status line
  scoreLine: null,   // score line
  cells: [],         // the 9 cell buttons
  aiTimer: null,
};

const guessGame = { active: false, state: null };  // Guess the number
const wordGame = { active: false, state: null };   // Word guess (hangman-lite)
const cfGame = { active: false, grid: null, player: "R", aqua: "Y", aiTimer: null };  // Connect Four
const checkGame = { active: false, state: null, player: "r", aqua: "b", aiTimer: null, sel: -1, selMoves: [] };  // Checkers
const chessGame = { active: false, state: null, player: "w", aqua: "b", aiTimer: null, sel: -1, selMoves: [], promo: null };  // Chess

let pendingNote = false;      // bare "jot this down" — the next turn is the note

/* Angela's pop quizzes (conversational — she answers in chat) */
let pendingQuiz = null;       // { id, subject, q, answers[] }
let quizCooldown = 0;         // conversational turns until she may quiz again
let recentQuizIds = [];

const chatScroll = $("chat-scroll");
const input = $("input");
const btnSend = $("btn-send");
const btnMic = $("btn-mic");
const btnHandsfree = $("btn-handsfree");
const btnVoice = $("btn-voice");
const brainStatus = $("brain-status");

/* ---------------- rendering ---------------- */
function setFaceState(state) {
  const img = $("top-avatar");
  const wrap = $("avatar-wrap");
  if (img) img.dataset.face = state;
  if (wrap) wrap.classList.toggle("talking", state === "talking");
}

function addMessage(who, text) {
  const row = document.createElement("div");
  row.className = "msg " + who;
  const avatar = document.createElement("div");
  avatar.className = "bubble-avatar";
  if (who === "aqua") {
    const img = document.createElement("img");
    img.src = "icons/avatar.png";
    img.alt = "Aqua";
    avatar.appendChild(img);
  } else {
    avatar.textContent = "🙂";
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(avatar);
  row.appendChild(bubble);
  chatScroll.appendChild(row);
  scrollToBottom();
  return bubble;
}

function addDivider(text) {
  const d = document.createElement("div");
  d.className = "divider";
  d.textContent = text;
  chatScroll.appendChild(d);
  scrollToBottom();
}

function showTyping() {
  const row = document.createElement("div");
  row.className = "msg aqua";
  row.id = "typing-row";
  const avatar = document.createElement("div");
  avatar.className = "bubble-avatar";
  const img = document.createElement("img");
  img.src = "icons/avatar.png";
  img.alt = "Aqua";
  avatar.appendChild(img);
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  row.appendChild(avatar);
  row.appendChild(bubble);
  chatScroll.appendChild(row);
  scrollToBottom();
}

function hideTyping() {
  const row = $("typing-row");
  if (row) row.remove();
}

function scrollToBottom() {
  const chat = $("chat");
  chat.scrollTop = chat.scrollHeight;
}

function toast(text, ms = 2800) {
  const el = $("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), ms);
}

/* ---------------- composer ---------------- */
function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
}

function setSendDisabled(v) {
  btnSend.disabled = v || !input.value.trim();
}

input.addEventListener("input", () => { autosize(); setSendDisabled(false); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
btnSend.addEventListener("click", send);

function send() {
  const text = input.value.trim();
  if (!text || busy) return;
  handleUserText(text);
}

/* ---------------- core send/receive ---------------- */
/* Voice notes — "Aqua, jot this down: call the pool store". */
const NOTE_WITH_TEXT = [
  /^(?:aqua[, ]*)?(?:please )?(?:jot|write) (?:this|that|it) down[:\s]+(.+)$/i,
  /^(?:aqua[, ]*)?(?:note to self|journal this|add to (?:the )?journal|remember this|take a note)[:\s]+(.+)$/i,
];
const NOTE_BARE = /^(?:aqua[, ]*)?(?:jot (?:this|that|it) down|note to self|take a note)\.?$/i;

function noteTurn(text, content) {
  Speaker.stop();
  addMessage("user", text);
  input.value = "";
  autosize();
  busy = true;
  setSendDisabled(true);
  pendingNote = false;
  logDayExchange("(note to self)", `📝 ${content}`);
  const sMem = getSpeakerMemory();
  sMem.addExchange("(note to self)", content);
  sMem.save();
  const lines = [
    "Jotted down — it's in today's journal.",
    "Got it — written down for today.",
    "Noted! You'll see it in the journal.",
  ];
  const out = forAudience(lines[Math.floor(Math.random() * lines.length)]);
  addMessage("aqua", out);
  Speaker.say(out);
  busy = false;
  setSendDisabled(false);
  if (!Speaker._speaking) setFaceState("idle");
}

function noteAskTurn(text) {
  Speaker.stop();
  addMessage("user", text);
  input.value = "";
  autosize();
  pendingNote = true;
  const out = forAudience("You got it — what should I jot down?");
  addMessage("aqua", out);
  Speaker.say(out);
  logDayExchange(text, out);
}

async function handleUserText(text, whoName) {
  text = (text || "").trim();
  if (!text) return;
  // Voice turns always name (or clear) the speaker; typed turns keep whoever's on.
  if (whoName !== undefined) setActiveSpeaker(whoName || null);
  const sBrain = getSpeakerBrain();     // the person she's talking with
  const sMem = getSpeakerMemory();

  // A voice note ("jot this down: …") wins over everything but commands.
  if (!text.startsWith("/")) {
    if (pendingNote) { noteTurn(text, text); return; }
    for (const re of NOTE_WITH_TEXT) {
      const m = re.exec(text);
      if (m && m[1].trim()) { noteTurn(text, m[1].trim()); return; }
    }
    if (NOTE_BARE.test(text)) { noteAskTurn(text); return; }
  }

  // A pending pop quiz eats the next conversational turn (commands pass through).
  if (pendingQuiz && !text.startsWith("/")) {
    if (/^(never ?mind|skip( (it|that|the quiz))?|stop|no quiz|not now)\.?$/i.test(text)) {
      pendingQuiz = null;
      quizCooldown = 4;
    } else {
      answerQuiz(text);
      return;
    }
  }

  // Spoken game move? The open tab's game gets first dibs, then the rest.
  // (Rock-paper-scissors only listens on its own tab — "rock" is also music.)
  if (!text.startsWith("/")) {
    const words = text.split(/\s+/).length;
    const order = [dock.tab, "ttt", "chess", "checkers", "cf", "guess", "word"]
      .filter((t, i, a) => a.indexOf(t) === i);
    for (const gtab of order) {
      if (gtab === "ttt" && game.active && words <= 4) {
        const moveIdx = TicTacToe.parseMove(text);
        if (moveIdx !== null) {
          addMessage("user", text);
          openDock("ttt");
          playMoveAt(moveIdx);
          return;
        }
      } else if (gtab === "chess" && chessGame.active && chessGame.state && words <= 4) {
        const mv = Chess.parse(text, chessGame.state);
        if (mv && chessGame.state.t === chessGame.player) {
          addMessage("user", text);
          openDock("chess");
          playChessMove(mv);
          return;
        }
      } else if (gtab === "checkers" && checkGame.active && checkGame.state && words <= 3) {
        const mv = Checkers.parse(text, checkGame.state, checkGame.player);
        if (mv && checkGame.state.t === checkGame.player) {
          addMessage("user", text);
          openDock("checkers");
          playCheckersMove(mv);
          return;
        }
      } else if (gtab === "cf" && cfGame.active && words <= 3) {
        const col = ConnectFour.parse(text);
        if (col !== null) {
          addMessage("user", text);
          openDock("cf");
          playCfDrop(col);
          return;
        }
      } else if (gtab === "guess" && guessGame.active && words <= 4) {
        const n = GuessNumber.parse(text);
        if (n !== null) {
          addMessage("user", text);
          openDock("guess");
          playGuess(n);
          return;
        }
      } else if (gtab === "word" && wordGame.active && words <= 2) {
        const ch = Hangman.parse(text);
        if (ch !== null) {
          addMessage("user", text);
          openDock("word");
          playLetter(ch);
          return;
        }
      }
    }
    if (dock.tab === "rps" && words === 1) {
      const mv = RPS.parse(text);
      if (mv) {
        addMessage("user", text);
        openDock("rps");
        playRps(mv);
        return;
      }
    }
  }

  Speaker.stop();           // stop talking the moment the user starts typing
  addMessage("user", text);
  input.value = "";
  autosize();
  busy = true;
  setSendDisabled(true);
  showTyping();
  setFaceState("thinking");

  let reply = "";
  let action = null;

  try {
    if (text.startsWith("/")) {
      hideTyping();
      const r = handleCommand(text);
      reply = r.reply;
      action = r.action;
      if (r.voice_on !== undefined) setVoiceUI(r.voice_on);
      if (reply) addMessage("aqua", reply);
    } else if (sBrain.isExit(text)) {
      hideTyping();
      reply = forAudience(sBrain.farewell());
      sMem.addExchange(text, reply);
      sMem.save();
      Speaker.say(reply);
      addMessage("aqua", reply);
      action = "quit";
    } else if (smart.on && bridge) {
      sBrain.learnFrom(text);  // she still learns, even with an OpenAI brain
      try {
        hideTyping();
        reply = await streamSmartReply(text);   // speaks sentence-by-sentence
        sMem.addExchange(text, reply);
        sMem.save();
      } catch (e) {
        if (String(e && e.message).includes("no-key")) {
          smart.on = false;
          updateBrainStatus();
        }
        toast("OpenAI hiccup — I'll use my built-in brain this once.");
        reply = forAudience(sBrain.respond(text));
        sMem.addExchange(text, reply);
        sMem.save();
        Speaker.say(reply);
        addMessage("aqua", reply);
      }
    } else {
      hideTyping();
      reply = forAudience(sBrain.respond(text));
      sMem.addExchange(text, reply);
      sMem.save();
      Speaker.say(reply);
      addMessage("aqua", reply);
    }
  } catch (e) {
    console.error(e);
    hideTyping();
    reply = "Hmm, I had a little hiccup thinking about that. Try again?";
    addMessage("aqua", reply);
  }

  if (reply) logDayExchange(text, reply);

  // Angela's occasional pop quiz (conversational turns only, never goodbyes).
  if (quizCooldown > 0) quizCooldown -= 1;
  if (!text.startsWith("/") && action !== "quit" && isAngela() &&
      !pendingQuiz && quizCooldown <= 0 && reply && Math.random() < 0.35) {
    askQuiz();
  }

  if (action) handleAction(action);
  busy = false;
  setSendDisabled(false);
  if (!Speaker._speaking) setFaceState("idle");
}

/* Stream her OpenAI reply word-by-word into a live bubble, and start
   speaking each sentence as soon as it's complete — she responds sooner. */
function streamSmartReply(text) {
  return new Promise((resolve, reject) => {
    const sBrain = getSpeakerBrain();
    const sMem = getSpeakerMemory();
    const messages = [{ role: "system", content: sBrain.systemPrompt(audience()) }]
      .concat(sMem.historyForLLM())
      .concat([{ role: "user", content: text }]);

    const bubble = addMessage("aqua", "");
    let acc = "";
    let sentenceBuf = "";
    let spoke = false;
    let off = null;

    const flush = (finalize) => {
      // split off complete sentences (ending in . ! ? …), keep the tail buffered
      const parts = sentenceBuf.split(/(?<=[.!?…])\s+/);
      const complete = finalize ? parts : parts.slice(0, -1);
      sentenceBuf = finalize ? "" : (parts[parts.length - 1] || "");
      for (const s of complete) {
        const t = s.trim();
        if (t) { sayForAudience(t); spoke = true; }
      }
    };

    if (bridge.onChatChunk) {
      off = bridge.onChatChunk((delta) => {
        acc += delta;
        bubble.textContent = acc;
        scrollToBottom();
        sentenceBuf += delta;
        flush(false);
      });
    }

    bridge.chat({ messages, model: smart.model, stream: true })
      .then((res) => {
        if (off) off();
        const final = forAudience((res && res.reply) ? res.reply : acc);
        bubble.textContent = final || "Hmm, my brain came back empty. Try me again?";
        scrollToBottom();
        // Speak only what's left: the buffered tail we haven't said yet. If no
        // chunks came through at all (sentenceBuf empty), say the whole reply.
        const leftover = (sentenceBuf.trim() || (!spoke ? final : "")).trim();
        if (leftover) { sayForAudience(leftover); spoke = true; }
        resolve(final || "");
      })
      .catch((err) => {
        if (off) off();
        if (bubble.parentNode) bubble.remove();
        reject(err);
      });
  });
}

function handleAction(action) {
  switch (action) {
    case "show_profile": openPanel("profile"); break;
    case "show_voices": openPanel("voices"); break;
    case "show_help": openPanel("help"); break;
    case "show_settings": openPanel("settings"); break;
    case "show_pool": openPanel("pool"); break;
    case "show_truck": openPanel("truck"); break;
    case "show_journal": openPanel("journal"); break;
    case "show_people": openPanel("people"); break;
    case "toggle_handsfree": setHandsfree(!handsfreeOn); break;
    case "toggle_wake": setWake(!wakeOn); break;
    case "do_backup": exportMemory(); break;
    case "do_restore": restoreMemory(); break;
    case "reset_confirm": openResetModal(); break;
    case "quit":
      setTimeout(() => quitScreen(), 900);
      break;
  }
}

/* ---------------- commands ---------------- */
const HELP_TEXT = `Commands you can type anytime:
  /help            show this list
  /profile         see everything Aqua has learned about you
  /voice on|off    turn her voice on or off
  /voices          list the voices she can wear
  /voice <name>    switch voice (e.g.  /voice nova )
  /rate +10%       speak faster (+) or slower (-)
  /handsfree       toggle always-listening mode
  /wakeword        toggle the "Hey Aqua" wake word
  /name <name>     tell her your name
  /forget <word>   forget memories containing that word
  /pool            your pool setup (gallons & chlorine type)
  /pool set <gal>  e.g.  /pool set 15000
  /chem ph 8.2 7.5 chemistry math for a test
  /job add <text>  log a service job, /jobs to list, /job done <n>
  /customer add <t>  log a customer, /customers, /customer del <n>
  /weather set <city>  weather-aware pool tips for the day
  /remind in 20 min to check pH    set a reminder
  /timer 5         a quick timer (minutes)
  /reminders       list what's coming up
  /journal         her daily journal of your time together
  /people          enroll voices so she knows who's talking
  /whoami          who she thinks is on the mic right now
  /strict on|off   mic obeys ONLY enrolled voices (typing always works)
  /game            open the game side panel (separate from chat)
  /game chess|checkers|cf|rps|guess|word  jump straight to a game
  /move <cell>     tic-tac-toe move — top left, center, B2, or 1-9
  /rps <rock|paper|scissors>  throw a round
  /guess <number>  guess the number (starts a game if needed)
  /letter <x>      guess a letter in word guess
  /quiz [subject]  pop quiz! math, spelling, science, words, history
  /spanish on|off  she answers en español (crew-friendly)
  /pool-es         poolside Spanish cheat sheet
  /note <text>     jot a voice-note into today's journal
  /route           today's customer stops, in order
  /truck           truck view: route + jobs, big and touch-friendly
  /brain           which brain she's thinking with
  /settings        connect her OpenAI brain (API key)
  /backup          export her memory to a file
  /reset           wipe everything she knows (asks first)
  /quit            say goodbye and close

Tips:
  * Press Enter to send, Shift+Enter for a new line.
  * Tap the microphone to talk, or the headphones for hands-free.
  * Say "Hey Aqua" when the wake word is on.
  * Play on the game side (🎮) — tic-tac-toe, chess, checkers, connect four,
    rock-paper-scissors, guess-the-number, and word guess. Say your move
    while you chat ("top left", "e2 to e4", "column 4").
  * Everything she learns stays on your PC.`;

function handleCommand(line) {
  const idx = line.search(/\s/);
  const cmd = (idx === -1 ? line : line.slice(0, idx)).toLowerCase();
  const rest = idx === -1 ? "" : line.slice(idx + 1).trim();
  const out = { reply: "" };

  switch (cmd) {
    case "/help":
      out.reply = HELP_TEXT;
      out.action = "show_help";
      break;

    case "/profile":
      out.reply = "Here's everything I've learned about you — it's open in the panel.";
      out.action = "show_profile";
      break;

    case "/voices":
      out.reply = "Here are the voices I can wear — tap one to hear it.";
      out.action = "show_voices";
      break;

    case "/voice": {
      if (rest.toLowerCase() === "on" || rest.toLowerCase() === "off") {
        const on = rest.toLowerCase() === "on";
        Speaker.enabled = on;
        mem.data.voice_on = on;
        mem.save();
        out.reply = on ? "Voice is on." : "Voice is off.";
        out.voice_on = on;
        if (on) Speaker.say("Voice is back on. Missed me?");
      } else if (rest) {
        const q = rest.toLowerCase();
        const oa = OPENAI_VOICES.find(([id]) => id.toLowerCase() === q || id.toLowerCase().includes(q));
        if (oa) {
          mem.data.openai_voice = oa[0];
          mem.data.voice_engine = "openai";
          mem.save();
          out.reply = `Switched to ${oa[0]} — my OpenAI neural voice.`;
          Speaker.say("This is my new voice. What do you think?");
        } else {
          const voices = Speaker.loadVoices();
          const v = voices.find((x) =>
            (x.name || "").toLowerCase().includes(q) || (x.lang || "").toLowerCase().includes(q));
          if (v) {
            Speaker.voice = v;
            mem.data.voice_id = v.voiceURI || v.name;
            mem.data.voice_engine = "windows";
            mem.save();
            out.reply = `Switched to ${v.name}.`;
            Speaker.say("This is my new voice. What do you think?");
          } else {
            out.reply = `I couldn't find a voice matching "${rest}" — open the Voices panel to browse.`;
          }
        }
      } else {
        out.reply = `Voice is ${Speaker.enabled ? "on" : "off"}. Usage: /voice on|off  or  /voice <name>`;
      }
      break;
    }

    case "/rate": {
      const m = /^([+-])(\d+)%$/.exec(rest);
      if (m) {
        const pct = (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10);
        const rate = applyRate(pct);
        out.reply = `Speaking rate is now ${rateText(rate)}.`;
        Speaker.say("Let me know if this pace works for you.");
      } else {
        out.reply = `Current rate is ${rateText(mem.data.rate || 1.0)}. Usage: /rate +10% or /rate -10%`;
      }
      break;
    }

    case "/handsfree":
      out.reply = "Hands-free toggled.";
      out.action = "toggle_handsfree";
      break;

    case "/mute":
      Speaker.enabled = !Speaker.enabled;
      mem.data.voice_on = Speaker.enabled;
      mem.save();
      out.reply = `Voice ${Speaker.enabled ? "on" : "off"}.`;
      out.voice_on = Speaker.enabled;
      break;

    case "/name":
      if (rest) {
        mem.setName(rest);
        mem.save();
        out.reply = `Got it — ${mem.name}.`;
      } else {
        out.reply = "Usage: /name Robert";
      }
      break;

    case "/forget":
      if (!rest) {
        out.reply = "Usage: /forget fishing";
      } else {
        const removed = mem.forget(rest);
        mem.save();
        if (removed.length) {
          const items = removed.slice(0, 5).map((f) => `'${f.text}'`).join(", ");
          out.reply = `Done — I forgot ${removed.length} memor${removed.length === 1 ? "y" : "ies"}: ${items}.`;
        } else {
          out.reply = `I don't remember anything about '${rest}' anyway.`;
        }
      }
      break;

    case "/brain":
      out.reply = (smart.on
        ? `OpenAI brain — model ${smart.model}. I'm thinking with OpenAI, but I still learn and remember the same way.`
        : "Built-in local brain. Open Settings (⚙️) to connect my OpenAI brain with your API key.")
        + (mem.data.spanish ? " · 🇪🇸 Spanish mode is on." : "");
      break;

    case "/pool": {
      if (rest.toLowerCase().startsWith("set")) {
        const gal = parseInt(rest.replace(/^set\s*/i, "").replace(/[^\d]/g, ""), 10);
        if (!gal || gal <= 0) { out.reply = "Usage: /pool set 15000"; break; }
        mem.data.pool = mem.data.pool || Object.assign({}, Pool.DEFAULT_POOL);
        mem.data.pool.gallons = gal;
        mem.save();
        out.reply = `Pool set to ${gal.toLocaleString("en-US")} gallons. Now ask me for chemistry — /chem ph 8.2 7.5.`;
      } else if (rest.toLowerCase().startsWith("chlorine")) {
        const ct = rest.replace(/^chlorine\s*/i, "").trim().toLowerCase();
        const match = Pool.chlorineTypes.find(([id]) => ct === id || id.includes(ct) || ct.includes(id));
        mem.data.pool = mem.data.pool || Object.assign({}, Pool.DEFAULT_POOL);
        if (match) {
          mem.data.pool.chlorineType = match[0];
          mem.save();
          out.reply = `Chlorine source set to ${match[1]}.`;
        } else {
          out.reply = `Pick one: ${Pool.chlorineTypes.map(([id, l]) => l).join(", ")}.`;
        }
      } else {
        const pool = mem.data.pool || {};
        if (!pool.gallons) {
          out.reply = "No pool on file yet — /pool set 15000 to tell me the gallons.";
        } else {
          const ct = Pool.chlorineTypes.find(([id]) => id === pool.chlorineType) || [];
          out.reply = `Pool on file: ${pool.gallons.toLocaleString("en-US")} gallons, chlorine source ${ct[1] || pool.chlorineType}. Ready for chemistry — /chem ph 8.2 7.5.`;
        }
        out.action = "show_pool";
      }
      break;
    }

    case "/chem": {
      const parts = rest.split(/\s+/);
      const param = Pool.parseParam(parts[0]);
      if (!param) { out.reply = "Tell me the test: /chem ph 8.2 7.5 (I know fc, ph, ta, ch, cya, salt)."; break; }
      const spec = Pool.CHEM[param];
      const current = parseFloat(parts[1]);
      const target = parts[2] != null ? parseFloat(parts[2]) : spec.defaultTarget;
      if (!isFinite(current)) { out.reply = `Give me the reading, darlin' — /chem ${param} ${spec.min} ${spec.defaultTarget}`; break; }
      const pool = mem.data.pool || {};
      const res = Pool.recommendDose(param, current, target, pool.gallons, pool.chlorineType);
      out.reply = res.summary || res.error || "Hmm, I couldn't work that one out.";
      if (res.ok && pool.gallons) out.action = "show_pool";
      break;
    }

    case "/weather": {
      if (rest.toLowerCase().startsWith("set")) {
        const loc = rest.replace(/^set\s*/i, "").trim();
        if (!loc) { out.reply = "Usage: /weather set Dallas"; break; }
        mem.data.location = loc;
        mem.save();
        out.reply = `Location set to ${loc}. Fetching the forecast…`;
      } else {
        out.reply = mem.data.location ? `Checking the weather for ${mem.data.location}…` : "Tell me where first — /weather set Dallas";
      }
      out.action = "show_pool";
      break;
    }

    case "/job": {
      mem.data.tasks = mem.data.tasks || [];
      if (rest.toLowerCase().startsWith("add")) {
        const text = rest.replace(/^add\s*/i, "").trim();
        if (!text) { out.reply = "Usage: /job add check the Smiths' filter"; break; }
        const t = Tasks.add(mem.data.tasks, text);
        mem.save();
        out.reply = `Job logged: ${t.text}. That's ${Tasks.open(mem.data.tasks).length} open.`;
      } else if (rest.toLowerCase().startsWith("done")) {
        const n = parseInt(rest.replace(/^done\s*/i, "").replace(/[^\d]/g, ""), 10);
        const open = Tasks.open(mem.data.tasks);
        const t = open[n - 1];
        if (t) { Tasks.toggle(mem.data.tasks, t.id); mem.save(); out.reply = `Marked done: ${t.text}. Good work.`; }
        else { out.reply = "No such job — /jobs to see the list."; }
      } else if (rest.toLowerCase().startsWith("del") || rest.toLowerCase().startsWith("remove")) {
        const n = parseInt(rest.replace(/^(del|remove)\s*/i, "").replace(/[^\d]/g, ""), 10);
        const open = Tasks.open(mem.data.tasks);
        const t = open[n - 1];
        if (t) { Tasks.remove(mem.data.tasks, t.id); mem.save(); out.reply = `Removed: ${t.text}.`; }
        else { out.reply = "No such job — /jobs to see the list."; }
      } else {
        out.reply = "Usage: /job add <text>, /jobs, /job done <n>";
      }
      break;
    }

    case "/jobs": {
      const open = Tasks.open(mem.data.tasks || []);
      if (!open.length) { out.reply = "No open jobs, boss. Nice and quiet for once."; break; }
      const list = open.map((t, i) => `${i + 1}. ${t.text}`).join("\n");
      out.reply = `Open jobs (${open.length}):\n${list}`;
      out.action = "show_pool";
      break;
    }

    case "/customer": {
      mem.data.customers = mem.data.customers || [];
      if (rest.toLowerCase().startsWith("add")) {
        const text = rest.replace(/^add\s*/i, "").trim();
        if (!text) { out.reply = "Usage: /customer add Smith - 15k gal - sand filter"; break; }
        mem.data.customers.unshift({ id: "c" + Date.now() + Math.random().toString(36).slice(2, 5), text, date: new Date().toISOString() });
        mem.save();
        out.reply = `Customer added: ${text}.`;
      } else if (rest.toLowerCase().startsWith("del") || rest.toLowerCase().startsWith("remove")) {
        const n = parseInt(rest.replace(/^(del|remove)\s*/i, "").replace(/[^\d]/g, ""), 10);
        const c = mem.data.customers[n - 1];
        if (c) { mem.data.customers.splice(n - 1, 1); mem.save(); out.reply = `Removed: ${c.text}.`; }
        else { out.reply = "No such customer — /customers to list."; }
      } else {
        out.reply = "Usage: /customer add <name & details>, /customers, /customer del <n>";
      }
      break;
    }

    case "/customers": {
      const list = mem.data.customers || [];
      if (!list.length) { out.reply = "No customers on file yet — /customer add to log one."; break; }
      out.reply = `Customers (${list.length}):\n` + list.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
      out.action = "show_pool";
      break;
    }

    case "/remind": {
      const parsed = Tools.parseReminder(rest);
      if (!parsed) { out.reply = "I couldn't parse that. Try /remind in 20 minutes to check pH, or /remind at 15:30 check pH."; break; }
      mem.data.reminders = mem.data.reminders || [];
      const r = Reminders.add(mem.data.reminders, parsed);
      mem.save();
      out.reply = `You got it — I'll remind you to ${r.message} ${whenText(r.at)}.`;
      break;
    }

    case "/timer": {
      const parsed = Tools.parseReminder("timer " + rest);
      if (!parsed) { out.reply = "Try /timer 5 for five minutes."; break; }
      mem.data.reminders = mem.data.reminders || [];
      const r = Reminders.add(mem.data.reminders, parsed);
      mem.save();
      out.reply = `Timer set — I'll holler in ${msText(r.at - Date.now())}.`;
      break;
    }

    case "/reminders": {
      const pending = Reminders.pending(mem.data.reminders || []);
      if (!pending.length) { out.reply = "Nothing on the books, boss."; break; }
      const list = pending.map((r) => `• ${r.message} — ${whenText(r.at)}`).join("\n");
      out.reply = `Coming up:\n${list}`;
      break;
    }

    case "/wakeword":
      out.reply = "Wake word toggled.";
      out.action = "toggle_wake";
      break;

    case "/backup":
      out.reply = "Exporting her memory…";
      out.action = "do_backup";
      break;

    case "/restore":
      out.reply = "Pick a memory backup to load.";
      out.action = "do_restore";
      break;

    case "/journal":
      out.reply = "Here's our journal.";
      out.action = "show_journal";
      break;

    case "/people":
      out.reply = "Here's who I can recognize — record a voice for each person.";
      out.action = "show_people";
      break;

    case "/whoami": {
      const name = speakerName();
      if (name) {
        out.reply = `I'm talkin' with ${name} right now.`;
      } else {
        const enrolled = roster().filter((p) => p.ref);
        out.reply = enrolled.length
          ? "Not sure who's at the mic this turn — if it's someone I know, try again with less background noise."
          : "I haven't met any other voices yet — /people to enroll someone.";
      }
      break;
    }

    case "/strict": {
      if (rest.toLowerCase() === "on" || rest.toLowerCase() === "off") {
        const on = rest.toLowerCase() === "on";
        mem.data.strict_voices = on;
        mem.save();
        out.reply = on
          ? "Strict listening is on — the mic only obeys enrolled voices. Typing still always works."
          : "Strict listening is off — I'll answer any voice on the mic.";
      } else {
        out.reply = `Strict listening is ${strictVoices() ? "on" : "off"}. Usage: /strict on|off`;
      }
      break;
    }

    case "/game":
    case "/tictactoe":
    case "/ttt": {
      const arg = rest.toLowerCase();
      if (["easy", "medium", "hard"].includes(arg)) {
        startGame(arg);
        out.reply = `New game — ${arg} difficulty. You're X, boss.`;
      } else if (arg === "reset") {
        mem.data.gameScore = { player: 0, aqua: 0, tie: 0 };
        mem.save();
        out.reply = "Score wiped — fresh slate.";
        if (dock.tab === "ttt") renderDock();
      } else if (["rps", "rock", "paper", "scissors"].includes(arg)) {
        openDock("rps");
        out.reply = "Rock-paper-scissors is up on the game side — tap your throw, or /rps rock.";
      } else if (["guess", "number", "guess the number"].includes(arg)) {
        if (!guessGame.active) startGuessGame();
        else openDock("guess");
        out.reply = "Guess-the-number is up on the game side — I'm thinking of a number 1 to 100.";
      } else if (["word", "hangman", "word guess"].includes(arg)) {
        if (!wordGame.active) startWordGame();
        else openDock("word");
        out.reply = "Word guess is up on the game side — guess letters one at a time.";
      } else if (["cf", "connect", "connect four", "connect4", "four"].includes(arg)) {
        if (!cfGame.active) startCfGame();
        else openDock("cf");
        out.reply = "Connect Four is up on the game side — you're red. Say “column 4”.";
      } else if (["checkers", "draughts", "checker"].includes(arg)) {
        if (!checkGame.active) startCheckersGame();
        else openDock("checkers");
        out.reply = "Checkers is up on the game side — you're red. Tap a piece, then a square — or say “c3 to d4”.";
      } else if (["chess"].includes(arg)) {
        if (!chessGame.active) startChessGame();
        else openDock("chess");
        out.reply = "Chess is up on the game side — you're white. Tap a piece, then a square — or say “e2 to e4”.";
      } else {
        if (!game.active) startGame();
        else openDock("ttt");
        out.reply = "The game side is open — tic-tac-toe, chess, checkers, connect four, rock-paper-scissors, guess-the-number, and word guess.";
      }
      break;
    }

    case "/move": {
      const idx = TicTacToe.parseMove(rest);
      if (idx === null) { out.reply = "Tell me where — try 'top left', 'center', 'B2', or a number 1-9."; break; }
      if (!game.active) { out.reply = "No game going — /game to start one."; break; }
      openDock("ttt");
      playMoveAt(idx);
      out.reply = "";
      break;
    }

    case "/rps": {
      const mv = RPS.parse(rest);
      if (!mv) { out.reply = "Throw one: /rps rock, /rps paper, or /rps scissors."; break; }
      openDock("rps");
      playRps(mv);
      out.reply = "";
      break;
    }

    case "/guess": {
      const n = GuessNumber.parse(rest);
      if (n === null) { out.reply = "Give me a number — /guess 42."; break; }
      if (!guessGame.active) startGuessGame();
      else openDock("guess");
      playGuess(n);
      out.reply = "";
      break;
    }

    case "/letter": {
      const ch = Hangman.parse(rest);
      if (!ch) { out.reply = "Guess one letter — /letter e."; break; }
      if (!wordGame.active) startWordGame();
      else openDock("word");
      playLetter(ch);
      out.reply = "";
      break;
    }

    case "/quiz": {
      askQuiz(true, quizSubject(rest));
      out.reply = "";
      break;
    }

    case "/spanish":
    case "/espanol": {
      if (rest.toLowerCase() === "on" || rest.toLowerCase() === "off") {
        const on = rest.toLowerCase() === "on";
        mem.data.spanish = on;
        mem.save();
        out.reply = on
          ? "¡Órale! Spanish mode is on — te contesto en español. (Shines brightest with the OpenAI brain.)"
          : "Spanish mode is off — back to Texas English, y'all.";
      } else {
        out.reply = `Spanish mode is ${mem.data.spanish ? "on" : "off"}. Usage: /spanish on|off — or /pool-es for the cheat sheet.`;
      }
      break;
    }

    case "/pool-es":
    case "/espanol-cheat":
      out.reply = POOL_ES;
      break;

    case "/note": {
      if (!rest) {
        pendingNote = true;
        out.reply = "You got it — what should I jot down?";
      } else {
        logDayExchange("(note to self)", `📝 ${rest}`);
        mem.save();
        out.reply = "Jotted down — it's in today's journal.";
      }
      break;
    }

    case "/route": {
      const arg = rest.trim();
      if (/^addc?\s+\d+$/i.test(arg)) {
        const n = parseInt(arg.replace(/^addc?\s+/i, ""), 10);
        const c = (mem.data.customers || [])[n - 1];
        if (!c) { out.reply = "No such customer — /customers to see the numbers."; break; }
        routeList().push({ id: "r" + Date.now().toString(36), text: c.text });
        mem.save();
        out.reply = `Stop ${routeList().length}: ${c.text}.`;
      } else if (/^add\s+/i.test(arg)) {
        const text = arg.replace(/^add\s+/i, "").trim();
        if (!text) { out.reply = "Usage: /route add Smith - filter clean"; break; }
        routeList().push({ id: "r" + Date.now().toString(36), text });
        mem.save();
        out.reply = `Stop ${routeList().length}: ${text}.`;
      } else if (/^done\s+\d+$/i.test(arg)) {
        const n = parseInt(arg.replace(/^done\s+/i, ""), 10);
        const stop = routeList()[n - 1];
        if (!stop) { out.reply = "No such stop — /route to see the list."; break; }
        toggleRouteDone(stop.id);
        out.reply = `${routeDoneSet().ids.includes(stop.id) ? "Checked off" : "Reopened"}: ${stop.text}.`;
      } else if (arg.toLowerCase() === "clear") {
        mem.data.route = [];
        mem.save();
        out.reply = "Route cleared — fresh road ahead.";
      } else if (arg) {
        out.reply = "Usage: /route, /route add <stop>, /route addc <customer #>, /route done <n>, /route clear";
      } else {
        out.reply = routeText();
      }
      break;
    }

    case "/truck":
      out.reply = "Truck view is open — route and jobs, big and touch-friendly.";
      out.action = "show_truck";
      break;

    case "/update":
      if (bridge && bridge.installUpdate) { bridge.installUpdate(); out.reply = "Installing the update…"; }
      else { out.reply = "No update waiting."; }
      break;

    case "/settings":
      out.reply = "Settings are open — you can connect my OpenAI brain there.";
      out.action = "show_settings";
      break;

    case "/reset":
      out.reply = "Reset requested.";
      out.action = "reset_confirm";
      break;

    case "/quit":
    case "/exit":
    case "/bye":
      out.reply = brain.farewell();
      out.action = "quit";
      break;

    default:
      out.reply = "I don't know that one — open Help (❓) for the list.";
  }
  return out;
}

/* ---------------- voice input (Whisper) ---------------- */
let micStream = null;
let micRecorder = null;
let micTimer = null;
let micChunks = [];
let micOnStop = null;

function micMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

btnMic.addEventListener("click", () => {
  if (recording) { stopRecordingEarly(); return; }
  if (busy) return;
  recordOnce().then((res) => {
    if (!res) return;
    if (res.text) handleUserText(res.text, res.speaker);
    else if (res.message) toast(res.message);
  });
});

async function recordOnce() {
  if (busy || recording) return null;
  if (!bridge) return { message: "Open Aqua as the desktop app to use the microphone." };
  const cfg = await bridge.getConfig();
  if (!cfg.hasKey) {
    toast("Add your OpenAI key (⚙️ Settings) to use the microphone.");
    return null;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    return { message: "Microphone unavailable or blocked — you can still type." };
  }

  const mimeType = micMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  micRecorder = rec;
  micChunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) micChunks.push(e.data); };

  recording = true;
  btnMic.classList.add("listening");
  btnMic.title = "Listening… (tap to stop)";

  const stopped = new Promise((resolve) => { micOnStop = resolve; });
  rec.onstop = () => { if (micOnStop) { micOnStop(); micOnStop = null; } };

  rec.start(250);
  setupSilenceStop(stream).catch(() => {});          // best-effort auto-stop
  micTimer = setTimeout(() => { if (recording) stopRecordingEarly(); }, 30000);

  await stopped;

  recording = false;
  micRecorder = null;
  clearTimeout(micTimer);
  btnMic.classList.remove("listening");
  btnMic.title = "Talk with your voice";
  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(micChunks, { type: rec.mimeType || mimeType || "audio/webm" });
  const audio = await blob.arrayBuffer();
  const mime = rec.mimeType || mimeType || "audio/webm";
  try {
    // If people are enrolled, ask OpenAI who's talking (and transcribe in one go).
    const people = roster().filter((p) => p && p.name && p.ref);
    if (people.length && bridge.identifySpeaker) {
      let res;
      try {
        res = await bridge.identifySpeaker(audio, mime, people);
      } catch (e) {
        console.error(e);
        // Speaker matching hiccup — in strict mode we can't verify who's
        // talking, so we don't act on it. Otherwise fall back to plain words.
        if (strictVoices()) {
          return { message: "I couldn't verify who's talking just now — try again, or type to me.", gated: true };
        }
        const fb = await bridge.transcribe(audio, mime);
        if (fb.text) return { text: fb.text };
        return { message: "I didn't catch that — try again, or just type." };
      }
      if (res.text) {
        if (!res.speaker && strictVoices()) return { message: STRANGER_VOICE_MSG, gated: true };
        return { text: res.text, speaker: res.speaker };
      }
      return { message: "I didn't catch that — try again, or just type." };
    }
    const res = await bridge.transcribe(audio, mime);
    if (res.text) return { text: res.text };
    return { message: "I didn't catch that — try again, or just type." };
  } catch (e) {
    console.error(e);
    return { message: "Couldn't transcribe — check your API key and internet." };
  }
}

function stopRecordingEarly() {
  if (recording && micRecorder && micRecorder.state !== "inactive") {
    try { micRecorder.stop(); } catch (e) {}
  }
}

async function setupSilenceStop(stream) {
  let ctx;
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let speechSeen = false;
    let silentMs = 0;
    const startedAt = Date.now();
    const check = () => {
      if (!recording || !micRecorder || micRecorder.state === "inactive") { if (ctx) ctx.close(); return; }
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      if (rms > 0.05) { speechSeen = true; silentMs = 0; }
      else if (speechSeen) {
        silentMs += 200;
        // Give a real pause (1.6s) before stopping, and never stop before
        // ~1.2s of recording so short clips aren't clipped mid-word.
        if (silentMs >= 1600 && Date.now() - startedAt > 1200) {
          stopRecordingEarly();
          ctx.close();
          return;
        }
      }
      setTimeout(check, 200);
    };
    check();
  } catch (e) { /* silence detection is optional */ }
}

/* ---------------- hands-free ---------------- */
btnHandsfree.addEventListener("click", () => setHandsfree(!handsfreeOn));

function setHandsfree(on) {
  handsfreeOn = on;
  btnHandsfree.classList.toggle("active", on);
  btnHandsfree.title = on ? "Hands-free listening is ON (say 'stop listening')" : "Hands-free listening";
  if (on) {
    if (wakeOn) setWake(false);
    if (!bridge) { toast("Open Aqua as the desktop app to use hands-free."); handsfreeOn = false; btnHandsfree.classList.remove("active"); return; }
    toast("Hands-free on — just talk. Say “stop listening” to pause.");
    handsfreeLoop();
  }
}

/* ---------------- wake word ("Hey Aqua") ---------------- */
function wakeWordAvailable() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function setWake(on) {
  wakeOn = on;
  if (!on) {
    if (wakeRec) { try { wakeRec.abort(); } catch (e) {} wakeRec = null; }
    return;
  }
  if (handsfreeOn) setHandsfree(false);
  if (!wakeWordAvailable()) {
    toast("Wake word isn't supported here — use hands-free instead.");
    wakeOn = false;
    return;
  }
  toast("Wake word on — say “Hey Aqua” anytime.");
  startWakeLoop();
}

function startWakeLoop() {
  if (!wakeOn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec;
  try {
    rec = new SR();
  } catch (e) {
    toast("Wake word couldn't start.");
    setWake(false);
    return;
  }
  wakeRec = rec;
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = (e.results[i][0].transcript || "").toLowerCase().trim();
      if (/\bhey aqua\b/.test(t) || /^aqua\b/.test(t)) {
        wakeRec = null;                    // so onend doesn't auto-restart
        try { rec.stop(); } catch (err) {}
        handleWakeTrigger();
        return;
      }
    }
  };

  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      toast("Mic blocked for the wake word.");
      setWake(false);
    } else if (e.error === "network") {
      toast("Wake word needs an internet connection.");
      setWake(false);
    }
  };

  rec.onend = () => {
    if (wakeOn && wakeRec === rec) {
      wakeRec = null;
      setTimeout(startWakeLoop, 400);
    }
  };

  try { rec.start(); } catch (e) { toast("Wake word couldn't start."); setWake(false); }
}

async function handleWakeTrigger() {
  if (wakeBusy || busy) { if (wakeOn) startWakeLoop(); return; }
  wakeBusy = true;
  toast("Yes, boss?");
  const res = await recordOnce();
  if (res && res.text) {
    const low = res.text.toLowerCase().replace(/[.,!?]/g, "").trim();
    if (["stop listening", "stop wake word", "wake word off", "stop wake"].includes(low)) {
      setWake(false);
      toast("Wake word off.");
    } else {
      await handleUserText(res.text, res.speaker);
    }
  } else if (res && res.gated) {
    toast(res.message, 4000);
  }
  wakeBusy = false;
  if (wakeOn) startWakeLoop();
}

async function handsfreeLoop() {
  while (handsfreeOn && !busy) {
    const res = await recordOnce();
    if (!handsfreeOn) break;
    if (res && res.text) {
      const low = res.text.toLowerCase().replace(/[.,!?]/g, "").trim();
      if (["stop listening", "stop hands free", "hands free off", "stop listening mode"].includes(low)) {
        setHandsfree(false);
        toast("Hands-free off.");
        break;
      }
      await handleUserText(res.text, res.speaker);
      await sleep(900);
    } else if (res && res.message) {
      await sleep(600);
    } else {
      await sleep(400);
    }
  }
}

/* ---------------- voice on/off ---------------- */
function setVoiceUI(on) {
  btnVoice.textContent = on ? "🔊" : "🔇";
  btnVoice.classList.toggle("muted", !on);
  btnVoice.title = on ? "Turn her voice off" : "Turn her voice on";
}

btnVoice.addEventListener("click", () => {
  Speaker.enabled = !Speaker.enabled;
  mem.data.voice_on = Speaker.enabled;
  mem.save();
  setVoiceUI(Speaker.enabled);
  if (Speaker.enabled) Speaker.say("Voice is back on. Missed me?");
});

/* ---------------- brain status ---------------- */
function updateBrainStatus() {
  brainStatus.textContent = smart.on
    ? `OpenAI brain · ${smart.model}`
    : "Built-in brain · add a key in ⚙️ Settings";
}

async function refreshSmart() {
  if (!bridge) { smart.on = false; updateBrainStatus(); return; }
  try {
    const cfg = await bridge.getConfig();
    smart.on = !!cfg.hasKey;
    smart.model = cfg.model || "gpt-4o-mini";
  } catch (e) {
    smart.on = false;
  }
  updateBrainStatus();
}

/* ---------------- reminders & notifications ---------------- */
function checkReminders() {
  const list = mem.data.reminders || [];
  const due = Reminders.due(list, Date.now());
  for (const r of due) {
    r.fired = true;
    const msg = r.message || "Reminder";
    addMessage("aqua", `⏰ ${msg}`);
    Speaker.say(msg);
    toast(`⏰ ${msg}`, 6000);
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification("Aqua", { body: msg }); } catch (e) {}
    }
  }
  if (due.length) mem.save();
}

function exportMemory() {
  try {
    const blob = new Blob([JSON.stringify(mem.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aqua-memory.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Memory exported to aqua-memory.json");
  } catch (e) {
    console.error(e);
    toast("Couldn't export.");
  }
}

function restoreMemory() {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json,.json";
  fileInput.onchange = () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.facts)) {
          toast("That's not a valid Aqua memory file.");
          return;
        }
        mem.data = parsed;
        for (const k of ["facts", "asked_questions", "qa", "recent_exchanges"]) {
          if (!Array.isArray(mem.data[k])) mem.data[k] = [];
        }
        mem.save();
        brain = new Brain(mem);
        chatScroll.innerHTML = "";
        addMessage("aqua", brain.greeting());
        toast("Memory restored — she remembers again.");
      } catch (e) {
        console.error(e);
        toast("Couldn't read that file.");
      }
    };
    reader.readAsText(file);
  };
  fileInput.click();
}

/* ---------------- daily journal ---------------- */
function logDayExchange(u, a) {
  const today = Journal.todayKey();
  if (!mem.data.daily || mem.data.daily.date !== today) {
    mem.data.daily = { date: today, lines: [] };
  }
  mem.data.daily.lines.push({ u, a, who: speakerName() });
  if (mem.data.daily.lines.length > 500) mem.data.daily.lines = mem.data.daily.lines.slice(-500);
  mem.save();   // persist as we go so a closed window can't lose the day
}

async function journalizeDay(date, lines) {
  // Name the speaker on each line so the entry reads "Robert: …" naturally.
  const tagged = (lines || []).map((l) => ({
    u: l && l.who ? `${l.who}: ${l.u}` : (l && l.u),
    a: l && l.a,
  }));
  const dayFacts = mem.allFacts().filter((f) => String(f.date || "").slice(0, 10) === date);
  if (smart.on && bridge) {
    try {
      const prompt = Journal.buildJournalPrompt({ date, transcript: tagged, name: mem.name });
      const res = await bridge.chat({
        messages: [{ role: "system", content: "You are Aqua." }, { role: "user", content: prompt }],
        model: smart.model,
      });
      const text = (res && res.reply || "").trim();
      if (text) return { date, text };
    } catch (e) { /* fall through to the local summary */ }
  }
  return { date, text: Journal.summarizeLocal({ lines: tagged, facts: dayFacts, name: mem.name }) };
}

async function maybeJournalize() {
  const d = mem.data.daily;
  const today = Journal.todayKey();
  if (d && d.date && d.date !== today && d.lines && d.lines.length) {
    const entry = await journalizeDay(d.date, d.lines);
    if (entry && entry.text) {
      mem.data.journal = mem.data.journal || [];
      mem.data.journal = mem.data.journal.filter((e) => e.date !== d.date);
      mem.data.journal.unshift(entry);
    }
  }
  mem.data.daily = { date: today, lines: [] };
  mem.save();
}

function renderJournal() {
  panelTitle.textContent = "Our journal";
  const entries = mem.data.journal || [];
  let html = `<div class="panel-section"><h3>Daily journal</h3>`;
  if (!entries.length) {
    html += `<div class="hint">No entries yet — at the end of each day I'll jot down what we talked about. Or summarize right now.</div>`;
  }
  for (const e of entries) {
    html += `<div class="journal-entry"><div class="journal-date">${escapeHtml(e.date)}</div><div class="journal-text">${escapeHtml(e.text)}</div></div>`;
  }
  html += `</div>
    <div class="panel-section">
      <button id="journal-now" class="btn-solid">Summarize today now</button>
      <p class="hint" style="margin-top:10px;">Entries live on your PC with the rest of her memory.</p>
    </div>`;
  panelBody.innerHTML = html;
  const b = $("journal-now");
  if (b) b.addEventListener("click", async () => {
    const today = Journal.todayKey();
    const lines = (mem.data.daily && mem.data.daily.lines) || [];
    if (!lines.length) { toast("Nothing to summarize yet — talk to me first!"); return; }
    toast("Writing today's entry…");
    const entry = await journalizeDay(today, lines);
    if (entry && entry.text) {
      mem.data.journal = mem.data.journal || [];
      mem.data.journal = mem.data.journal.filter((e) => e.date !== today);
      mem.data.journal.unshift(entry);
      mem.save();
      renderJournal();
    }
  });
}

/* ---------------- weather (Open-Meteo, free, no key) ---------------- */
async function loadWeather(city, outEl) {
  outEl.textContent = "Checking the forecast…";
  try {
    const gres = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    const gj = await gres.json();
    if (!gj.results || !gj.results.length) { outEl.textContent = "Couldn't find that place — try a nearby city."; return; }
    const { latitude, longitude, name } = gj.results[0];
    const fres = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max,uv_index_max` +
      `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
    );
    const fj = await fres.json();
    const desc = Weather.describe(fj.daily);
    const tips = Weather.buildTips(fj.daily);
    outEl.innerHTML = `<b>${escapeHtml(name)}:</b> ${escapeHtml(desc)}<br>` +
      tips.map((t) => `• ${escapeHtml(t)}`).join("<br>");
  } catch (e) {
    outEl.textContent = "Couldn't reach the weather service — check your internet.";
  }
}

/* ---------------- people (voice enrollment) ---------------- */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* Record a short clip for speaker enrollment — separate from the chat mic. */
function captureClip(seconds = 6) {
  return new Promise(async (resolve, reject) => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      reject(new Error("Microphone unavailable or blocked."));
      return;
    }
    const mimeType = micMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      const buf = await blob.arrayBuffer();
      resolve({ audio: buf, mime: rec.mimeType || mimeType || "audio/webm" });
    };
    rec.onerror = () => reject(new Error("Recording failed."));
    rec.start(250);
    setTimeout(() => { try { if (rec.state !== "inactive") rec.stop(); } catch (e) {} }, seconds * 1000);
  });
}

function personKidSafe(p) {
  if (!p) return false;
  if (p.kid === true) return true;
  const age = Number(p.age);
  return Number.isFinite(age) && age > 0 && age < 13;
}

function renderPeople() {
  panelTitle.textContent = "People & voices";
  const people = roster();

  let html = `
    <div class="panel-section">
      <h3>Who she can recognize</h3>
      <p class="hint">Record a few seconds of each person talking and Aqua will know who's at the mic — and remember each of you separately. Handles up to 4 voices, matched by OpenAI with your key.</p>`;

  if (!people.length) html += `<div class="hint">Nobody enrolled yet — add a voice below.</div>`;
  for (const p of people) {
    const badges = [];
    if (!p.ref) badges.push("no voice yet");
    if (p.age) badges.push(`age ${escapeHtml(String(p.age))}`);
    if (personKidSafe(p)) badges.push("🧒 kid-safe");
    if (String(p.name || "").toLowerCase() === "rhonda hood") badges.push("🇨🇦");
    if (String(p.name || "").toLowerCase() === "angela") badges.push("📚 quizzes");
    html += `
      <div class="cust-row">
        <span class="job-num">${escapeHtml(String(p.name || "?").slice(0, 1).toUpperCase())}</span>
        <span class="cust-text"><b>${escapeHtml(p.name)}</b>${badges.length ? ` <span class="hint">(${badges.join(" · ")})</span>` : ""}</span>
        <input class="mini-age person-age" data-id="${escapeHtml(p.id)}" type="number" min="1" max="120"
          placeholder="age" value="${escapeHtml(String(p.age || ""))}" title="Age — under 13 turns on kid-safe talk">
        <button class="mini-btn person-kid${p.kid ? " on" : ""}" data-id="${escapeHtml(p.id)}" title="Toggle kid-safe talk">🧒</button>
        <button class="mini-btn person-rerecord" data-id="${escapeHtml(p.id)}" title="Re-record voice">🎙️</button>
        <button class="mini-btn person-del" data-id="${escapeHtml(p.id)}" title="Remove">✕</button>
      </div>`;
  }

  html += `</div>
    <div class="panel-section">
      <h3>Listening</h3>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;">
        <input type="checkbox" id="strict-voices" ${strictVoices() ? "checked" : ""} style="accent-color:#46d7ff;width:16px;height:16px;">
        Only listen to enrolled voices
      </label>
      <p class="hint" style="margin-top:8px;">When on, the mic ignores anyone she doesn't recognize. Typing always works. (/strict on|off)</p>
    </div>
    <div class="panel-section">
      <h3>Add someone</h3>
      <div style="display:flex;gap:8px;">
        <input id="person-name" class="field-input" placeholder="Name, e.g. Robert">
        <input id="person-age" class="field-input" type="number" min="1" max="120" placeholder="Age" style="max-width:80px;">
        <button id="person-record" class="btn-solid">Record voice</button>
      </div>
      <p class="hint" id="person-status" style="margin-top:10px;">Type a name (and age for kids), tap <b>Record voice</b>, then talk for a few seconds.</p>
      <p class="hint" style="margin-top:6px;">The clip stays on this PC and is only sent to OpenAI to match who's speaking.</p>
    </div>`;
  panelBody.innerHTML = html;

  const nameInput = $("person-name");
  const ageInput = $("person-age");
  const status = $("person-status");

  const strictBox = $("strict-voices");
  if (strictBox) strictBox.addEventListener("change", () => {
    mem.data.strict_voices = !!strictBox.checked;
    mem.save();
    toast(strictBox.checked ? "Strict listening on — enrolled voices only." : "Strict listening off.");
  });

  $("person-record").addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) { toast("Give me a name first, darlin'."); return; }
    let person = personByName(name);
    if (!person && roster().length >= 4) { toast("I can keep up to 4 voices straight."); return; }
    if (!bridge || !smart.on) { toast("Add your OpenAI key first (⚙️ Settings)."); return; }
    status.textContent = `Listening… talk for a few seconds, ${name}.`;
    try {
      const { audio, mime } = await captureClip(6);
      status.textContent = "Saving your voice…";
      if (!person) {
        person = { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, created: new Date().toISOString() };
        mem.data.people = mem.data.people || [];
        mem.data.people.push(person);
      }
      person.name = name;
      const age = parseInt(ageInput.value, 10);
      if (Number.isFinite(age) && age > 0) person.age = age;
      person.ref = arrayBufferToBase64(audio);
      person.refMime = mime;
      mem.save();
      status.textContent = `Got ${name}'s voice — she'll know them now.`;
      renderPeople();
      updateSpeakerChip();
    } catch (e) {
      console.error(e);
      status.textContent = "Couldn't record — check the microphone permission.";
    }
  });

  panelBody.querySelectorAll(".person-age").forEach((inp) => inp.addEventListener("change", () => {
    const p = personById(inp.dataset.id);
    if (!p) return;
    const age = parseInt(inp.value, 10);
    if (Number.isFinite(age) && age > 0) p.age = age;
    else delete p.age;
    mem.save();
    renderPeople();
  }));

  panelBody.querySelectorAll(".person-kid").forEach((b) => b.addEventListener("click", () => {
    const p = personById(b.dataset.id);
    if (!p) return;
    p.kid = p.kid ? undefined : true;
    mem.save();
    renderPeople();
    toast(p.kid ? `Kid-safe talk on for ${p.name}.` : `Kid-safe talk off for ${p.name}.`);
  }));

  panelBody.querySelectorAll(".person-rerecord").forEach((b) => b.addEventListener("click", () => {
    const p = personById(b.dataset.id);
    if (p) { nameInput.value = p.name; if (p.age) ageInput.value = p.age; $("person-record").click(); }
  }));

  panelBody.querySelectorAll(".person-del").forEach((b) => b.addEventListener("click", () => {
    mem.data.people = roster().filter((p) => p.id !== b.dataset.id);
    personMemories.delete(b.dataset.id);
    if (activePersonId === b.dataset.id) setActiveSpeaker(null);
    mem.save();
    renderPeople();
    updateSpeakerChip();
  }));
}

/* ---------------- game side dock (games live beside the chat) ---------------- */
function dockOpen() {
  const d = $("game-dock");
  return !!d && !d.classList.contains("hidden");
}

function openDock(tab) {
  if (tab) dock.tab = tab;
  const d = $("game-dock");
  if (d) d.classList.remove("hidden");
  renderDock();
}

function closeDock() {
  const d = $("game-dock");
  if (d) d.classList.add("hidden");
}

function selectGameTab(tab) {
  dock.tab = tab;
  renderDock();
}

function renderDock() {
  const tabs = $("dock-tabs");
  if (tabs && tabs.querySelectorAll) {
    const btns = tabs.querySelectorAll(".dock-tab");
    if (btns && btns.forEach) btns.forEach((b) => b.classList.toggle("on", !!(b.dataset && b.dataset.gtab === dock.tab)));
  }
  const body = $("dock-body");
  if (body) body.innerHTML = "";
  if (dock.tab === "ttt") buildGameBoard();
  else if (dock.tab === "rps") buildRpsBoard();
  else if (dock.tab === "guess") buildGuessBoard();
  else if (dock.tab === "word") buildWordBoard();
  else if (dock.tab === "cf") buildCfBoard();
  else if (dock.tab === "checkers") buildCheckersBoard();
  else if (dock.tab === "chess") buildChessBoard();
}

function dockTitleEl(text) {
  const title = document.createElement("div");
  title.className = "game-title";
  title.textContent = text;
  return title;
}

/* ---------------- tic-tac-toe (side dock) ---------------- */
function gameScore() {
  if (!mem.data.gameScore) mem.data.gameScore = { player: 0, aqua: 0, tie: 0 };
  return mem.data.gameScore;
}

function startGame(difficulty) {
  if (difficulty) {
    mem.data.gameDifficulty = difficulty;
    mem.save();
  }
  game.difficulty = mem.data.gameDifficulty || "medium";
  game.active = true;
  game.board = Array(9).fill(null);
  game.player = "X";
  game.aqua = "O";
  game.turn = "X";
  if (game.aiTimer) { clearTimeout(game.aiTimer); game.aiTimer = null; }
  openDock("ttt");
  scrollToBottom();
  sayForAudience(isChildSpeaker()
    ? "Game on! You're X — you go first!"
    : "Game on. You're X, boss — make your move.");
}

function buildGameBoard() {
  const body = $("dock-body");
  if (!body) return;
  body.innerHTML = "";
  game.root = document.createElement("div");
  game.root.className = "game-bubble";

  game.root.appendChild(dockTitleEl("Tic-tac-toe"));

  const grid = document.createElement("div");
  grid.className = "ttt-grid";
  game.cells = [];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("button");
    cell.className = "ttt-cell";
    cell.dataset.i = String(i);
    cell.addEventListener("click", () => playMoveAt(i));
    grid.appendChild(cell);
    game.cells.push(cell);
  }
  game.root.appendChild(grid);

  game.status = document.createElement("div");
  game.status.className = "game-status";
  game.root.appendChild(game.status);

  game.scoreLine = document.createElement("div");
  game.scoreLine.className = "game-score";
  game.root.appendChild(game.scoreLine);

  const actions = document.createElement("div");
  actions.className = "game-actions";
  const newBtn = document.createElement("button");
  newBtn.className = "mini-btn";
  newBtn.textContent = "New game";
  newBtn.addEventListener("click", () => startGame());
  actions.appendChild(newBtn);
  for (const d of ["easy", "medium", "hard"]) {
    const b = document.createElement("button");
    b.className = "mini-btn";
    b.textContent = d.charAt(0).toUpperCase() + d.slice(1);
    b.addEventListener("click", () => startGame(d));
    actions.appendChild(b);
  }
  game.root.appendChild(actions);

  body.appendChild(game.root);
  renderGameBoard();
}

function renderGameBoard() {
  if (!game.root) return;
  const w = TicTacToe.winner(game.board);
  const myTurn = game.turn === game.player;
  for (let i = 0; i < 9; i++) {
    const cell = game.cells[i];
    if (!cell) continue;
    cell.textContent = game.board[i] || "";
    cell.classList.toggle("x", game.board[i] === "X");
    cell.classList.toggle("o", game.board[i] === "O");
    cell.disabled = !!game.board[i] || !game.active || !myTurn;
  }
  let statusText;
  if (w === game.player) statusText = "You win, boss! 🎉";
  else if (w === game.aqua) statusText = "I win — run it back, darlin'?";
  else if (TicTacToe.isFull(game.board)) statusText = "Cat's game. Dead even.";
  else statusText = myTurn ? "Your move, boss." : "My turn… hold your horses.";
  game.status.textContent = statusText;

  const s = gameScore();
  game.scoreLine.textContent = `You ${s.player} · Aqua ${s.aqua} · Ties ${s.tie}`;
}

function playMoveAt(i) {
  if (!game.active || game.turn !== game.player) return;
  if (game.board[i]) return;
  game.board[i] = game.player;
  game.turn = game.aqua;
  renderGameBoard();

  const w = TicTacToe.winner(game.board);
  if (w) { endGame(w); return; }
  if (TicTacToe.isFull(game.board)) { endGame(null); return; }

  game.aiTimer = setTimeout(aiMove, 450 + Math.random() * 350);
}

function aiMove() {
  if (!game.active || game.turn !== game.aqua) return;
  const i = TicTacToe.bestMove(game.board, game.aqua, game.difficulty);
  if (i < 0) return;
  game.board[i] = game.aqua;
  game.turn = game.player;
  renderGameBoard();

  const w = TicTacToe.winner(game.board);
  if (w) { endGame(w); return; }
  if (TicTacToe.isFull(game.board)) { endGame(null); return; }
}

function endGame(w) {
  game.active = false;
  const s = gameScore();
  if (w === game.player) {
    s.player++;
    gameComment(["Well damn — you got me, boss.", "Ha! Okay, you earned that one.", "Alright, that one's yours. Don't get used to it."]);
  } else if (w === game.aqua) {
    s.aqua++;
    gameComment(["That's three in a row, darlin' — run it back?", "Read you like a pump schedule, boss.", "Hah! Better luck next round."]);
  } else {
    s.tie++;
    gameComment(["Cat's game. We're too evenly matched.", "A tie? Neither of us blinked.", "Dead even. Rematch?"]);
  }
  mem.save();
  renderGameBoard();
}

function gameComment(lines) {
  const line = lines[Math.floor(Math.random() * lines.length)];
  const out = forAudience(line);
  addMessage("aqua", out);
  Speaker.say(out);
}

/* ---------------- rock-paper-scissors (side dock) ---------------- */
let rpsLast = "";

function rpsScore() {
  if (!mem.data.rpsScore) mem.data.rpsScore = { player: 0, aqua: 0, tie: 0 };
  return mem.data.rpsScore;
}

function buildRpsBoard() {
  const body = $("dock-body");
  if (!body) return;
  body.innerHTML = "";
  const root = document.createElement("div");
  root.className = "game-bubble";
  root.appendChild(dockTitleEl("Rock-paper-scissors"));

  const row = document.createElement("div");
  row.className = "rps-row";
  for (const mv of RPS.MOVES) {
    const b = document.createElement("button");
    b.className = "rps-btn";
    b.textContent = RPS.EMOJI[mv];
    b.title = mv;
    b.addEventListener("click", () => playRps(mv));
    row.appendChild(b);
  }
  root.appendChild(row);

  const res = document.createElement("div");
  res.className = "rps-result";
  res.textContent = rpsLast || "Tap your throw — or just say rock, paper, or scissors.";
  root.appendChild(res);

  const s = rpsScore();
  const score = document.createElement("div");
  score.className = "game-score";
  score.textContent = `You ${s.player} · Aqua ${s.aqua} · Ties ${s.tie}`;
  root.appendChild(score);

  body.appendChild(root);
}

function playRps(mv) {
  if (!RPS.MOVES.includes(mv)) return;
  const aqua = RPS.randomMove();
  const res = RPS.result(mv, aqua);
  const s = rpsScore();
  if (res === "win") s.player++;
  else if (res === "lose") s.aqua++;
  else s.tie++;
  mem.save();
  rpsLast = res === "win"
    ? `You threw ${RPS.EMOJI[mv]} ${mv}, I threw ${RPS.EMOJI[aqua]} ${aqua} — you win!`
    : res === "lose"
      ? `You threw ${RPS.EMOJI[mv]} ${mv}, I threw ${RPS.EMOJI[aqua]} ${aqua} — I win this one!`
      : `We both threw ${RPS.EMOJI[mv]} — great minds! Tie.`;
  if (dockOpen() && dock.tab === "rps") renderDock();
  sayForAudience(res === "win" ? "Ha! You got me." : res === "lose" ? "I win this one!" : "A tie!");
}

/* ---------------- guess the number (side dock) ---------------- */
let guessFeedback = "";

function guessStats() {
  if (!mem.data.guessStats) mem.data.guessStats = { wins: 0, best: null };
  return mem.data.guessStats;
}

function startGuessGame() {
  guessGame.active = true;
  guessGame.state = GuessNumber.newGame(1, 100);
  guessFeedback = "I'm thinking of a number from 1 to 100. Take a guess!";
  openDock("guess");
  sayForAudience("I'm thinking of a number, 1 to 100. What's your guess?");
}

function buildGuessBoard() {
  const body = $("dock-body");
  if (!body) return;
  body.innerHTML = "";
  const root = document.createElement("div");
  root.className = "game-bubble";
  root.appendChild(dockTitleEl("Guess the number"));

  const fb = document.createElement("div");
  fb.className = "guess-feedback";
  fb.textContent = guessGame.active
    ? (guessFeedback || "Take a guess!")
    : "No game going — start one!";
  root.appendChild(fb);

  if (guessGame.active && guessGame.state) {
    const tries = document.createElement("div");
    tries.className = "game-score";
    tries.textContent = `Guesses so far: ${guessGame.state.attempts}`;
    root.appendChild(tries);
  }

  const row = document.createElement("div");
  row.className = "guess-row";
  const inp = document.createElement("input");
  inp.className = "field-input";
  inp.type = "number";
  inp.min = "1";
  inp.max = "100";
  inp.placeholder = "1–100";
  row.appendChild(inp);
  const go = document.createElement("button");
  go.className = "btn-solid";
  go.textContent = "Go";
  go.addEventListener("click", () => {
    const n = GuessNumber.parse(inp.value);
    if (n === null) { toast("Give me a number, darlin'."); return; }
    playGuess(n);
  });
  row.appendChild(go);
  root.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "game-actions";
  const newBtn = document.createElement("button");
  newBtn.className = "mini-btn";
  newBtn.textContent = "New game";
  newBtn.addEventListener("click", startGuessGame);
  actions.appendChild(newBtn);
  root.appendChild(actions);

  const st = guessStats();
  const stats = document.createElement("div");
  stats.className = "game-score";
  stats.textContent = st.wins
    ? `Wins: ${st.wins}${st.best ? ` · Best: ${st.best} ${st.best === 1 ? "try" : "tries"}` : ""}`
    : "No wins yet — I believe in you.";
  root.appendChild(stats);

  body.appendChild(root);
}

function playGuess(n) {
  if (!guessGame.active || !guessGame.state) return;
  const st = guessGame.state;
  const res = GuessNumber.guess(st, n);
  if (res === "win") {
    guessGame.active = false;
    const stats = guessStats();
    stats.wins += 1;
    if (!stats.best || st.attempts < stats.best) stats.best = st.attempts;
    mem.save();
    guessFeedback = `${n} is right! Got it in ${st.attempts} ${st.attempts === 1 ? "try" : "tries"}.`;
    gameComment([
      `🎉 ${n} — that's my number! Only ${st.attempts} ${st.attempts === 1 ? "try" : "tries"}.`,
      `🎉 You got it — ${n}! ${st.attempts} ${st.attempts === 1 ? "try" : "tries"}. Sharp!`,
    ]);
  } else if (res === "low") {
    guessFeedback = `${n} is too low — go higher.`;
    sayForAudience("Too low — go higher.");
  } else if (res === "high") {
    guessFeedback = `${n} is too high — go lower.`;
    sayForAudience("Too high — go lower.");
  }
  if (dockOpen() && dock.tab === "guess") renderDock();
}

/* ---------------- word guess (side dock) ---------------- */
let wordFeedback = "";

function wordStats() {
  if (!mem.data.wordStats) mem.data.wordStats = { wins: 0, losses: 0 };
  return mem.data.wordStats;
}

function startWordGame() {
  wordGame.active = true;
  wordGame.state = Hangman.newGame();
  wordFeedback = "Guess letters one at a time — 6 misses and I keep the word!";
  openDock("word");
  sayForAudience("New word! Guess a letter.");
}

function buildWordBoard() {
  const body = $("dock-body");
  if (!body) return;
  body.innerHTML = "";
  const root = document.createElement("div");
  root.className = "game-bubble";
  root.appendChild(dockTitleEl("Word guess"));

  const disp = document.createElement("div");
  disp.className = "word-display";
  disp.textContent = wordGame.active && wordGame.state ? Hangman.display(wordGame.state) : "—";
  root.appendChild(disp);

  const fb = document.createElement("div");
  fb.className = "guess-feedback";
  fb.textContent = wordGame.active ? (wordFeedback || "Guess a letter!") : "No game going — start one!";
  root.appendChild(fb);

  if (wordGame.active && wordGame.state) {
    const left = document.createElement("div");
    left.className = "game-score";
    left.textContent = `Misses left: ${wordGame.state.maxMisses - wordGame.state.misses}`;
    root.appendChild(left);

    const letters = document.createElement("div");
    letters.className = "word-letters";
    for (let c = 97; c <= 122; c++) {
      const ch = String.fromCharCode(c);
      const b = document.createElement("button");
      b.className = "word-letter";
      b.textContent = ch.toUpperCase();
      const used = wordGame.state.guessed.includes(ch);
      b.disabled = used || !wordGame.active;
      if (used && wordGame.state.word.includes(ch)) b.classList.add("hit");
      b.addEventListener("click", () => playLetter(ch));
      letters.appendChild(b);
    }
    root.appendChild(letters);
  }

  const actions = document.createElement("div");
  actions.className = "game-actions";
  const newBtn = document.createElement("button");
  newBtn.className = "mini-btn";
  newBtn.textContent = "New word";
  newBtn.addEventListener("click", startWordGame);
  actions.appendChild(newBtn);
  root.appendChild(actions);

  const st = wordStats();
  const stats = document.createElement("div");
  stats.className = "game-score";
  stats.textContent = `Words solved: ${st.wins} · Words kept: ${st.losses}`;
  root.appendChild(stats);

  body.appendChild(root);
}

function playLetter(ch) {
  if (!wordGame.active || !wordGame.state) return;
  const res = Hangman.guess(wordGame.state, ch);
  if (!res) return;
  if (res.already) {
    wordFeedback = `Already tried ${ch.toUpperCase()} — pick another.`;
  } else if (res.won) {
    wordGame.active = false;
    wordStats().wins += 1;
    mem.save();
    wordFeedback = `You got it — "${wordGame.state.word}"!`;
    gameComment([
      `🎉 You guessed my word: ${wordGame.state.word}! Brilliant.`,
      `🎉 "${wordGame.state.word}" — that's it! You're good at this.`,
    ]);
  } else if (res.lost) {
    wordGame.active = false;
    wordStats().losses += 1;
    mem.save();
    wordFeedback = `Out of guesses — my word was "${wordGame.state.word}".`;
    gameComment([
      `Out of guesses — my word was "${wordGame.state.word}". Run it back?`,
      `Tough one — it was "${wordGame.state.word}". New word?`,
    ]);
  } else if (res.correct) {
    wordFeedback = `Nice — ${ch.toUpperCase()} is in there!`;
    sayForAudience(`Nice, ${ch.toUpperCase()} is in there.`);
  } else {
    wordFeedback = `Nope — no ${ch.toUpperCase()}. ${res.missesLeft} ${res.missesLeft === 1 ? "miss" : "misses"} left.`;
    sayForAudience(`No ${ch.toUpperCase()}. ${res.missesLeft} left.`);
  }
  if (dockOpen() && dock.tab === "word") renderDock();
}

/* ---------------- shared dock helpers ---------------- */
function gameDifficulty() {
  return mem.data.gameDifficulty || "medium";
}

function dockDifficultyRow(onPick) {
  const row = document.createElement("div");
  row.className = "game-actions";
  const cur = gameDifficulty();
  for (const d of ["easy", "medium", "hard"]) {
    const b = document.createElement("button");
    b.className = "mini-btn" + (cur === d ? " current" : "");
    b.textContent = d.charAt(0).toUpperCase() + d.slice(1);
    b.addEventListener("click", () => {
      mem.data.gameDifficulty = d;
      mem.save();
      onPick(d);
    });
    row.appendChild(b);
  }
  return row;
}

function dockScoreLine(text) {
  const el = document.createElement("div");
  el.className = "game-score";
  el.textContent = text;
  return el;
}

function dockNewGameRow(label, onNew) {
  const actions = document.createElement("div");
  actions.className = "game-actions";
  const newBtn = document.createElement("button");
  newBtn.className = "mini-btn";
  newBtn.textContent = label;
  newBtn.addEventListener("click", onNew);
  actions.appendChild(newBtn);
  return actions;
}

/* ---------------- connect four (side dock) ---------------- */
function cfScore() {
  if (!mem.data.cfScore) mem.data.cfScore = { player: 0, aqua: 0, tie: 0 };
  return mem.data.cfScore;
}

function startCfGame() {
  cfGame.active = true;
  cfGame.grid = ConnectFour.newGrid();
  if (cfGame.aiTimer) { clearTimeout(cfGame.aiTimer); cfGame.aiTimer = null; }
  openDock("cf");
  sayForAudience(isChildSpeaker()
    ? "Connect Four! You're red — drop one in!"
    : "Connect Four. You're red, boss — your drop.");
}

function buildCfBoard() {
  const body = $("dock-body");
  if (!body) return;
  body.innerHTML = "";
  if (!cfGame.grid) cfGame.grid = ConnectFour.newGrid();
  const root = document.createElement("div");
  root.className = "game-bubble";
  root.appendChild(dockTitleEl("Connect Four"));

  const cols = document.createElement("div");
  cols.className = "cf-cols";
  for (let c = 0; c < ConnectFour.COLS; c++) {
    const b = document.createElement("button");
    b.className = "cf-col";
    b.textContent = "▼";
    b.disabled = !cfGame.active || !!cfGame.grid[0][c];
    b.addEventListener("click", () => playCfDrop(c));
    cols.appendChild(b);
  }
  root.appendChild(cols);

  const grid = document.createElement("div");
  grid.className = "cf-grid";
  for (let r = 0; r < ConnectFour.ROWS; r++) {
    for (let c = 0; c < ConnectFour.COLS; c++) {
      const cell = document.createElement("div");
      const pc = cfGame.grid[r][c];
      cell.className = "cf-cell" + (pc === "R" ? " R" : pc === "Y" ? " Y" : "");
      grid.appendChild(cell);
    }
  }
  root.appendChild(grid);

  const status = document.createElement("div");
  status.className = "game-status";
  status.textContent = !cfGame.active ? "Tap New game to play." : "Your drop — you're red.";
  root.appendChild(status);

  const sc = cfScore();
  root.appendChild(dockScoreLine(`You ${sc.player} · Aqua ${sc.aqua} · Ties ${sc.tie}`));
  root.appendChild(dockNewGameRow("New game", () => startCfGame()));
  root.appendChild(dockDifficultyRow(() => startCfGame()));
  body.appendChild(root);
}

function playCfDrop(c) {
  if (!cfGame.active || !cfGame.grid) return;
  if (ConnectFour.drop(cfGame.grid, c, cfGame.player) < 0) {
    toast("That column's full — pick another.");
    return;
  }
  if (dockOpen() && dock.tab === "cf") renderDock();
  const w = ConnectFour.winner(cfGame.grid);
  if (w) { endCf(w); return; }
  if (ConnectFour.isFull(cfGame.grid)) { endCf(null); return; }
  cfGame.aiTimer = setTimeout(cfAiMove, 450 + Math.random() * 350);
}

function cfAiMove() {
  if (!cfGame.active || !cfGame.grid) return;
  const c = ConnectFour.ai(cfGame.grid, cfGame.aqua, gameDifficulty());
  if (c < 0) return;
  ConnectFour.drop(cfGame.grid, c, cfGame.aqua);
  if (dockOpen() && dock.tab === "cf") renderDock();
  const w = ConnectFour.winner(cfGame.grid);
  if (w) { endCf(w); return; }
  if (ConnectFour.isFull(cfGame.grid)) { endCf(null); return; }
}

function endCf(w) {
  cfGame.active = false;
  const sc = cfScore();
  if (w === cfGame.player) {
    sc.player++;
    gameComment(["Four in a row — you got me! Nice droppin'.", "Well would you look at that — you win! Rematch?"]);
  } else if (w === cfGame.aqua) {
    sc.aqua++;
    gameComment(["That's four, darlin' — I win this one!", "Connect four! Read you like a pump schedule."]);
  } else {
    sc.tie++;
    gameComment(["Board's full and nobody blinked. Tie game!"]);
  }
  mem.save();
  if (dockOpen() && dock.tab === "cf") renderDock();
}

/* ---------------- checkers (side dock) ---------------- */
function checkScore() {
  if (!mem.data.checkScore) mem.data.checkScore = { player: 0, aqua: 0, tie: 0 };
  return mem.data.checkScore;
}

function startCheckersGame() {
  checkGame.active = true;
  checkGame.state = Checkers.initial();
  checkGame.sel = -1;
  checkGame.selMoves = [];
  if (checkGame.aiTimer) { clearTimeout(checkGame.aiTimer); checkGame.aiTimer = null; }
  openDock("checkers");
  sayForAudience(isChildSpeaker()
    ? "Checkers! You're red — you go first!"
    : "Checkers. You're red, boss. Tap a piece, then a square.");
}

function checkIsMine(piece) {
  return !!piece && piece.c === checkGame.player;
}

function buildCheckersBoard() {
  const body = $("dock-body");
  if (!body) return;
  body.innerHTML = "";
  if (!checkGame.state) checkGame.state = Checkers.initial();
  const st = checkGame.state;
  const root = document.createElement("div");
  root.className = "game-bubble";
  root.appendChild(dockTitleEl("Checkers"));

  if (checkGame.active && st.t === checkGame.player &&
      Checkers.all(st, checkGame.player).some((m) => m.takes.length)) {
    const hint = document.createElement("div");
    hint.className = "quiz-tag";
    hint.textContent = "You've got a jump — take it!";
    root.appendChild(hint);
  }

  const grid = document.createElement("div");
  grid.className = "chk-grid";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const i = r * 8 + c;
      const sq = document.createElement("button");
      const dark = (r + c) % 2 === 1;
      sq.className = "chk-sq " + (dark ? "dark" : "light");
      const piece = st.b[i];
      if (piece) {
        const dot = document.createElement("span");
        dot.className = "chk-piece " + (piece.c === "r" ? "pr" : "pb") + (piece.k ? " king" : "");
        dot.textContent = piece.k ? "♛" : "●";
        sq.appendChild(dot);
      }
      if (i === checkGame.sel) sq.classList.add("sel");
      if (checkGame.selMoves.some((m) => m.path[0] === i)) sq.classList.add("tgt");
      sq.disabled = !checkGame.active || st.t !== checkGame.player;
      sq.addEventListener("click", () => checkersTap(i));
      grid.appendChild(sq);
    }
  }
  root.appendChild(grid);

  const status = document.createElement("div");
  status.className = "game-status";
  status.textContent = !checkGame.active ? "Tap New game to play."
    : st.t === checkGame.player ? "Your move — you're red." : "My turn… hold your horses.";
  root.appendChild(status);

  const sc = checkScore();
  root.appendChild(dockScoreLine(`You ${sc.player} · Aqua ${sc.aqua} · Ties ${sc.tie}`));
  root.appendChild(dockNewGameRow("New game", () => startCheckersGame()));
  root.appendChild(dockDifficultyRow(() => startCheckersGame()));
  body.appendChild(root);
}

function checkersTap(i) {
  if (!checkGame.active || !checkGame.state) return;
  const st = checkGame.state;
  if (st.t !== checkGame.player) return;
  if (checkGame.sel >= 0) {
    const mv = checkGame.selMoves.find((m) => m.path[0] === i);
    if (mv) { playCheckersMove(mv); return; }
  }
  if (checkIsMine(st.b[i])) {
    checkGame.sel = i;
    checkGame.selMoves = Checkers.all(st, checkGame.player).filter((m) => m.from === i);
  } else {
    checkGame.sel = -1;
    checkGame.selMoves = [];
  }
  if (dockOpen() && dock.tab === "checkers") renderDock();
}

function playCheckersMove(mv) {
  if (!checkGame.active || !checkGame.state) return;
  checkGame.state = Checkers.apply(checkGame.state, mv);
  checkGame.sel = -1;
  checkGame.selMoves = [];
  if (dockOpen() && dock.tab === "checkers") renderDock();
  const status = Checkers.status(checkGame.state);
  if (status.over) { endCheckers(status.winner); return; }
  checkGame.aiTimer = setTimeout(checkersAiMove, 450 + Math.random() * 350);
}

function checkersAiMove() {
  if (!checkGame.active || !checkGame.state) return;
  const mv = Checkers.ai(checkGame.state, checkGame.aqua, gameDifficulty());
  if (!mv) return;
  checkGame.state = Checkers.apply(checkGame.state, mv);
  if (dockOpen() && dock.tab === "checkers") renderDock();
  const status = Checkers.status(checkGame.state);
  if (status.over) endCheckers(status.winner);
}

function endCheckers(w) {
  checkGame.active = false;
  const sc = checkScore();
  if (w === checkGame.player) {
    sc.player++;
    gameComment(["King me — oh wait, YOU win! Well played, boss.", "You swept the whole board! Rematch?"]);
  } else if (w === checkGame.aqua) {
    sc.aqua++;
    gameComment(["Last piece taken — I win this one! Good game.", "Got every last one of you. Run it back?"]);
  } else {
    sc.tie++;
    gameComment(["Nobody won that one — call it a tie!"]);
  }
  mem.save();
  if (dockOpen() && dock.tab === "checkers") renderDock();
}

/* ---------------- chess (side dock) ---------------- */
const CHESS_GLYPH = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

function chessScore() {
  if (!mem.data.chessScore) mem.data.chessScore = { player: 0, aqua: 0, tie: 0 };
  return mem.data.chessScore;
}

function startChessGame() {
  chessGame.active = true;
  chessGame.state = Chess.initial();
  chessGame.sel = -1;
  chessGame.selMoves = [];
  chessGame.promo = null;
  if (chessGame.aiTimer) { clearTimeout(chessGame.aiTimer); chessGame.aiTimer = null; }
  openDock("chess");
  sayForAudience(isChildSpeaker()
    ? "Chess! You're white — you go first. Good luck!"
    : "Chess. You're white, boss — show me what you got.");
}

function chessIsMine(piece) {
  if (!piece) return false;
  return chessGame.player === "w" ? piece < "a" : piece >= "a";
}

function buildChessBoard() {
  const body = $("dock-body");
  if (!body) return;
  body.innerHTML = "";
  if (!chessGame.state) chessGame.state = Chess.initial();
  const st = chessGame.state;
  const root = document.createElement("div");
  root.className = "game-bubble";
  root.appendChild(dockTitleEl("Chess"));

  const grid = document.createElement("div");
  grid.className = "chess-grid";
  for (let dr = 0; dr < 8; dr++) {
    for (let f = 0; f < 8; f++) {
      const r = 7 - dr;
      const i = r * 8 + f;
      const sq = document.createElement("button");
      sq.className = "chess-sq " + ((r + f) % 2 === 1 ? "dark" : "light");
      const piece = st.b[i];
      if (piece) {
        const g = document.createElement("span");
        g.className = "chess-piece " + (piece < "a" ? "pw" : "pb");
        g.textContent = CHESS_GLYPH[piece] || piece;
        sq.appendChild(g);
      }
      if (i === chessGame.sel) sq.classList.add("sel");
      if (chessGame.selMoves.some((m) => m.t === i)) sq.classList.add("tgt");
      sq.disabled = !chessGame.active || st.t !== chessGame.player || !!chessGame.promo;
      sq.addEventListener("click", () => chessTap(i));
      grid.appendChild(sq);
    }
  }
  root.appendChild(grid);

  if (chessGame.promo && chessGame.promo.length) {
    const prow = document.createElement("div");
    prow.className = "promo-row";
    const label = document.createElement("span");
    label.className = "game-status";
    label.textContent = "Promote to: ";
    prow.appendChild(label);
    for (const mv of chessGame.promo) {
      const b = document.createElement("button");
      b.className = "mini-btn promo-btn";
      b.textContent = CHESS_GLYPH[mv.promo] || "Q";
      b.title = mv.promo;
      b.addEventListener("click", () => {
        chessGame.promo = null;
        playChessMove(mv);
      });
      prow.appendChild(b);
    }
    root.appendChild(prow);
  }

  const status = document.createElement("div");
  status.className = "game-status";
  if (!chessGame.active) status.textContent = "Tap New game to play.";
  else {
    status.textContent = (st.t === chessGame.player ? "Your move." : "My turn…")
      + (Chess.inCheck(st, st.t) ? " — check!" : "")
      + ` · Move ${st.full}`;
  }
  root.appendChild(status);

  const sc = chessScore();
  root.appendChild(dockScoreLine(`You ${sc.player} · Aqua ${sc.aqua} · Ties ${sc.tie}`));
  root.appendChild(dockNewGameRow("New game", () => startChessGame()));
  root.appendChild(dockDifficultyRow(() => startChessGame()));
  body.appendChild(root);
}

function chessTap(i) {
  if (!chessGame.active || !chessGame.state || chessGame.promo) return;
  const st = chessGame.state;
  if (st.t !== chessGame.player) return;
  if (chessGame.sel >= 0) {
    const opts = chessGame.selMoves.filter((m) => m.t === i);
    if (opts.length === 1) { playChessMove(opts[0]); return; }
    if (opts.length > 1) {  // promotion — let them pick the piece
      chessGame.promo = opts;
      if (dockOpen() && dock.tab === "chess") renderDock();
      return;
    }
  }
  if (chessIsMine(st.b[i])) {
    chessGame.sel = i;
    chessGame.selMoves = Chess.legal(st, i);
  } else {
    chessGame.sel = -1;
    chessGame.selMoves = [];
  }
  if (dockOpen() && dock.tab === "chess") renderDock();
}

function playChessMove(mv) {
  if (!chessGame.active || !chessGame.state) return;
  chessGame.state = Chess.apply(chessGame.state, mv);
  chessGame.sel = -1;
  chessGame.selMoves = [];
  chessGame.promo = null;
  if (dockOpen() && dock.tab === "chess") renderDock();
  const status = Chess.status(chessGame.state);
  if (status.over) { endChess(status.winner); return; }
  chessGame.aiTimer = setTimeout(chessAiMove, 450 + Math.random() * 350);
}

function chessAiMove() {
  if (!chessGame.active || !chessGame.state) return;
  const mv = Chess.ai(chessGame.state, gameDifficulty());
  if (!mv) return;
  chessGame.state = Chess.apply(chessGame.state, mv);
  if (dockOpen() && dock.tab === "chess") renderDock();
  const status = Chess.status(chessGame.state);
  if (status.over) endChess(status.winner);
}

function endChess(w) {
  chessGame.active = false;
  const sc = chessScore();
  if (w === chessGame.player) {
    sc.player++;
    gameComment(["Checkmate — you got me! Beautiful game, boss.", "Well played! That checkmate was earned. Rematch?"]);
  } else if (w === chessGame.aqua) {
    sc.aqua++;
    gameComment(["Checkmate! Don't feel bad — I think in trees.", "Got your king! Good game, darlin' — run it back?"]);
  } else {
    sc.tie++;
    gameComment(["Stalemate — nobody's king falls today. Tie game!"]);
  }
  mem.save();
  if (dockOpen() && dock.tab === "chess") renderDock();
}

/* ---------------- Angela's pop quizzes (in chat) ---------------- */
function quizPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function quizSubject(arg) {
  const t = String(arg || "").toLowerCase().trim();
  if (/^(math|maths|arithmetic)$/.test(t)) return "math";
  if (/^(spell|spelling)$/.test(t)) return "spelling";
  if (/^(science|sci)$/.test(t)) return "science";
  if (/^(ela|english|language ?arts|words|reading)$/.test(t)) return "language arts";
  if (/^(history|social ?studies)$/.test(t)) return "history";
  if (/^(thinking|riddle|riddles|fun)$/.test(t)) return "thinking";
  return null;
}

function askQuiz(force, subject) {
  pendingQuiz = SchoolQuiz.pick(recentQuizIds, subject);
  recentQuizIds.push(pendingQuiz.id);
  if (recentQuizIds.length > 12) recentQuizIds = recentQuizIds.slice(-12);
  quizCooldown = 4;
  mem.data.quizAsked = (mem.data.quizAsked || 0) + 1;
  mem.save();
  const name = speakerName();
  const q = `📚 Pop quiz${pendingQuiz.subject ? ` (${pendingQuiz.subject})` : ""}${name ? `, ${name}` : ""}: ${pendingQuiz.q} Just reply with your answer!`;
  const out = forAudience(q);
  addMessage("aqua", out);
  sayForAudience(out);
  logDayExchange(force ? "/quiz" : "(pop quiz)", out);
}

function answerQuiz(text) {
  Speaker.stop();
  addMessage("user", text);
  input.value = "";
  autosize();
  busy = true;
  setSendDisabled(true);
  const item = pendingQuiz;
  pendingQuiz = null;
  quizCooldown = 4;
  const ok = SchoolQuiz.check(item, text);
  if (ok) mem.data.quizCorrect = (mem.data.quizCorrect || 0) + 1;
  mem.save();
  let verdict;
  if (ok) {
    verdict = quizPick([
      "That's right! You're on fire.",
      "You got it! Smart cookie.",
      "Nailed it! I'm proud of you.",
      "Yes! That's exactly right.",
    ]);
  } else {
    const answer = (item && item.answers && item.answers[0]) || "that one";
    verdict = quizPick([
      `Good try! The answer is ${answer}. You'll get the next one!`,
      `Almost! It's ${answer}. Nice effort — let's keep going!`,
      `Nice effort! The answer is ${answer}. You'll nail the next one!`,
    ]);
  }
  verdict = forAudience(verdict);
  const sMem = getSpeakerMemory();
  sMem.addExchange(text, verdict);
  sMem.save();
  addMessage("aqua", verdict);
  Speaker.say(verdict);
  logDayExchange(text, verdict);
  busy = false;
  setSendDisabled(false);
  if (!Speaker._speaking) setFaceState("idle");
}

/* ---------------- panels ---------------- */
const overlay = $("overlay");
const panel = $("panel");
const panelTitle = $("panel-title");
const panelBody = $("panel-body");

function openPanel(which) {
  if (which === "profile") renderProfile();
  else if (which === "voices") renderVoices();
  else if (which === "help") renderHelp();
  else if (which === "settings") renderSettings();
  else if (which === "pool") renderPool();
  else if (which === "truck") renderTruck();
  else if (which === "journal") renderJournal();
  else if (which === "people") renderPeople();
  else return;
  panel.classList.remove("hidden");
  panel.classList.add("open");
  overlay.classList.remove("hidden");
}

function closePanel() {
  panel.classList.add("hidden");
  panel.classList.remove("open");
  overlay.classList.add("hidden");
}

overlay.addEventListener("click", closePanel);
$("panel-close").addEventListener("click", closePanel);
$("btn-profile").addEventListener("click", () => openPanel("profile"));
$("btn-voices").addEventListener("click", () => openPanel("voices"));
$("btn-help").addEventListener("click", () => openPanel("help"));
$("btn-settings").addEventListener("click", () => openPanel("settings"));
$("btn-pool").addEventListener("click", () => openPanel("pool"));
$("btn-journal").addEventListener("click", () => openPanel("journal"));
$("btn-game").addEventListener("click", () => {
  if (!game.active && dock.tab === "ttt") startGame();
  else openDock(dock.tab);
});
$("btn-people").addEventListener("click", () => openPanel("people"));
$("btn-truck").addEventListener("click", () => openPanel("truck"));
$("dock-close").addEventListener("click", closeDock);
(() => {
  const tabs = $("dock-tabs");
  if (tabs && tabs.querySelectorAll) {
    const btns = tabs.querySelectorAll(".dock-tab");
    if (btns && btns.forEach) btns.forEach((b) => b.addEventListener("click", () => {
      if (b.dataset && b.dataset.gtab) selectGameTab(b.dataset.gtab);
    }));
  }
})();

const KIND_LABEL = {
  favorite: "Favorites", like: "Likes", dislike: "Dislikes", work: "Work",
  live: "Where you live", have: "You have", learning: "Learning",
  pet: "Pets", person: "People",
};

function renderProfile() {
  panelTitle.textContent = "What she knows about you";
  const facts = mem.allFacts();
  const byKind = {};
  facts.forEach((f) => (byKind[f.kind] = byKind[f.kind] || []).push(f.text));

  let html = `
    <div class="panel-section">
      <h3>You</h3>
      <div class="kv"><span class="k">Name</span><span class="v">${escapeHtml(mem.name || "not known yet")}</span></div>
      <div class="kv"><span class="k">Chats together</span><span class="v">${mem.data.sessions || 0}</span></div>
      <div class="kv"><span class="k">Known each other</span><span class="v">${mem.daysKnown()} day(s)</span></div>
    </div>`;

  if (!facts.length) {
    html += `<div class="hint">No memories yet — she's still getting to know you. Tell her something about yourself!</div>`;
  } else {
    html += `<div class="panel-section"><h3>Memories (${facts.length})</h3>`;
    for (const kind of Object.keys(byKind)) {
      html += `<div class="kv" style="align-items:flex-start;gap:10px;">
        <span class="k">${escapeHtml(KIND_LABEL[kind] || kind)}</span>
        <span class="v" style="font-weight:400;max-width:60%;">${byKind[kind].map(escapeHtml).join(", ")}</span>
      </div>`;
    }
    html += `</div>`;
  }

  html += `
    <div class="panel-section">
      <h3>Forget something</h3>
      <div style="display:flex;gap:8px;">
        <input id="forget-input" placeholder="a word, e.g. fishing" class="field-input">
        <button id="forget-btn" class="btn-ghost">Forget</button>
      </div>
      <p class="hint" style="margin-top:10px;">Deletes every memory containing that word.</p>
    </div>
    <div class="panel-section">
      <h3>Backup &amp; restore</h3>
      <div style="display:flex;gap:8px;">
        <button id="backup-btn" class="btn-solid">Export memory</button>
        <button id="restore-btn" class="btn-ghost">Restore</button>
      </div>
      <p class="hint" style="margin-top:10px;">Save everything she knows to a file, or load a backup. Handy before a new PC.</p>
    </div>`;

  panelBody.innerHTML = html;
  $("forget-btn").addEventListener("click", () => {
    const term = $("forget-input").value.trim();
    if (!term) return;
    const removed = mem.forget(term);
    mem.save();
    toast(`Forgot ${removed.length} memor${removed.length === 1 ? "y" : "ies"}.`);
    renderProfile();
  });
  $("backup-btn").addEventListener("click", exportMemory);
  $("restore-btn").addEventListener("click", restoreMemory);
}

function rateText(rate) {
  const pct = Math.round((rate - 1) * 100);
  return (pct >= 0 ? "+" : "") + pct + "%";
}

function applyRate(pct) {
  const base = Number(mem.data.rate) || 1.0;
  const rate = clamp(Math.round(base * (1 + pct / 100) * 100) / 100, 0.5, 2.0);
  mem.data.rate = rate;
  mem.save();
  Speaker.rate = rate;
  return rate;
}

function renderVoices() {
  panelTitle.textContent = "Her voice";

  const engine = voiceEngine();             // "openai" | "windows"
  const oaVoice = mem.data.openai_voice || "nova";

  let html = `
    <div class="panel-section">
      <h3>Voice engine</h3>
      <div class="seg">
        <button id="engine-openai" class="seg-btn ${engine === "openai" ? "on" : ""}">OpenAI neural</button>
        <button id="engine-windows" class="seg-btn ${engine === "windows" ? "on" : ""}">Windows voice</button>
      </div>
      <p class="hint" style="margin-top:10px;">
        ${smart.on
          ? "OpenAI neural voices are her most human-sounding. Windows voices still work offline."
          : "Add your OpenAI key (⚙️ Settings) to unlock her most human voices. Windows voices work without it."}
      </p>
    </div>
    <div class="panel-section">
      <h3>Speaking rate</h3>
      <div class="rate-ctl">
        <button id="rate-down">−</button>
        <div class="rate-val" id="rate-val">${rateText(mem.data.rate || 1.0)}</div>
        <button id="rate-up">+</button>
      </div>
    </div>
    <div class="panel-section">
      <h3>Volume</h3>
      <div class="vol-ctl">
        <input type="range" id="vol-slider" min="0" max="200" value="${Math.round((mem.data.volume || 1.2) * 100)}">
        <div class="vol-val" id="vol-val">${Math.round((mem.data.volume || 1.2) * 100)}%</div>
      </div>
    </div>
    <div class="panel-section">
      <h3>Voice quality</h3>
      <div class="seg">
        <button id="q-fast" class="seg-btn ${(mem.data.tts_model || "tts-1") === "tts-1" ? "on" : ""}">Fast (tts-1)</button>
        <button id="q-hd" class="seg-btn ${mem.data.tts_model === "tts-1-hd" ? "on" : ""}">HD (tts-1-hd)</button>
      </div>
      <p class="hint" style="margin-top:10px;">Fast responds sooner. HD sounds a touch richer but takes a beat longer.</p>
    </div>`;

  if (engine === "openai") {
    html += `<div class="panel-section"><h3>Pick a neural voice</h3>`;
    for (const [id, label] of OPENAI_VOICES) {
      const cur = id === oaVoice;
      html += `
        <div class="voice-row ${cur ? "current" : ""}" data-vid="${escapeHtml(id)}">
          <div><div>${escapeHtml(label.split("—")[0].trim())}</div><div class="vlabel">${escapeHtml(label.split("—")[1].trim())}</div></div>
          <span class="vrow-actions">
            <button class="mini-btn preview-btn" data-vid="${escapeHtml(id)}" title="Preview">▶</button>
            ${cur ? '<span class="check">✓</span>' : ""}
          </span>
        </div>`;
    }
    html += `<p class="hint" style="margin-top:10px;">Tap ▶ to hear each one. Her voice is generated by OpenAI on the fly — your words never leave your PC except to render the audio.</p></div>`;
  } else {
    if (!Speaker.available) {
      html += `<div class="hint">Voice isn't supported here.</div>`;
    } else {
      const voices = Speaker.loadVoices();
      const currentURI = Speaker.voice ? (Speaker.voice.voiceURI || Speaker.voice.name) : null;
      html += `<div class="panel-section"><h3>Pick a Windows voice (${voices.length})</h3>`;
      for (const v of voices) {
        const uri = v.voiceURI || v.name;
        const cur = uri === currentURI;
        html += `
          <button class="voice-row ${cur ? "current" : ""}" data-uri="${escapeHtml(uri)}">
            <div><div>${escapeHtml(v.name || "Unnamed voice")}</div><div class="vlabel">${escapeHtml(v.lang || "")}${v.default ? " · default" : ""}</div></div>
            ${cur ? '<span class="check">✓</span>' : ""}
          </button>`;
      }
      html += `</div>`;
    }
  }

  panelBody.innerHTML = html;

  const setEngine = (e) => {
    mem.data.voice_engine = e;
    mem.save();
    renderVoices();
  };
  const bo = $("engine-openai");
  const bw = $("engine-windows");
  if (bo) bo.addEventListener("click", () => setEngine("openai"));
  if (bw) bw.addEventListener("click", () => setEngine("windows"));

  $("rate-down").addEventListener("click", () => {
    const rate = applyRate(-10);
    $("rate-val").textContent = rateText(rate);
  });
  $("rate-up").addEventListener("click", () => {
    const rate = applyRate(10);
    $("rate-val").textContent = rateText(rate);
  });

  const volSlider = $("vol-slider");
  const volVal = $("vol-val");
  const applyVol = () => {
    const v = parseInt(volSlider.value, 10) / 100;
    mem.data.volume = v;
    mem.save();
    Speaker.volume = v;
    volVal.textContent = Math.round(v * 100) + "%";
  };
  volSlider.addEventListener("input", applyVol);

  const qFast = $("q-fast");
  const qHd = $("q-hd");
  if (qFast) qFast.addEventListener("click", () => { mem.data.tts_model = "tts-1"; mem.save(); renderVoices(); });
  if (qHd) qHd.addEventListener("click", () => { mem.data.tts_model = "tts-1-hd"; mem.save(); renderVoices(); });

  panelBody.querySelectorAll(".voice-row[data-vid]").forEach((row) => {
    row.addEventListener("click", (ev) => {
      if (ev.target.classList.contains("preview-btn")) { previewOpenAIVoice(row.dataset.vid); return; }
      mem.data.openai_voice = row.dataset.vid;
      mem.data.voice_engine = "openai";
      mem.save();
      renderVoices();
      Speaker.say("This is my new voice. What do you think?");
    });
  });

  panelBody.querySelectorAll(".voice-row[data-uri]").forEach((row) => {
    row.addEventListener("click", () => {
      const uri = row.dataset.uri;
      const v = Speaker.loadVoices().find((x) => (x.voiceURI || x.name) === uri);
      if (!v) return;
      Speaker.voice = v;
      mem.data.voice_id = v.voiceURI || v.name;
      mem.data.voice_engine = "windows";
      mem.save();
      renderVoices();
      Speaker.say("This is my new voice. What do you think?");
    });
  });
}

function renderHelp() {
  panelTitle.textContent = "Help & commands";
  const cmds = [
    ["/help", "show this list"],
    ["/profile", "everything she's learned about you"],
    ["/voice on|off", "turn her voice on or off"],
    ["/voices", "list the voices she can wear"],
    ["/voice &lt;name&gt;", "switch voice (e.g. /voice nova)"],
    ["/rate +10%", "speak faster (+) or slower (-)"],
    ["/handsfree", "always-listening mode"],
    ["/wakeword", "toggle the “Hey Aqua” wake word"],
    ["/name Robert", "tell her your name"],
    ["/forget word", "forget memories with that word"],
    ["/pool set 15000", "your pool size"],
    ["/chem ph 8.2 7.5", "pool chemistry math"],
    ["/job add …", "log a service job (/jobs, /job done 1)"],
    ["/customer add …", "log a customer (/customers)"],
    ["/weather set Dallas", "weather-aware pool tips"],
    ["/remind in 20 min …", "set a reminder"],
    ["/timer 5", "a quick timer"],
    ["/journal", "her daily journal"],
    ["/people", "enroll voices (she'll know who's talking)"],
    ["/whoami", "who she thinks is on the mic"],
    ["/strict on|off", "mic obeys ONLY enrolled voices"],
    ["/game", "open the game side panel"],
    ["/game chess", "jump to a game (checkers, cf, rps, guess, word)"],
    ["/move top left", "tic-tac-toe move — top left, center, B2, 1-9"],
    ["/rps rock", "throw rock, paper, or scissors"],
    ["/guess 42", "guess the number"],
    ["/letter e", "guess a letter in word guess"],
    ["/quiz spelling", "drill a subject (math, spelling, science…)"],
    ["/spanish on|off", "she answers en español"],
    ["/pool-es", "poolside Spanish cheat sheet"],
    ["/note jot this", "voice-note into today's journal"],
    ["/route add …", "today's customer stops, in order"],
    ["/truck", "truck view: route + jobs"],
    ["/brain", "which brain she's using"],
    ["/settings", "connect her OpenAI brain"],
    ["/backup", "export her memory to a file"],
    ["/update", "install a downloaded update"],
    ["/reset", "wipe everything (asks first)"],
    ["/quit", "say goodbye and close"],
  ];
  panelBody.innerHTML = `
    <div class="panel-section"><h3>Commands</h3>
      ${cmds.map(([c, d]) => `<div class="help-cmd"><code>${c}</code><span>${d}</span></div>`).join("")}
    </div>
    <div class="panel-section"><h3>Tips</h3>
      <p class="hint">• Press <b>Enter</b> to send, <b>Shift+Enter</b> for a new line.<br>
      • Tap the <b>🎤</b> to talk (she uses OpenAI Whisper to hear you).<br>
      • Say <b>“goodbye”</b> anytime to wrap up.<br>
      • Play on the <b>game side</b> (🎮): tic-tac-toe, chess, checkers, connect four and more — say your move while you chat.<br>
      • Tell her <b>“jot this down …”</b> anytime to stick a note in today's journal.<br>
      • Your OpenAI key and everything she learns stay on <b>your PC</b>.</p>
    </div>`;
}

async function renderSettings() {
  panelTitle.textContent = "Settings — OpenAI brain";
  panelBody.innerHTML = '<div class="hint">Loading…</div>';
  if (!bridge) {
    panelBody.innerHTML = `<div class="hint">Open Aqua as the desktop app to connect the OpenAI brain.</div>`;
    return;
  }
  const cfg = await bridge.getConfig();

  panelBody.innerHTML = `
    <div class="panel-section">
      <h3>OpenAI API key</h3>
      <p class="hint">Aqua talks to OpenAI directly from your PC. Get a key at
        <a href="#" id="key-link">platform.openai.com/api-keys</a>. It's stored only on this computer — never sent anywhere else.</p>
      <input type="password" id="key-input" class="field-input" placeholder="sk-…">
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button id="key-save" class="btn-solid">Save key</button>
        <button id="key-clear" class="btn-ghost">Remove key</button>
      </div>
      <p class="hint" style="margin-top:10px;">
        ${cfg.hasKey
          ? `✅ Connected — key ending ${escapeHtml(cfg.keyHint)}. Brain: <b>OpenAI · ${escapeHtml(cfg.model)}</b>`
          : "🔌 No key yet — using the built-in local brain."}
      </p>
    </div>
    <div class="panel-section">
      <h3>Model</h3>
      <input id="model-input" class="field-input" value="${escapeHtml(cfg.model)}">
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button id="model-save" class="btn-solid">Save model</button>
      </div>
      <p class="hint" style="margin-top:10px;">e.g. gpt-4o-mini (default), gpt-4o, gpt-4.1-mini, gpt-4.1</p>
    </div>
    <div class="panel-section">
      <h3>Voice &amp; ears</h3>
      <p class="hint">• <b>Speaking:</b> she talks with an OpenAI neural voice (pick one in 🎙️ Voices) — much more human than the default system voice. Falls back to Windows offline.<br>
      • <b>Listening:</b> the 🎤 mic uses OpenAI Whisper with your key.</p>
    </div>`;

  $("key-link").addEventListener("click", (e) => {
    e.preventDefault();
    bridge.openExternal("https://platform.openai.com/api-keys");
  });

  $("key-save").addEventListener("click", async () => {
    const k = $("key-input").value.trim();
    if (!k) { toast("Paste your API key first."); return; }
    await bridge.saveConfig({ openai_api_key: k });
    await refreshSmart();
    renderSettings();
    toast("Key saved — OpenAI brain is on.");
  });

  $("key-clear").addEventListener("click", async () => {
    await bridge.clearConfig();
    await refreshSmart();
    renderSettings();
    toast("Key removed — back to the built-in brain.");
  });

  $("model-save").addEventListener("click", async () => {
    const m = $("model-input").value.trim() || "gpt-4o-mini";
    await bridge.saveConfig({ model: m });
    await refreshSmart();
    renderSettings();
    toast("Model updated.");
  });
}

/* ---------------- today's route (pool stops in order) ---------------- */
function routeList() {
  if (!Array.isArray(mem.data.route)) mem.data.route = [];
  return mem.data.route;
}

function routeDoneSet() {
  const today = Journal.todayKey();
  if (!mem.data.routeDone || mem.data.routeDone.date !== today) {
    mem.data.routeDone = { date: today, ids: [] };
  }
  return mem.data.routeDone;
}

function toggleRouteDone(id) {
  const set = routeDoneSet();
  const i = set.ids.indexOf(id);
  if (i >= 0) set.ids.splice(i, 1);
  else set.ids.push(id);
  mem.save();
}

function routeText() {
  const r = routeList();
  if (!r.length) return "No route planned — /route add Smith to line up today's stops, or /route addc 2 to pull one from your customers.";
  const done = routeDoneSet().ids;
  const lines = r.map((s, i) => `${done.includes(s.id) ? "✓" : "○"} ${i + 1}. ${s.text}`);
  const left = r.filter((st) => !done.includes(st.id)).length;
  return `Today's route (${r.length} stop${r.length === 1 ? "" : "s"}${left ? `, ${left} to go` : ", all done!"}):\n${lines.join("\n")}\n\nTap 🚚 Truck to check them off as you go.`;
}

function moveRouteStop(id, dir) {
  const r = routeList();
  const i = r.findIndex((st) => st.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= r.length) return;
  const tmp = r[i]; r[i] = r[j]; r[j] = tmp;
  mem.save();
}

function renderPool() {
  panelTitle.textContent = "Hood's Pool Service";
  const pool = mem.data.pool || Object.assign({}, Pool.DEFAULT_POOL);
  const open = Tasks.open(mem.data.tasks || []);
  const done = Tasks.done(mem.data.tasks || []);

  let html = `
    <div class="panel-section">
      <h3>Pool on file</h3>
      <div class="kv"><span class="k">Gallons</span><span class="v">${pool.gallons ? pool.gallons.toLocaleString("en-US") : "not set"}</span></div>
      <div class="kv"><span class="k">Chlorine</span><span class="v">${escapeHtml((Pool.chlorineTypes.find(([id]) => id === pool.chlorineType) || ["", "—"])[1])}</span></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input id="pool-gallons" type="number" class="field-input" placeholder="e.g. 15000" value="${pool.gallons || ""}">
        <button id="pool-save" class="btn-solid">Save</button>
      </div>
      <div class="chip-row" style="margin-top:10px;">
        ${Pool.chlorineTypes.map(([id, label]) =>
          `<button class="chip ${id === pool.chlorineType ? "current" : ""}" data-ct="${id}">${escapeHtml(label)}</button>`).join("")}
      </div>
    </div>

    <div class="panel-section">
      <h3>Chemistry quick math</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <select id="chem-param" class="field-input" style="flex:1;min-width:120px;">
          ${Object.entries(Pool.CHEM).map(([k, s]) => `<option value="${k}">${escapeHtml(s.name)}</option>`).join("")}
        </select>
        <input id="chem-current" type="number" step="0.1" class="field-input" style="flex:1;min-width:90px;" placeholder="now">
        <input id="chem-target" type="number" step="0.1" class="field-input" style="flex:1;min-width:90px;" placeholder="target">
        <button id="chem-calc" class="btn-solid">Go</button>
      </div>
      <div id="chem-result" class="hint" style="margin-top:10px;"></div>
    </div>

    <div class="panel-section">
      <h3>Service jobs (${open.length} open)</h3>
      <div style="display:flex;gap:8px;">
        <input id="job-input" class="field-input" placeholder="e.g. check the Smiths' filter">
        <button id="job-add" class="btn-solid">Add</button>
      </div>
      <div id="job-list" style="margin-top:12px;"></div>
    </div>

    <div class="panel-section">
      <h3>Today's route (${routeList().length} stops)</h3>
      <div style="display:flex;gap:8px;">
        <input id="route-input" class="field-input" placeholder="e.g. Smith — filter clean">
        <button id="route-add" class="btn-solid">Add</button>
      </div>
      <div id="route-list" style="margin-top:12px;"></div>
    </div>

    <div class="panel-section">
      <h3>Weather &amp; chemistry tips</h3>
      <div style="display:flex;gap:8px;">
        <input id="weather-loc" class="field-input" placeholder="e.g. Dallas" value="${escapeHtml(mem.data.location || "")}">
        <button id="weather-go" class="btn-solid">Go</button>
      </div>
      <div id="weather-out" class="hint" style="margin-top:10px;"></div>
    </div>

    <div class="panel-section">
      <h3>Customers (${(mem.data.customers || []).length})</h3>
      <div style="display:flex;gap:8px;">
        <input id="cust-input" class="field-input" placeholder="e.g. Smith — 15k gal, sand filter">
        <button id="cust-add" class="btn-solid">Add</button>
      </div>
      <div id="cust-list" style="margin-top:12px;"></div>
    </div>`;

  panelBody.innerHTML = html;

  // pool profile
  $("pool-save").addEventListener("click", () => {
    const g = parseInt($("pool-gallons").value, 10);
    if (!g || g <= 0) { toast("Give me a real gallon count, darlin'."); return; }
    mem.data.pool = mem.data.pool || Object.assign({}, Pool.DEFAULT_POOL);
    mem.data.pool.gallons = g;
    mem.save();
    toast("Pool saved.");
    renderPool();
  });
  panelBody.querySelectorAll("[data-ct]").forEach((chip) => {
    chip.addEventListener("click", () => {
      mem.data.pool = mem.data.pool || Object.assign({}, Pool.DEFAULT_POOL);
      mem.data.pool.chlorineType = chip.dataset.ct;
      mem.save();
      renderPool();
    });
  });

  // chemistry
  $("chem-calc").addEventListener("click", () => {
    const param = $("chem-param").value;
    const current = parseFloat($("chem-current").value);
    const target = parseFloat($("chem-target").value);
    const spec = Pool.CHEM[param];
    const t = isFinite(target) ? target : spec.defaultTarget;
    if (!isFinite(current)) { toast("Enter the current reading first."); return; }
    const res = Pool.recommendDose(param, current, t, pool.gallons, pool.chlorineType);
    $("chem-result").textContent = res.summary || res.error || "";
    if (res.ok && !res.inRange) Speaker.say(res.summary);
  });

  // jobs
  const renderJobs = () => {
    const list = $("job-list");
    const jobs = Tasks.open(mem.data.tasks || []);
    if (!jobs.length) {
      list.innerHTML = '<div class="hint">No open jobs.</div>';
      return;
    }
    list.innerHTML = jobs.map((t, i) => `
      <div class="job-row">
        <span class="job-num">${i + 1}</span>
        <span class="job-text">${escapeHtml(t.text)}</span>
        <button class="mini-btn job-done" data-id="${t.id}" title="Done">✓</button>
        <button class="mini-btn job-del" data-id="${t.id}" title="Remove">✕</button>
      </div>`).join("");
    list.querySelectorAll(".job-done").forEach((b) => b.addEventListener("click", () => {
      Tasks.toggle(mem.data.tasks, b.dataset.id);
      mem.save();
      renderPool();
    }));
    list.querySelectorAll(".job-del").forEach((b) => b.addEventListener("click", () => {
      Tasks.remove(mem.data.tasks, b.dataset.id);
      mem.save();
      renderPool();
    }));
  };
  $("job-add").addEventListener("click", () => {
    const text = $("job-input").value.trim();
    if (!text) return;
    mem.data.tasks = mem.data.tasks || [];
    Tasks.add(mem.data.tasks, text);
    mem.save();
    $("job-input").value = "";
    renderPool();
  });
  renderJobs();

  // route
  const renderRoute = () => {
    const list = $("route-list");
    const stops = routeList();
    const done = routeDoneSet().ids;
    if (!stops.length) {
      list.innerHTML = '<div class="hint">No stops yet — add the day\'s customers in order.</div>';
      return;
    }
    list.innerHTML = stops.map((st, i) => `
      <div class="job-row">
        <span class="job-num">${i + 1}</span>
        <span class="job-text" style="${done.includes(st.id) ? "text-decoration:line-through;opacity:0.6;" : ""}">${escapeHtml(st.text)}</span>
        <button class="mini-btn route-done" data-id="${st.id}" title="Check off">✓</button>
        <button class="mini-btn route-up" data-id="${st.id}" title="Earlier">↑</button>
        <button class="mini-btn route-down" data-id="${st.id}" title="Later">↓</button>
        <button class="mini-btn job-del route-del" data-id="${st.id}" title="Remove">✕</button>
      </div>`).join("");
    list.querySelectorAll(".route-done").forEach((b) => b.addEventListener("click", () => {
      toggleRouteDone(b.dataset.id);
      renderPool();
    }));
    list.querySelectorAll(".route-up").forEach((b) => b.addEventListener("click", () => {
      moveRouteStop(b.dataset.id, -1);
      renderPool();
    }));
    list.querySelectorAll(".route-down").forEach((b) => b.addEventListener("click", () => {
      moveRouteStop(b.dataset.id, 1);
      renderPool();
    }));
    list.querySelectorAll(".route-del").forEach((b) => b.addEventListener("click", () => {
      mem.data.route = routeList().filter((st) => st.id !== b.dataset.id);
      mem.save();
      renderPool();
    }));
  };
  $("route-add").addEventListener("click", () => {
    const text = $("route-input").value.trim();
    if (!text) return;
    routeList().push({ id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text });
    mem.save();
    $("route-input").value = "";
    renderPool();
  });
  renderRoute();

  // weather
  const weatherOut = $("weather-out");
  $("weather-go").addEventListener("click", async () => {
    const loc = $("weather-loc").value.trim();
    if (!loc) { toast("Tell me a city first, darlin'."); return; }
    mem.data.location = loc;
    mem.save();
    await loadWeather(loc, weatherOut);
  });
  if (mem.data.location) loadWeather(mem.data.location, weatherOut);

  // customers
  const renderCust = () => {
    const list = $("cust-list");
    const customers = mem.data.customers || [];
    if (!customers.length) {
      list.innerHTML = '<div class="hint">No customers on file yet.</div>';
      return;
    }
    list.innerHTML = customers.map((c, i) => `
      <div class="cust-row">
        <span class="job-num">${i + 1}</span>
        <span class="cust-text">${escapeHtml(c.text)}</span>
        <button class="mini-btn cust-del" data-id="${c.id}" title="Remove">✕</button>
      </div>`).join("");
    list.querySelectorAll(".cust-del").forEach((b) => b.addEventListener("click", () => {
      mem.data.customers = mem.data.customers.filter((c) => c.id !== b.dataset.id);
      mem.save();
      renderPool();
    }));
  };
  $("cust-add").addEventListener("click", () => {
    const text = $("cust-input").value.trim();
    if (!text) return;
    mem.data.customers = mem.data.customers || [];
    mem.data.customers.unshift({ id: "c" + Date.now() + Math.random().toString(36).slice(2, 5), text, date: new Date().toISOString() });
    mem.save();
    $("cust-input").value = "";
    renderPool();
  });
  renderCust();
}

/* ---------------- truck view (route + jobs, big and touch-friendly) ---------------- */
function renderTruck() {
  panelTitle.textContent = "Truck view";
  const stops = routeList();
  const done = routeDoneSet().ids;
  const open = Tasks.open(mem.data.tasks || []);

  panelBody.innerHTML = `
    <div class="panel-section">
      <h3>Today's route (${stops.length})</h3>
      <div id="truck-route"></div>
    </div>
    <div class="panel-section">
      <h3>Open jobs (${open.length})</h3>
      <div id="truck-jobs"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input id="truck-job-input" class="field-input" placeholder="Add a job…">
        <button id="truck-job-add" class="btn-solid">Add</button>
      </div>
    </div>
    <div class="panel-section">
      <h3>Today's sky</h3>
      <div id="truck-weather" class="hint">…</div>
    </div>`;

  const rEl = $("truck-route");
  if (!stops.length) {
    rEl.innerHTML = '<div class="hint">No route yet — line up the day\'s stops in 🧰 Pool or with /route add.</div>';
  } else {
    rEl.innerHTML = stops.map((st, i) => `
      <button class="truck-stop${done.includes(st.id) ? " done" : ""}" data-id="${st.id}">
        <span class="truck-check">${done.includes(st.id) ? "✓" : "○"}</span>
        <span class="truck-num">${i + 1}</span>
        <span class="truck-text">${escapeHtml(st.text)}</span>
      </button>`).join("");
    rEl.querySelectorAll(".truck-stop").forEach((b) => b.addEventListener("click", () => {
      toggleRouteDone(b.dataset.id);
      renderTruck();
    }));
  }

  const jEl = $("truck-jobs");
  if (!open.length) {
    jEl.innerHTML = '<div class="hint">No open jobs — smooth sailing.</div>';
  } else {
    jEl.innerHTML = open.map((t, i) => `
      <div class="truck-stop">
        <span class="truck-num">${i + 1}</span>
        <span class="truck-text">${escapeHtml(t.text)}</span>
        <button class="mini-btn truck-done" data-id="${t.id}" title="Done">✓</button>
      </div>`).join("");
    jEl.querySelectorAll(".truck-done").forEach((b) => b.addEventListener("click", (ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      Tasks.toggle(mem.data.tasks, b.dataset.id);
      mem.save();
      renderTruck();
    }));
  }

  $("truck-job-add").addEventListener("click", () => {
    const text = $("truck-job-input").value.trim();
    if (!text) return;
    mem.data.tasks = mem.data.tasks || [];
    Tasks.add(mem.data.tasks, text);
    mem.save();
    renderTruck();
  });

  const wEl = $("truck-weather");
  if (mem.data.location) loadWeather(mem.data.location, wEl);
  else wEl.textContent = "Set your city in 🧰 Pool for the day's forecast.";
}

/* ---------------- reset + quit ---------------- */
const modal = $("modal");
$("btn-reset").addEventListener("click", openResetModal);
function openResetModal() { modal.classList.remove("hidden"); }
$("modal-cancel").addEventListener("click", () => modal.classList.add("hidden"));
$("modal-confirm").addEventListener("click", () => {
  modal.classList.add("hidden");
  const keep = {
    voice_on: mem.data.voice_on,
    voice_id: mem.data.voice_id,
    rate: mem.data.rate,
  };
  mem.reset();
  Object.assign(mem.data, keep);
  mem.save();
  brain = new Brain(mem);
  activePersonId = null;            // also forget who's on the mic
  personMemories.clear();
  greetedThisSession.clear();
  updateSpeakerChip();
  chatScroll.innerHTML = "";
  const greeting = brain.greeting();
  addMessage("aqua", greeting);
  Speaker.say(greeting);
  toast("Fresh start — she remembers nothing.");
});

function quitScreen() {
  Speaker.stop();
  document.body.innerHTML =
    '<div style="height:100vh;display:grid;place-items:center;color:#9fc3de;font-family:Segoe UI,sans-serif;">🌊 Aqua has closed her ears for now. See you next time!</div>';
  try { window.close(); } catch (e) {}
}

$("btn-quit").addEventListener("click", () => {
  const bye = brain.farewell();
  addMessage("aqua", bye);
  Speaker.say(bye);
  mem.save();
  setTimeout(quitScreen, 1200);
});

/* ---------------- boot ---------------- */
async function boot() {
  mem.touchSession();
  mem.save();
  brain = new Brain(mem);

  mem.data.pool = mem.data.pool || Object.assign({}, Pool.DEFAULT_POOL);
  mem.data.tasks = mem.data.tasks || [];
  mem.data.reminders = mem.data.reminders || [];
  mem.data.customers = mem.data.customers || [];
  mem.data.journal = mem.data.journal || [];
  mem.data.people = mem.data.people || [];
  mem.data.gameScore = mem.data.gameScore || { player: 0, aqua: 0, tie: 0 };
  mem.data.rpsScore = mem.data.rpsScore || { player: 0, aqua: 0, tie: 0 };
  mem.data.guessStats = mem.data.guessStats || { wins: 0, best: null };
  mem.data.wordStats = mem.data.wordStats || { wins: 0, losses: 0 };
  mem.data.cfScore = mem.data.cfScore || { player: 0, aqua: 0, tie: 0 };
  mem.data.checkScore = mem.data.checkScore || { player: 0, aqua: 0, tie: 0 };
  mem.data.chessScore = mem.data.chessScore || { player: 0, aqua: 0, tie: 0 };
  mem.data.route = mem.data.route || [];
  if (mem.data.strict_voices === undefined) mem.data.strict_voices = true;
  if (!mem.data.gameDifficulty) mem.data.gameDifficulty = "medium";
  if (!mem.data.tts_model) mem.data.tts_model = "tts-1";
  if (mem.data.volume == null) mem.data.volume = 1.2;   // louder by default

  setupVoices();
  updateSpeakerChip();
  Speaker.enabled = mem.data.voice_on !== false;
  setVoiceUI(Speaker.enabled);
  if (!mem.data.openai_voice) mem.data.openai_voice = "nova";

  await refreshSmart();
  await maybeJournalize();   // roll yesterday's talk into the journal

  // auto-update notices (installed builds only)
  if (bridge && bridge.onUpdateAvailable) {
    bridge.onUpdateAvailable((v) => toast(`A new Aqua version (${v}) is downloading…`, 5000));
    bridge.onUpdateDownloaded(() => toast("Update ready — type /update to install now.", 8000));
  }

  const greeting = brain.greeting();
  addMessage("aqua", greeting);

  if (mem.data.recent_exchanges && mem.data.recent_exchanges.length) {
    addDivider("last time");
    for (const ex of mem.data.recent_exchanges) {
      addMessage("user", ex.user);
      addMessage("aqua", ex.aqua);
    }
  }

  const openJobs = Tasks.open(mem.data.tasks);
  if (openJobs.length) {
    addMessage("aqua", `You've got ${openJobs.length} open job${openJobs.length === 1 ? "" : "s"} on the board — tap 🧰 when you're ready to dig in.`);
  }

  if (!smart.on) {
    addMessage("aqua", "Tip: open ⚙️ Settings to connect my OpenAI brain — or just talk to me like this for now.");
  }

  if ("Notification" in window && Notification.permission === "default") {
    try { Notification.requestPermission().catch(() => {}); } catch (e) {}
  }

  setInterval(checkReminders, 10000);

  setSendDisabled(false);
  input.focus();

  setTimeout(() => { if (Speaker.enabled) Speaker.say(greeting); }, 400);
}

document.addEventListener("DOMContentLoaded", boot);
