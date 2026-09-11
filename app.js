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

/* ---------------- the Electron bridge (absent when opened in a plain browser) ---------------- */
const bridge = window.aqua || null;

/* ---------------- Aqua's mind ---------------- */
const mem = new Memory(window.localStorage);
let brain = new Brain(mem);

/* smart brain state (OpenAI) */
const smart = { on: false, model: "gpt-4o-mini" };

/* ---------------- her voice (speaking) ---------------- */
const Speaker = {
  available: ("speechSynthesis" in window),
  enabled: true,
  voice: null,
  rate: 1.0,
  voices: [],

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
    if (!this.enabled || !this.available) return;
    const spoken = this.clean(text);
    if (!spoken) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(spoken);
      if (this.voice) u.voice = this.voice;
      u.rate = clamp(this.rate, 0.5, 2);
      u.pitch = 1.0;
      u.volume = 1.0;
      window.speechSynthesis.speak(u);
    } catch (e) { /* never crash the chat over voice */ }
  },

  stop() {
    if (this.available) try { window.speechSynthesis.cancel(); } catch (e) {}
  },
};

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
}

/* ---------------- state ---------------- */
let busy = false;
let recording = false;
let handsfreeOn = false;

const chatScroll = $("chat-scroll");
const input = $("input");
const btnSend = $("btn-send");
const btnMic = $("btn-mic");
const btnHandsfree = $("btn-handsfree");
const btnVoice = $("btn-voice");
const brainStatus = $("brain-status");

/* ---------------- rendering ---------------- */
function addMessage(who, text) {
  const row = document.createElement("div");
  row.className = "msg " + who;
  const avatar = document.createElement("div");
  avatar.className = "bubble-avatar";
  avatar.textContent = who === "aqua" ? "🌊" : "🙂";
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
  avatar.textContent = "🌊";
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
async function handleUserText(text) {
  text = (text || "").trim();
  if (!text) return;
  addMessage("user", text);
  input.value = "";
  autosize();
  busy = true;
  setSendDisabled(true);
  showTyping();

  let reply = "";
  let action = null;

  try {
    if (text.startsWith("/")) {
      const r = handleCommand(text);
      reply = r.reply;
      action = r.action;
      if (r.voice_on !== undefined) setVoiceUI(r.voice_on);
    } else if (brain.isExit(text)) {
      reply = brain.farewell();
      mem.addExchange(text, reply);
      mem.save();
      Speaker.say(reply);
      action = "quit";
    } else if (smart.on && bridge) {
      brain.learnFrom(text);  // she still learns, even with an OpenAI brain
      try {
        reply = await smartReply(text);
      } catch (e) {
        if (String(e && e.message).includes("no-key")) {
          smart.on = false;
          updateBrainStatus();
        }
        toast("OpenAI hiccup — I'll use my built-in brain this once.");
        reply = brain.respond(text);
      }
      mem.addExchange(text, reply);
      mem.save();
      Speaker.say(reply);
    } else {
      reply = brain.respond(text);
      mem.addExchange(text, reply);
      mem.save();
      Speaker.say(reply);
    }
  } catch (e) {
    console.error(e);
    reply = "Hmm, I had a little hiccup thinking about that. Try again?";
  }

  hideTyping();
  if (reply) addMessage("aqua", reply);
  if (action) handleAction(action);
  busy = false;
  setSendDisabled(false);
}

async function smartReply(text) {
  const messages = [{ role: "system", content: brain.systemPrompt() }]
    .concat(mem.historyForLLM())
    .concat([{ role: "user", content: text }]);
  const res = await bridge.chat({ messages, model: smart.model });
  return res.reply;
}

function handleAction(action) {
  switch (action) {
    case "show_profile": openPanel("profile"); break;
    case "show_voices": openPanel("voices"); break;
    case "show_help": openPanel("help"); break;
    case "show_settings": openPanel("settings"); break;
    case "toggle_handsfree": setHandsfree(!handsfreeOn); break;
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
  /voice <name>    switch voice (e.g.  /voice Aria )
  /rate +10%       speak faster (+) or slower (-)
  /handsfree       toggle always-listening mode
  /name <name>     tell her your name
  /forget <word>   forget memories containing that word
  /brain           which brain she's thinking with
  /settings        connect her OpenAI brain (API key)
  /reset           wipe everything she knows (asks first)
  /quit            say goodbye and close

Tips:
  * Press Enter to send, Shift+Enter for a new line.
  * Tap the microphone to talk, or the headphones for hands-free.
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
        const voices = Speaker.loadVoices();
        const q = rest.toLowerCase();
        const v = voices.find((x) =>
          (x.name || "").toLowerCase().includes(q) || (x.lang || "").toLowerCase().includes(q));
        if (v) {
          Speaker.voice = v;
          mem.data.voice_id = v.voiceURI || v.name;
          mem.save();
          out.reply = `Switched to ${v.name}.`;
          Speaker.say("This is my new voice. What do you think?");
        } else {
          out.reply = `I couldn't find a voice matching "${rest}" — open the Voices panel to browse.`;
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
      out.reply = smart.on
        ? `OpenAI brain — model ${smart.model}. I'm thinking with OpenAI, but I still learn and remember the same way.`
        : "Built-in local brain. Open Settings (⚙️) to connect my OpenAI brain with your API key.";
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
    if (res.text) handleUserText(res.text);
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
  micChunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) micChunks.push(e.data); };

  recording = true;
  btnMic.classList.add("listening");
  btnMic.title = "Listening… (tap to stop)";

  const stopped = new Promise((resolve) => { micOnStop = resolve; });
  rec.onstop = () => { if (micOnStop) { micOnStop(); micOnStop = null; } };

  rec.start(250);
  setupSilenceStop(stream).catch(() => {});          // best-effort auto-stop
  micTimer = setTimeout(() => { if (recording) stopRecordingEarly(); }, 16000);

  await stopped;

  recording = false;
  clearTimeout(micTimer);
  btnMic.classList.remove("listening");
  btnMic.title = "Talk with your voice";
  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(micChunks, { type: rec.mimeType || mimeType || "audio/webm" });
  const audio = await blob.arrayBuffer();
  try {
    const res = await bridge.transcribe(audio, rec.mimeType || mimeType || "audio/webm");
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
    const check = () => {
      if (!recording || !micRecorder || micRecorder.state === "inactive") { if (ctx) ctx.close(); return; }
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      if (rms > 0.06) { speechSeen = true; silentMs = 0; }
      else if (speechSeen) { silentMs += 200; if (silentMs >= 1200) { stopRecordingEarly(); ctx.close(); return; } }
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
  if (!on) return;
  if (!bridge) { toast("Open Aqua as the desktop app to use hands-free."); handsfreeOn = false; btnHandsfree.classList.remove("active"); return; }
  toast("Hands-free on — just talk. Say “stop listening” to pause.");
  handsfreeLoop();
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
      await handleUserText(res.text);
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
  if (!Speaker.available) {
    panelBody.innerHTML = `<div class="hint">Voice isn't supported here.</div>`;
    return;
  }
  const voices = Speaker.loadVoices();
  const currentURI = Speaker.voice ? (Speaker.voice.voiceURI || Speaker.voice.name) : null;

  let html = `
    <div class="panel-section">
      <h3>Speaking rate</h3>
      <div class="rate-ctl">
        <button id="rate-down">−</button>
        <div class="rate-val" id="rate-val">${rateText(mem.data.rate || 1.0)}</div>
        <button id="rate-up">+</button>
      </div>
    </div>
    <div class="panel-section">
      <h3>Pick a voice (${voices.length})</h3>`;

  for (const v of voices) {
    const uri = v.voiceURI || v.name;
    const cur = uri === currentURI;
    html += `
      <button class="voice-row ${cur ? "current" : ""}" data-uri="${escapeHtml(uri)}">
        <div><div>${escapeHtml(v.name || "Unnamed voice")}</div><div class="vlabel">${escapeHtml(v.lang || "")}${v.default ? " · default" : ""}</div></div>
        ${cur ? '<span class="check">✓</span>' : ""}
      </button>`;
  }
  html += `<p class="hint" style="margin-top:10px;">These are the voices built into Windows (Microsoft's natural voices).</p></div>`;

  panelBody.innerHTML = html;

  $("rate-down").addEventListener("click", () => {
    const rate = applyRate(-10);
    $("rate-val").textContent = rateText(rate);
  });
  $("rate-up").addEventListener("click", () => {
    const rate = applyRate(10);
    $("rate-val").textContent = rateText(rate);
  });

  panelBody.querySelectorAll(".voice-row").forEach((row) => {
    row.addEventListener("click", () => {
      const uri = row.dataset.uri;
      const v = voices.find((x) => (x.voiceURI || x.name) === uri);
      if (!v) return;
      Speaker.voice = v;
      mem.data.voice_id = v.voiceURI || v.name;
      mem.save();
      Speaker.say("This is my new voice. What do you think?");
      renderVoices();
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
    ["/voice &lt;name&gt;", "switch voice (e.g. /voice Aria)"],
    ["/rate +10%", "speak faster (+) or slower (-)"],
    ["/handsfree", "always-listening mode"],
    ["/name Robert", "tell her your name"],
    ["/forget word", "forget memories with that word"],
    ["/brain", "which brain she's using"],
    ["/settings", "connect her OpenAI brain"],
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
      <p class="hint">• <b>Speaking:</b> she uses Windows' natural voices.<br>
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

  setupVoices();
  Speaker.enabled = mem.data.voice_on !== false;
  setVoiceUI(Speaker.enabled);

  await refreshSmart();

  const greeting = brain.greeting();
  addMessage("aqua", greeting);

  if (mem.data.recent_exchanges && mem.data.recent_exchanges.length) {
    addDivider("last time");
    for (const ex of mem.data.recent_exchanges) {
      addMessage("user", ex.user);
      addMessage("aqua", ex.aqua);
    }
  }

  if (!smart.on) {
    addMessage("aqua", "Tip: open ⚙️ Settings to connect my OpenAI brain — or just talk to me like this for now.");
  }

  setSendDisabled(false);
  input.focus();

  setTimeout(() => { if (Speaker.enabled) Speaker.say(greeting); }, 400);
}

document.addEventListener("DOMContentLoaded", boot);
