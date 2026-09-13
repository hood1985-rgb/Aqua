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
const plannedOps = [];   // ops the "phone" will deliver on the next sync push
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
  photoSave: async () => ({ file: "mock.jpg" }),
  photoGet: async () => ({ dataUrl: "data:image/jpeg;base64,AAA" }),
  photoList: async () => ({ files: [] }),
  photoDelete: async () => true,
  syncStart: async () => ({ port: 8138, urls: ["http://192.168.1.5:8138"], pin: "123456" }),
  syncPush: async () => ({ ops: plannedOps.splice(0) }),
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
require(path.join(APP, "biz.js"));        // sets globalThis.Inventory etc.

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

    // Rhonda's Canadian bit: trigger, wording, voice picking, quip, toggle
    assert(globalThis.isRhondaName("Rhonda Hood") === true, "full name matches");
    assert(globalThis.isRhondaName("Rhonda") === true, "first name matches");
    assert(globalThis.isRhondaName("Robert") === false, "anyone else does not");
    assert(globalThis.isRhonda() === true, "Rhonda still on the mic");
    const favQ = globalThis.forAudience("What's your favorite color?");
    assert(/favourite colour/.test(favQ), "Rhonda hears favourite/colour, got: " + favQ);
    await globalThis.handleUserText("howdy", "Robert");
    await sleep(60);
    assert(globalThis.isRhonda() === false, "Robert is not Rhonda");
    assert.strictEqual(globalThis.forAudience("What's your favorite color?"), "What's your favorite color?");
    const fakeVoices = [
      { name: "Microsoft Zira", lang: "en-US", voiceURI: "zira" },
      { name: "Microsoft Richard", lang: "en-CA", voiceURI: "richard" },
    ];
    const picked = globalThis.pickCanadianVoice(fakeVoices);
    assert(picked && picked.lang === "en-CA", "Canadian voice picked");
    assert.strictEqual(globalThis.pickCanadianVoice([{ name: "Zira", lang: "en-US" }]), null, "null when none installed");
    // switching back to Rhonda mid-day gets the hello quip (once per session)
    await globalThis.handleUserText("hey again", "Rhonda Hood");
    await sleep(60);
    const recent = transcript().filter((m) => m.who === "aqua").map((m) => m.text).join("\n");
    assert(/Good to hear you, eh\?/.test(recent), "Rhonda gets the hello quip on re-switch");
    // the toggle kills the whole bit
    await globalThis.handleUserText("/canadian off");
    await sleep(60);
    assert(globalThis.isRhonda() === false, "toggle off disables Rhonda mode");
    assert.strictEqual(globalThis.forAudience("What's your favorite color?"), "What's your favorite color?");
    await globalThis.handleUserText("/canadian on");
    await sleep(60);
    assert(globalThis.isRhonda() === true, "toggle on restores it");
    console.log("  Rhonda's Canadian bit ✓");

    // connect four in the dock + spoken column
    globalThis.startCfGame();
    await sleep(30);
    assert(!getEl("game-dock").classList.contains("hidden"), "dock opens for connect four");
    await globalThis.handleUserText("column 4");
    await sleep(30);
    const cfU = transcript().filter((m) => m.who === "user").slice(-1)[0];
    assert(/column 4/i.test(cfU.text), "spoken column should show as the user's move");
    console.log("  connect four spoken drop ✓");

    // checkers via spoken coords
    globalThis.startCheckersGame();
    await sleep(20);
    await globalThis.handleUserText("c3 d4");
    await sleep(30);
    const ckU = transcript().filter((m) => m.who === "user").slice(-1)[0];
    assert(/c3 d4/i.test(ckU.text), "spoken checkers move should show as the user's move");
    console.log("  checkers spoken move ✓");

    // chess via spoken coords
    globalThis.startChessGame();
    await sleep(20);
    await globalThis.handleUserText("e2 e4");
    await sleep(30);
    const chU = transcript().filter((m) => m.who === "user").slice(-1)[0];
    assert(/e2 e4/i.test(chU.text), "spoken chess move should show as the user's move");
    console.log("  chess spoken move ✓");

    // voice notes
    await globalThis.handleUserText("Aqua, jot this down: call the pool store");
    await sleep(60);
    const noteReply = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/jotted|written down|noted/i.test(noteReply.text), "note should be confirmed");
    const memNote = memoryJSON();
    assert((memNote.daily.lines || []).some((l) => /pool store/.test(l.a || "")), "note lands in today's journal lines");
    console.log("  voice note ✓");

    // bare "jot this down" asks, next turn is the note
    await globalThis.handleUserText("jot this down");
    await sleep(60);
    const askReply = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/what should i jot down/i.test(askReply.text), "bare note should ask what");
    await globalThis.handleUserText("buy more chlorine tablets");
    await sleep(60);
    await globalThis.handleUserText("/note check the truck tires");
    await sleep(60);
    const noteCmd = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/jotted/i.test(noteCmd.text), "/note should confirm");
    console.log("  bare note + /note command ✓");

    // route planner
    await globalThis.handleUserText("/route add Smith - filter clean");
    await sleep(60);
    await globalThis.handleUserText("/route addc 1");
    await sleep(60);
    await globalThis.handleUserText("/route");
    await sleep(60);
    const routeReply = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/2 stops/i.test(routeReply.text) && /Smith/i.test(routeReply.text), "route should list both stops");
    await globalThis.handleUserText("/route done 1");
    await sleep(60);
    const memRoute = memoryJSON();
    assert(memRoute.route.length === 2, "two stops stored");
    assert(memRoute.routeDone.ids.length === 1, "one stop checked off");
    console.log("  route planner ✓");

    // spanish mode + cheat sheet
    await globalThis.handleUserText("/spanish on");
    await sleep(60);
    const esReply = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/español/i.test(esReply.text), "spanish mode should confirm");
    assert(memoryJSON().spanish === true, "spanish flag stored");
    await globalThis.handleUserText("/pool-es");
    await sleep(60);
    const cheat = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/cloro/i.test(cheat.text), "cheat sheet should show");
    await globalThis.handleUserText("/spanish off");
    await sleep(60);
    assert(memoryJSON().spanish !== true, "spanish flag cleared");
    console.log("  spanish mode ✓");

    // truck view
    await globalThis.handleUserText("/truck");
    await sleep(120);
    assert(getEl("panel-title").textContent === "Truck view", "truck panel title");
    console.log("  truck view ✓");

    // per-person wake-up greeting fired for Angela
    const allAqua = transcript().filter((m) => m.who === "aqua").map((m) => m.text).join("\n");
    assert(/Good (morning|afternoon|evening), Angela!/.test(allAqua), "Angela should get a wake-up greeting");
    const memP = memoryJSON();
    const angela = (memP.people || []).find((x) => x.name === "Angela");
    assert(angela && angela.lastDaily, "Angela's daily greeting stamped");
    console.log("  wake-up greeting ✓");

    // spelling drill for Angela (+ the skip escape hatch)
    await globalThis.handleUserText("/quiz spelling", "Angela");
    await sleep(60);
    const spellQ = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/\(spelling\)/i.test(spellQ.text), "spelling drill should be spelling, got: " + spellQ.text.slice(0, 60));
    await globalThis.handleUserText("skip", "Angela");
    await sleep(90);
    console.log("  spelling drill ✓");

    // ---- r17: shop tools ----
    // chemical inventory
    await globalThis.handleUserText("/stock add shock 4 bags");
    await sleep(60);
    let m17 = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/shock/i.test(m17.text), "stock add should confirm, got: " + m17.text.slice(0, 80));
    await globalThis.handleUserText("/stock use shock 3");
    await sleep(60);
    m17 = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/LOW/.test(m17.text), "using down to 1 of low-2 should warn, got: " + m17.text.slice(0, 80));
    await globalThis.handleUserText("/stock buy");
    await sleep(60);
    m17 = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/shock/i.test(m17.text), "buy list should flag shock");
    console.log("  stock ✓");

    // text draft (customer #1 is Smith, added earlier)
    await globalThis.handleUserText("/text 1 late 20");
    await sleep(60);
    m17 = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/20 minutes late/.test(m17.text) && /Smith/.test(m17.text),
      "text draft should name Smith + 20 min, got: " + m17.text.slice(0, 100));
    console.log("  text draft ✓");

    // occasions
    await globalThis.handleUserText("/birthday add Angela 9/16/2016");
    await sleep(60);
    await globalThis.handleUserText("/birthday");
    await sleep(60);
    m17 = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/Angela/.test(m17.text), "birthday list should show Angela");
    console.log("  occasions ✓");

    // invoice (route holds 2 stops from the r16 checks)
    await globalThis.handleUserText("/invoice");
    await sleep(60);
    m17 = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/Total: \$130\.00/.test(m17.text),
      "invoice should total 2 stops x $65, got: " + m17.text.slice(0, 120));
    console.log("  invoice ✓");

    // photos (empty) + pool panel smoke (new sections must not throw)
    await globalThis.handleUserText("/photos");
    await sleep(60);
    m17 = transcript().filter((m) => m.who === "aqua").slice(-1)[0];
    assert(/No pool photos yet/.test(m17.text), "photos should report empty");
    getEl("btn-pool").click();
    await sleep(60);
    assert(/Chemical inventory/.test(getEl("panel-body").innerHTML), "pool panel should show inventory");
    console.log("  photos + pool panel ✓");

    // phone sync: pair info in chat, and a phone op lands in memory
    plannedOps.push({ kind: "job-add", text: "phone job from the truck" });
    await globalThis.handleUserText("/sync");
    await sleep(200);
    const syncMsgs = transcript().filter((m) => m.who === "aqua").map((m) => m.text).join("\n");
    assert(/123456/.test(syncMsgs) && /192\.168\.1\.5/.test(syncMsgs), "sync should show PIN + LAN url");
    const memSync = memoryJSON();
    assert((memSync.tasks || []).some((t) => /phone job from the truck/.test(t.text)),
      "phone op should add the job");
    console.log("  phone sync ✓");
  }

  if (SCENARIO === "openai") {
    console.log("\n— OpenAI streaming sentences spoken —");
    spoken.forEach((s, i) => console.log(`  ${i}: ${s}`));
    const sentences = spoken.filter((s) => /^Well howdy|You're fixin'|Damn fine work/.test(s));
    assert(sentences.length === 3, "streamed reply should speak 3 complete sentences");
    console.log("  ✓ spoke 3 complete sentences as they arrived");
  }

  if (SCENARIO === "openai") {
    // Rhonda's neural turns carry accent instructions on the mini-tts model
    await globalThis.handleUserText("hi", "Rhonda Hood");
    await sleep(80);
    const rhondaReq = globalThis.buildSpeakRequest("hello");
    assert(rhondaReq && rhondaReq.model === "gpt-4o-mini-tts", "Rhonda uses the instructions-capable model");
    assert(/Canadian accent/.test(rhondaReq.instructions || ""), "Rhonda gets accent instructions");
    await globalThis.handleUserText("hi", "Robert");
    await sleep(80);
    const plainReq = globalThis.buildSpeakRequest("hello");
    assert(plainReq && plainReq.model === "tts-1" && !plainReq.instructions, "everyone else gets the plain request");
    console.log("  Rhonda neural accent \u2713");
  }

  console.log(`\nALL HARNESS CHECKS PASSED (${SCENARIO}).`);
  process.exit(0);
})().catch((e) => { console.error("HARNESS FAILURE:", e); process.exit(1); });
