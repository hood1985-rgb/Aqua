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
async function handleUserText(text) {
  text = (text || "").trim();
  if (!text) return;
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
    } else if (brain.isExit(text)) {
      hideTyping();
      reply = brain.farewell();
      mem.addExchange(text, reply);
      mem.save();
      Speaker.say(reply);
      addMessage("aqua", reply);
      action = "quit";
    } else if (smart.on && bridge) {
      brain.learnFrom(text);  // she still learns, even with an OpenAI brain
      try {
        hideTyping();
        reply = await streamSmartReply(text);   // speaks sentence-by-sentence
        mem.addExchange(text, reply);
        mem.save();
      } catch (e) {
        if (String(e && e.message).includes("no-key")) {
          smart.on = false;
          updateBrainStatus();
        }
        toast("OpenAI hiccup — I'll use my built-in brain this once.");
        reply = brain.respond(text);
        mem.addExchange(text, reply);
        mem.save();
        Speaker.say(reply);
        addMessage("aqua", reply);
      }
    } else {
      hideTyping();
      reply = brain.respond(text);
      mem.addExchange(text, reply);
      mem.save();
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

  if (action) handleAction(action);
  busy = false;
  setSendDisabled(false);
  if (!Speaker._speaking) setFaceState("idle");
}

/* Stream her OpenAI reply word-by-word into a live bubble, and start
   speaking each sentence as soon as it's complete — she responds sooner. */
function streamSmartReply(text) {
  return new Promise((resolve, reject) => {
    const messages = [{ role: "system", content: brain.systemPrompt() }]
      .concat(mem.historyForLLM())
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
        if (t) { Speaker.say(t); spoke = true; }
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
        const final = (res && res.reply) ? res.reply : acc;
        bubble.textContent = final || "Hmm, my brain came back empty. Try me again?";
        scrollToBottom();
        // Speak only what's left: the buffered tail we haven't said yet. If no
        // chunks came through at all (sentenceBuf empty), say the whole reply.
        const leftover = (sentenceBuf.trim() || (!spoke ? final : "")).trim();
        if (leftover) { Speaker.say(leftover); spoke = true; }
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
    case "show_journal": openPanel("journal"); break;
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
  /brain           which brain she's thinking with
  /settings        connect her OpenAI brain (API key)
  /backup          export her memory to a file
  /reset           wipe everything she knows (asks first)
  /quit            say goodbye and close

Tips:
  * Press Enter to send, Shift+Enter for a new line.
  * Tap the microphone to talk, or the headphones for hands-free.
  * Say "Hey Aqua" when the wake word is on.
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
      out.reply = smart.on
        ? `OpenAI brain — model ${smart.model}. I'm thinking with OpenAI, but I still learn and remember the same way.`
        : "Built-in local brain. Open Settings (⚙️) to connect my OpenAI brain with your API key.";
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
  micTimer = setTimeout(() => { if (recording) stopRecordingEarly(); }, 16000);

  await stopped;

  recording = false;
  micRecorder = null;
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
      await handleUserText(res.text);
    }
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
  mem.data.daily.lines.push({ u, a });
  if (mem.data.daily.lines.length > 500) mem.data.daily.lines = mem.data.daily.lines.slice(-500);
  mem.save();   // persist as we go so a closed window can't lose the day
}

async function journalizeDay(date, lines) {
  const dayFacts = mem.allFacts().filter((f) => String(f.date || "").slice(0, 10) === date);
  if (smart.on && bridge) {
    try {
      const prompt = Journal.buildJournalPrompt({ date, transcript: lines, name: mem.name });
      const res = await bridge.chat({
        messages: [{ role: "system", content: "You are Aqua." }, { role: "user", content: prompt }],
        model: smart.model,
      });
      const text = (res && res.reply || "").trim();
      if (text) return { date, text };
    } catch (e) { /* fall through to the local summary */ }
  }
  return { date, text: Journal.summarizeLocal({ lines, facts: dayFacts, name: mem.name }) };
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
  else if (which === "journal") renderJournal();
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

  mem.data.pool = mem.data.pool || Object.assign({}, Pool.DEFAULT_POOL);
  mem.data.tasks = mem.data.tasks || [];
  mem.data.reminders = mem.data.reminders || [];
  mem.data.customers = mem.data.customers || [];
  mem.data.journal = mem.data.journal || [];
  if (!mem.data.tts_model) mem.data.tts_model = "tts-1";
  if (mem.data.volume == null) mem.data.volume = 1.2;   // louder by default

  setupVoices();
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
