/* Headless smoke-drive of Aqua's renderer (app.js) in Node.
   Stubs the browser environment, loads the real app, boots it, and simulates
   typing + commands. Run:  SCENARIO=local node tests/app.test.js
                           SCENARIO=openai node tests/app.test.js
   Not part of the shipped app. */

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const APP = path.join(__dirname, "..");
const SCENARIO = process.env.SCENARIO || "local"; // local | openai

/* ---------------- browser globals ---------------- */
globalThis.window = globalThis;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const spoken = [];
globalThis.speechSynthesis = {
  getVoices: () => [],
  cancel: () => {},
  speak: (u) => { spoken.push(String(u.text)); setTimeout(() => u.onend && u.onend(), 0); },
  onvoiceschanged: undefined,
};
globalThis.SpeechSynthesisUtterance = function (text) {
  this.text = text; this.volume = 1; this.rate = 1; this.pitch = 1; this.voice = null;
  this.onend = null; this.onerror = null;
};
globalThis.AudioContext = globalThis.webkitAudioContext = function () {
  return {
    state: "running", resume() {}, destination: {},
    createBufferSource: () => ({}),
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    decodeAudioData: (_b, _ok, err) => err && err(new Error("no decode")),
  };
};
globalThis.Audio = function () {
  this.volume = 1; this.pause = () => {}; this.onended = null; this.onerror = null;
  this.play = () => Promise.reject(new Error("no audio element"));
};
globalThis.Notification = function (title, opts) { this.title = title; this.body = opts && opts.body; };
globalThis.Notification.permission = "default";
globalThis.Notification.requestPermission = () => Promise.resolve("denied");
globalThis.FileReader = function () { this.readAsText = () => {}; };
globalThis.MediaRecorder = function (_s, opts) {
  this.state = "inactive"; this.mimeType = (opts && opts.mimeType) || "";
  this.start = () => { this.state = "recording"; };
  this.stop = () => { this.state = "inactive"; this.onstop && this.onstop(); };
};
Object.defineProperty(globalThis, "navigator", {
  value: { mediaDevices: { getUserMedia: () => Promise.reject(new Error("no mic")) } },
  configurable: true,
  writable: true,
});

const jsonResp = (obj) => ({ ok: true, status: 200, json: async () => obj });
globalThis.fetch = async (url) => {
  if (String(url).includes("geocoding-api")) {
    return jsonResp({ results: [{ latitude: 32.7767, longitude: -96.797, name: "Dallas" }] });
  }
  if (String(url).includes("api.open-meteo.com/v1/forecast")) {
    return jsonResp({ daily: {
      time: ["2026-09-11"],
      temperature_2m_max: [34], temperature_2m_min: [18],
      precipitation_sum: [5], weathercode: [95],
      windspeed_10m_max: [30], uv_index_max: [9],
    } });
  }
  throw new Error("unexpected fetch: " + url);
};

/* ---------------- element + document stubs ---------------- */
function el(tag) {
  const node = {
    tag: tag || "div", id: "", className: "", dataset: {}, style: {},
    children: [], listeners: {}, textContent: "", value: "",
    disabled: false, title: "", src: "", alt: "", type: "", accept: "", files: null,
    scrollTop: 0, scrollHeight: 0, parentNode: null, _classes: new Set(),
    classList: {
      add: (...c) => c.forEach((x) => node._classes.add(x)),
      remove: (...c) => c.forEach((x) => node._classes.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !node._classes.has(c) : f; on ? node._classes.add(c) : node._classes.delete(c); return on; },
      contains: (c) => node._classes.has(c),
    },
    addEventListener(t, fn) { (node.listeners[t] ||= []).push(fn); },
    removeEventListener() {},
    appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
    remove() { if (node.parentNode) { const i = node.parentNode.children.indexOf(node); if (i >= 0) node.parentNode.children.splice(i, 1); } },
    querySelectorAll() { return []; },
    focus() {},
    click() { (node.listeners.click || []).forEach((f) => f({ target: node, preventDefault() {}, stopPropagation() {} })); },
  };
  // like a real DOM node, setting innerHTML replaces the children
  let _html = "";
  Object.defineProperty(node, "innerHTML", {
    get: () => _html,
    set: (v) => { _html = String(v); node.children = []; },
    configurable: true,
  });
  return node;
}

const byId = new Map();
const getEl = (id) => { if (!byId.has(id)) byId.set(id, el("div")); return byId.get(id); };
const domListeners = {};
globalThis.document = {
  getElementById: getEl,
  createElement: (t) => el(t),
  body: el("body"),
  addEventListener: (t, fn) => { domListeners[t] = fn; },
};

/* ---------------- mock Electron bridge ---------------- */
let chatChunkCb = null;
let updateInstalled = false;
let updateNotices = [];
const bridge = {
  getConfig: async () => SCENARIO === "openai"
    ? { hasKey: true, model: "gpt-4o-mini", keyHint: "abcd" }
    : { hasKey: false, model: "gpt-4o-mini", keyHint: "" },
  chat: (payload) => new Promise((resolve) => {
    const reply = "Well howdy, darlin'. You're fixin' to get this place squared away. Damn fine work.";
    if (payload.stream && chatChunkCb) {
      setTimeout(() => chatChunkCb("Well howdy, darlin'. "), 5);
      setTimeout(() => chatChunkCb("You're fixin' to get this place squared away."), 15);
      setTimeout(() => chatChunkCb(" Damn fine work."), 25);
      setTimeout(() => resolve({ reply }), 35);
    } else {
      setTimeout(() => resolve({ reply }), 5);
    }
  }),
  transcribe: async () => ({ text: "" }),
  identifySpeaker: async (audio, mime, speakers) => ({ text: "Hey Aqua", speaker: "Robert" }),
  speak: async () => { throw new Error("skip neural audio in harness"); },
  onChatChunk: (cb) => { chatChunkCb = cb; return () => {}; },
  onUpdateAvailable: (cb) => { updateNotices.push("available"); return () => { cb("1.0.1"); }; },
  onUpdateDownloaded: (cb) => { updateNotices.push("downloaded"); return () => { cb(); }; },
  installUpdate: () => { updateInstalled = true; },
  openExternal: async () => {},
};
globalThis.aqua = bridge;

/* Pre-seed the boss profile with enrolled voices (Robert, Angela, Rhonda) so speaker recognition
   has a roster to match against. (Must happen before app.js loads `mem`.) */
store.set("aqua.profile.v1", JSON.stringify({
  created: new Date().toISOString(),
  name: null, sessions: 0, last_seen: null,
  facts: [], asked_questions: [], qa: [], recent_exchanges: [],
  voice_on: true, voice_id: null, rate: 1.0, volume: 1.2,
  people: [
    { id: "pRobert", name: "Robert", ref: "QUJDRA==", refMime: "audio/webm" },
    { id: "pAngela", name: "Angela", age: 9, ref: "QUJDRA==", refMime: "audio/webm" },
    { id: "pRhonda", name: "Rhonda Hood", ref: "QUJDRA==", refMime: "audio/webm" },
  ],
}));

/* Mirror index.html's initial classes (stubs start classless). */
getEl("game-dock").classList.add("hidden");
getEl("panel").classList.add("hidden");
getEl("overlay").classList.add("hidden");
getEl("modal").classList.add("hidden");
getEl("toast").classList.add("hidden");

/* ---------------- load modules as the browser would ---------------- */
const brainMod = require(path.join(APP, "brain.js"));
globalThis.Memory = brainMod.Memory;
globalThis.Brain = brainMod.Brain;
globalThis.kidSafe = brainMod.kidSafe;
globalThis.canadianize = brainMod.canadianize;
require(path.join(APP, "pool.js"));       // sets globalThis.Pool (window === globalThis)
require(path.join(APP, "tools.js"));      // sets globalThis.Tools
require(path.join(APP, "journal.js"));    // sets globalThis.Journal
require(path.join(APP, "weather.js"));    // sets globalThis.Weather
require(path.join(APP, "games.js"));      // sets globalThis.TicTacToe

const appCode = fs.readFileSync(path.join(APP, "app.js"), "utf8");
vm.runInThisContext(appCode, { filename: "app.js" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function type(text) {
  const input = getEl("input");
  input.value = text;
  const kd = (input.listeners.keydown || []);
  if (kd[0]) kd[0]({ key: "Enter", shiftKey: false, preventDefault() {} });
}

function transcript() {
  return getEl("chat-scroll").children.map((row) => {
    const cls = row.className || "";
    if (cls.includes("divider")) return { who: "divider", text: row.textContent };
    const bubble = row.children && row.children[1];
    return { who: cls.includes("aqua") ? "aqua" : "user", text: (bubble && bubble.textContent) || "" };
  }).filter((m) => m.who !== "aqua" || m.text.length > 0);
}

function memoryJSON() {
  const raw = store.get("aqua.profile.v1");
  return raw ? JSON.parse(raw) : null;
}

(async () => {
  console.log(`\n=== Aqua headless drive — scenario: ${SCENARIO} ===\n`);

  // 1) boot the app
  await domListeners.DOMContentLoaded();
  await sleep(700); // let the delayed greeting speech fire

  console.log("— boot transcript —");
  transcript().forEach((m) => console.log(`  [${m.who}] ${String(m.text).slice(0, 90)}`));
  console.log("  brain-status:", getEl("brain-status").textContent);
  assert(spoken.length >= 1, "greeting should have been spoken");
  console.log("  spoken greeting:", JSON.stringify(spoken[0] || ""));

  // 2) a plain conversation turn
  type("I love fishing at Lake Whitney.");
  await sleep(120);
  console.log("\n— after chatting —");
  transcript().slice(-3).forEach((m) => console.log(`  [${m.who}] ${String(m.text).slice(0, 110)}`));

  const mem1 = memoryJSON();
  assert(mem1 && Array.isArray(mem1.facts), "memory should hold facts");
  const hasFishing = mem1.facts.some((f) => /fishing/i.test(f.text));
  console.log("  learned 'fishing' fact:", hasFishing);
  assert(hasFishing, "she should have learned the fishing fact");

  // 3) commands
  const cmds = [
    ["/name Robert", "name"],
    ["/customer add Smith - 15k gal - sand filter", "customer"],
    ["/customers", "customers-list"],
    ["/weather set Dallas", "weather"],
    ["/update", "update-install"],
    ["/help", "help"],
    ["/journal", "journal-panel"],
  ];
  for (const [c, label] of cmds) {
    type(c);
    await sleep(90);
    console.log(`  cmd ${label}: ok`);
  }

  const mem2 = memoryJSON();
  console.log("\n— memory state —");
  console.log("  name:", mem2.name);
  console.log("  customers:", JSON.stringify(mem2.customers && mem2.customers.map((c) => c.text)));
  console.log("  location:", mem2.location);
  console.log("  daily lines:", (mem2.daily && mem2.daily.lines && mem2.daily.lines.length) || 0);
  console.log("  journal entries:", (mem2.journal && mem2.journal.length) || 0);
  console.log("  update installed flag:", updateInstalled);

  assert(mem2.name === "Robert", "name should be saved");
  assert(Array.isArray(mem2.customers) && mem2.customers.length === 1, "one customer on file");
  assert(/smith/i.test(mem2.customers[0].text), "customer text stored");
  assert(mem2.location === "Dallas", "location saved");
  assert(updateInstalled === true, "/update should call installUpdate");
  assert((mem2.daily && mem2.daily.lines && mem2.daily.lines.length) >= 2, "conversation + commands logged to the day");

  // weather UI rendered
  const wout = getEl("weather-out").innerHTML;
  console.log("\n— weather panel output —");
  console.log("  " + wout.replace(/<br\s*\/?>/g, " | ").slice(0, 260));
  assert(/Dallas/.test(wout), "weather should name the city");
  assert(/chlorine|wind|thunder|rain|UV/i.test(wout), "weather tips should mention chemistry");

  // journal panel rendered + summarize-today button
  console.log("\n— journal panel —");
  console.log("  title:", getEl("panel-title").textContent);
  assert(getEl("panel-title").textContent === "Our journal", "journal panel title");
  getEl("journal-now").click();
  await sleep(200);
  const mem3 = memoryJSON();
  console.log("  entries after 'summarize today':", (mem3.journal && mem3.journal.length) || 0);
  assert(mem3.journal && mem3.journal.length >= 1, "summarize-today should create a journal entry");
  console.log("  entry:", JSON.stringify(mem3.journal[0]));

  // voice louder check — her default volume should be 1.2
  console.log("\n— volume default —");
  console.log("  mem volume:", mem3.volume);
  assert(mem3.volume === 1.2, "default volume should be persisted as 1.2 (louder)");

  // tic-tac-toe — tap move + spoken move routing (fresh game per check so
  // the AI's turn never gets in the way)
  {
    console.log("\n— tic-tac-toe (side dock) —");
    assert(getEl("game-dock").classList.contains("hidden"), "dock starts closed");
    const boardCells = () => {
      const walk = (node) => {
        if ((node.className || "").includes("ttt-grid")) return node.children;
        for (const c of node.children || []) { const f = walk(c); if (f) return f; }
        return null;
      };
      return walk(getEl("dock-body")) || [];
    };

    // tap move
    globalThis.startGame();
    await sleep(30);
    assert(!getEl("game-dock").classList.contains("hidden"), "dock opens with the game");
    globalThis.playMoveAt(4);
    await sleep(30);
    const cells1 = boardCells();
    assert(cells1.length === 9, "board should have 9 cells");
    assert(cells1[4].textContent === "X", "center square should be X after tapping");

    // spoken move (fresh game = X's turn, empty board)
    globalThis.startGame();
    await sleep(30);
    const beforeAqua = transcript().filter((m) => m.who === "aqua").length;
    await globalThis.handleUserText("top left");
    await sleep(30);
    const after = transcript();
    const lastMsg = after[after.length - 1];
    assert(lastMsg.who === "user" && /top left/i.test(lastMsg.text), "spoken move should show as the user's move");
    assert(after.filter((m) => m.who === "aqua").length === beforeAqua, "a spoken move should NOT trigger an Aqua chat reply");
    assert(boardCells()[0].textContent === "X", "spoken 'top left' should place X in the top-left");

    // command form (fresh game)
    globalThis.startGame();
    await sleep(30);
    await globalThis.handleUserText("/move bottom right");
    await sleep(30);
    assert(boardCells()[8].textContent === "X", "/move bottom right should place X there");
    console.log("  tap move ✓  spoken move ✓  /move command ✓");
  }

  // speaker recognition — route a turn to an enrolled person's own memory
  if (SCENARIO === "local") {
    console.log("\n— speaker recognition & per-person memory —");
    await globalThis.handleUserText("I have two dogs.", "Robert");
    await sleep(150);
    const personMem = JSON.parse(store.get("aqua.profile.v1:person:pRobert"));
    assert(personMem && Array.isArray(personMem.facts), "Robert should have his own memory profile");
    assert(personMem.facts.some((f) => /two dogs/i.test(f.text)), "Robert's memory should learn the fact");
    const bossMem = JSON.parse(store.get("aqua.profile.v1"));
    assert(!(bossMem.facts || []).some((f) => /two dogs/i.test(f.text)), "boss memory should NOT get Robert's fact");
    console.log("  Robert's facts:", JSON.stringify(personMem.facts.map((f) => f.text)));
    console.log("  speaker chip:", getEl("speaker-chip").textContent);
    assert(getEl("speaker-chip").textContent === "with Robert", "chip should show who she's talking with");
    await globalThis.handleUserText("/whoami", "Robert");
    await sleep(90);
    const who = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/Robert/.test(who.text), "/whoami should name Robert");
    console.log("  /whoami reply:", who.text);

    // unknown voice clears the chip back to the boss (no sticky speaker)
    await globalThis.handleUserText("hi again", null);
    await sleep(90);
    assert(getEl("speaker-chip").textContent === "the boss", "null speaker clears the chip");
    console.log("  sticky-chip fix ✓");

    // strict listening defaults on
    assert(memoryJSON().strict_voices === true, "strict voices should default on");
    console.log("  strict voices default: on ✓");

    // rock-paper-scissors in the dock
    globalThis.openDock("rps");
    globalThis.playRps("rock");
    await sleep(30);
    const rps = memoryJSON().rpsScore;
    assert(rps && (rps.player + rps.aqua + rps.tie) === 1, "rps score should record one round");
    console.log("  rps score:", JSON.stringify(rps));

    // guess-the-number via a spoken number while its tab is up
    globalThis.startGuessGame();
    await sleep(30);
    await globalThis.handleUserText("50");
    await sleep(30);
    const lastU = transcript().filter((m) => m.who === "user").slice(-1)[0];
    assert(/50/.test(lastU.text), "spoken guess should show as the user's message");
    console.log("  spoken guess routed ✓");

    // word guess via /letter
    globalThis.startWordGame();
    await sleep(20);
    await globalThis.handleUserText("/letter e");
    await sleep(30);
    console.log("  /letter routed ✓");

    // Angela's pop quiz + kid-safe chip
    await globalThis.handleUserText("/quiz", "Angela");
    await sleep(60);
    assert(getEl("speaker-chip").textContent === "with Angela", "chip should show Angela");
    const quizQ = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/pop quiz/i.test(quizQ.text) && /reply with your answer/i.test(quizQ.text), "quiz question should be asked");
    console.log("  quiz asked:", quizQ.text.slice(0, 80));
    await globalThis.handleUserText("banana pancakes", "Angela");
    await sleep(60);
    const verdict = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/right|good try|almost|nice effort/i.test(verdict.text), "quiz verdict should be given");
    console.log("  quiz verdict:", verdict.text.slice(0, 80));

    // Rhonda Hood gets her own chip (and her Canadian flavour)
    await globalThis.handleUserText("hello there", "Rhonda Hood");
    await sleep(90);
    assert(getEl("speaker-chip").textContent === "with Rhonda Hood", "chip should show Rhonda Hood");
    console.log("  Rhonda Hood chip ✓");
  }

  if (SCENARIO === "openai") {
    console.log("\n— OpenAI streaming sentences spoken —");
    spoken.forEach((s, i) => console.log(`  ${i}: ${s}`));
    const sentences = spoken.filter((s) => /^Well howdy|You're fixin'|Damn fine work/.test(s));
    assert(sentences.length === 3, "streamed reply should speak 3 complete sentences");
    console.log("  ✓ spoke 3 complete sentences as they arrived");
  }

  console.log(`\nALL HARNESS CHECKS PASSED (${SCENARIO}).`);
  process.exit(0);
})().catch((e) => { console.error("HARNESS FAILURE:", e); process.exit(1); });
