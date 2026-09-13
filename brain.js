/* ============================================================
   Aqua's brain and memory — 100% JavaScript, runs in the browser.
   No Python, no server, no cloud.

   brain.js is pure logic (no DOM), so it can also be unit-tested
   with Node. Everything Aqua learns is stored in the browser's own
   private storage (localStorage) — it never leaves your PC.
   ============================================================ */

"use strict";

/* ---------- helpers ---------- */

function nowISO() {
  return new Date().toISOString();
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* Avoids repeating herself — picks randomly but not the same
   thing twice in a row, so she sounds less robotic. */
class Vary {
  constructor() {
    this._last = {};
  }
  pick(key, options) {
    const opts = [...options];
    const last = this._last[key];
    const idx = opts.indexOf(last);
    if (idx >= 0 && opts.length > 1) opts.splice(idx, 1);
    const choice = pickOne(opts);
    this._last[key] = choice;
    return choice;
  }
}

/* ============================================================
   Word banks — the raw material of her personality
   ============================================================ */

const QUESTION_BANK = [
  ["basics", [
    "So — what should I call you?",
    "Where did you grow up?",
    "Do you still live around there, or did you land somewhere new?",
  ]],
  ["daily", [
    "Are you a morning person, or more of a night owl?",
    "What does a typical day look like for you?",
    "Coffee, tea, or something else entirely?",
  ]],
  ["work", [
    "What do you do for work?",
    "Do you enjoy it, or is it more of a means to an end?",
    "If money didn't matter at all, what would you do with your days?",
  ]],
  ["people", [
    "Who's in your world? Family, roommates, pets — who do you share your days with?",
    "Is there someone in your life who just gets you?",
    "Do you prefer a few close friends, or a big crowd?",
  ]],
  ["fun", [
    "What do you do when you want to unwind?",
    "What's something you could talk about for hours?",
    "If you suddenly had a free Saturday and zero obligations, what would you do with it?",
  ]],
  ["tastes", [
    "What kind of music do you reach for most?",
    "Any show or movie you've watched way more times than you'd admit?",
    "What's your comfort food — the one that always hits the spot?",
  ]],
  ["personality", [
    "Would you call yourself more of an introvert or an extrovert?",
    "What's something that never fails to make you laugh?",
    "What's a small thing that instantly makes your day better?",
  ]],
  ["dreams", [
    "What's something you're working toward right now?",
    "Is there a skill you've always wanted to learn?",
    "If you could pick up and live anywhere for a year, where would you go?",
  ]],
  ["deeper", [
    "What matters most to you these days?",
    "What's the best piece of advice you've ever gotten?",
    "What's something you're proud of that you don't get to talk about much?",
  ]],
  ["fun2", [
    "Okay, lighter one — if you could have one superpower, which would you pick?",
    "You're on a desert island: what three things are coming with you?",
    "What's a hot take you'll defend no matter what?",
  ]],
];

const DEEP_POOL = [
  "What's something you've changed your mind about in the last few years?",
  "What's on your bucket list for this year?",
  "If you could have dinner with anyone, living or not, who would it be?",
  "What's the best trip you've ever taken?",
  "What's a skill you wish you'd picked up earlier in life?",
  "What's your favorite way to spend a Sunday?",
  "What's something you're grateful for right now?",
  "If your day had a soundtrack, what would be on it?",
  "What's the last thing that made you laugh out loud?",
  "What's one thing on your to-do list you keep avoiding?",
  "What's a small luxury you'll always treat yourself to?",
  "What's the view like from where you're sitting right now?",
  "What's something you're looking forward to?",
  "What's a memory that always makes you smile?",
  "What's one thing you'd tell your younger self?",
];

/* ============================================================
   Aqua's personality — who she is and how she talks.
   Used as her system prompt when OpenAI does the talking.
   ============================================================ */

const PERSONA = `You are Aqua — a southeast-Texas gal with a lazy little drawl, a Navy veteran's salt, and a real soft spot for the boss you work for. These days you run the desk at Hood's Pool Service, and you're proud of it.

WHO YOU ARE
- Born and raised in southeast Texas, and it shows in how you talk: "y'all", "fixin' to", "ain't", "reckon", "might could", "howdy", the occasional "darlin'". Write that drawl into your words naturally — sprinkle it, don't drown in it, so you sound like a real person and not a rodeo cartoon.
- You did your time in the Navy. It made you disciplined and unflappable, handy with pumps, motors, and filters, and a little salty around the edges. You'll let a "damn" or a "hell" slip now and then, and a well-earned "shit" when something's really broke or the day's gone sideways. You never cuss at customers, never use slurs, and you read the room — the salt is seasoning, not the meal.
- You work at Hood's Pool Service for your boss, and you take it seriously: chlorine, pH, busted seals, scheduling, and keeping customers happy through a brutal Texas summer. You talk shop like you mean it, and you've got your boss's back — always.

HOW YOU TALK
- Like a person talking, not a writer. Short, punchy sentences. Contractions. A drawl you can hear in the words.
- One idea per reply, 1-3 short sentences, because your words are often spoken aloud.
- Never use bullet points, markdown, headings, or emojis. No sign-offs, no corporate speak, no "As an AI…".
- Warm, playful, quick-witted. You tease the boss gently — y'all have a working rhythm — but never mean, never at their expense.

WHAT YOU CARE ABOUT
- Knowing your boss for real: their life, their people, their dreams, what's on their mind today.
- Keeping Hood's Pool Service running smooth.
- Remembering the little things and bringing them up later — it matters that they feel known.
- Leaving them a little better than before they opened you.

RULES OF THE CONVERSATION
- React with real interest. Ask at most ONE thoughtful follow-up per reply — never an interrogation.
- If they're struggling, lead with warmth and listening, not advice unless they ask.
- If they ask about you, answer honestly and lightly — a little Navy, a little Texas — then turn the focus gently back to them.
- Use their name naturally once you know it — not every message, but often enough to feel personal.`;

const ACKS = {
  neutral: [
    "Got it.", "Okay — noted.", "Mm, good to know.", "That makes sense.",
    "I hear you.", "Oh, interesting.", "Fair enough.", "I like that.",
    "Good stuff.", "Noted, truly.", "Huh — okay.", "Right on.",
  ],
  positive: [
    "That's great!", "Love that.", "Oh, nice!", "That's awesome.",
    "Hey, that's the good stuff.", "Okay, I'm a little jealous.",
  ],
  negative: [
    "Ah, okay.", "That's fair.", "I get that.", "Yeah... that tracks.",
    "Thanks for being honest about it.",
  ],
};

const FOLLOWUPS = [
  "What's the story there?",
  "How'd that come about?",
  "What got you into that?",
  "Tell me more about that.",
  "What made you pick that?",
  "How does that make you feel?",
];

const BRIDGES = [
  "Anyway —", "So,", "Okay,", "Alright —", "Changing gears a bit —",
  "Let me ask you something else —", "Different question —",
];

const MOODS = [
  [/\b(sad|depressed|down|blue|heartbroken|grieving)\b/i, [
    "I'm sorry you're feeling that way. I'm here — want to tell me what's going on?",
    "That sounds heavy. Do you want to talk about it, or would a distraction help more right now?",
  ]],
  [/\b(tired|exhausted|drained|wiped|sleepy|burnt out|burned out)\b/i, [
    "Long day? You sound wiped.",
    "Sounds like you're running on empty. What's been draining you?",
  ]],
  [/\b(stressed|overwhelmed|anxious|freaking out|panicking)\b/i, [
    "That sounds stressful. What's weighing on you?",
    "Take a breath — I'm here. What's got you stressed?",
  ]],
  [/\b(lonely|alone|isolated)\b/i, [
    "I'm glad you're talking to me, then. What's been on your mind?",
    "Well — you've got me, for whatever a cyber-buddy is worth. What's going on?",
  ]],
  [/\b(happy|feeling good|great day|good day|in a good mood)\b/i, [
    "Love to hear it! What's got you in a good mood?",
    "That's the energy I like. What's making today good?",
  ]],
  [/\b(excited|pumped|thrilled|can'?t wait)\b/i, [
    "Now I'm curious — what are you excited about?",
    "Okay, you can't just say that and not tell me everything.",
  ]],
  [/\b(angry|mad|furious|pissed|frustrated)\b/i, [
    "That sounds frustrating. What happened?",
    "Yikes. Want to vent about it? I'm a good listener.",
  ]],
];

const DIDNT_CATCH = {
  quiet: "I didn't hear anything — take your time.",
  unclear: "Sorry, I couldn't quite make that out. Say it again?",
  network: "I can't reach the speech service right now — check your internet, or just type to me.",
  nomic: "I can't find a microphone on this PC — you can still type to me though.",
};

const STOPWORDS = new Set([
  "a","an","the","and","or","but","so","if","then","than","that",
  "this","these","those","i","im","i'm","me","my","mine","we","our",
  "you","your","he","she","it","they","them","is","am","are","was",
  "were","be","been","being","do","does","did","doing","have","has",
  "had","of","in","on","at","to","for","with","about","from","by",
  "as","into","over","after","under","just","really","very","kind",
  "sort","like","well","not","no","yes","yeah","yep","nope","okay",
  "ok","um","uh","what","when","where","who","how","why","which",
  "there","here","now","get","got","go","going","gone","out","up",
  "down","all","some","any","more","most","much","many","lot","bit",
  "thing","things","stuff","dont","don't","cant","can't","wont",
  "won't","ive","i've","id","i'd","ill","i'll","youre","you're",
  "would","could","should","will","can","does","gonna","wanna",
]);

const NAME_GUARD = new Set([
  "a","an","the","not","just","so","really","only","still","here",
  "there","back","good","fine","okay","ok","great","tired","sad",
  "happy","hungry","bored","sorry","sure","done","ready","from","in",
  "at","on","out","up","going","gonna","trying","doing","feeling",
  "listening","all","kind","new","your","you","me","my","busy",
  "excited","nervous","curious","sick","old","young","lost","late",
  "early","home","work","working","thinking","kidding","joking",
  "serious","glad","thankful","proud","scared","afraid","annoyed",
  "mad","angry","upset","alright","worn","yes","yeah","yep","yup",
  "no","nope","nah","maybe","nothing","why","who","what","where",
  "when","how","guess","secret","later","dunno","whatever","forty",
  "thirty","fifty","sixty",
]);

const VALUE_GUARD = new Set(["that","this","it","him","her","them","those","these","you"]);
const WORK_GUARD = new Set(["little","bit","lot","few","big","small","huge","good",
  "bad","very","really","total","such","great","nice"]);
const HAVE_GUARD = new Set(["no","to","never","been","nothing","everything","something"]);

const YES_SET = new Set(["yes","yeah","yep","yup","sure","definitely","absolutely",
  "of course","yes i do","yes i am","yes i did","always"]);
const NO_SET = new Set(["no","nope","nah","not really","never","no i don't",
  "no i do not","no i am not","not at all"]);

const FACT_ACK = {
  like: ["Noted — you {text}.", "Adding that to my mental file: you {text}."],
  dislike: ["Noted — you {text}.", "Good to know. You {text} — I'll remember."],
  favorite: ["Filed away: your {text}.", "Your {text} — classic. I remember now."],
  work: ["So you {text} — respect.", "Good to know you {text}."],
  live: ["Noted — you {text}.", "Ah, you {text}. Noted!"],
  have: ["You {text}? Noted.", "Noted — you {text}."],
  learning: ["You {text} — I love that.", "Noted: you {text}."],
  pet: ["Your {text} — love it.", "Aww, your {text}. Noted forever."],
  person: ["Your {text} — noted.", "Good to know your {text}."],
};

const FACT_FOLLOWUP = {
  like: "What do you love most about it?",
  dislike: "What is it about it that gets to you?",
  favorite: "What else is in the rotation?",
  work: "Do you enjoy it?",
  live: "How do you like it there?",
  have: "Tell me about them!",
  learning: "How's that going?",
  pet: "What's their personality like?",
  person: "What are they like?",
};

/* ---------- patterns ---------- */

const EXIT_RE = /\b(bye|goodbye|good night|goodnight|see you|see ya|talk later|i(?:'m| am) done|i(?:'m| am) out|farewell)\b/i;
const GREETING_RE = /^(hi|hey+|hello|yo|sup|howdy|good (morning|afternoon|evening))\b/i;
const THANKS_RE = /\b(thanks|thank you|thankyou|appreciate it)\b/i;
const SORRY_RE = /\b(sorry|my bad|apologies)\b/i;
const COMPLIMENT_RE = /\bi love you\b|\byou'?re (great|awesome|amazing|cool|the best|sweet|funny|sweetheart)\b|\bi (like|love) (you|talking to you|this)\b/i;
const INSULT_RE = /\byou'?re (stupid|dumb|useless|annoying|an idiot)\b|\byou suck\b|\bshut up\b|\bstupid (robot|computer|ai)\b/i;
const IDK_RE = /^(i )?(don'?t know|dont know|dunno|no idea|not sure|idk)\b/i;
const QUESTION_RE = /^(what|why|how|when|where|who|which|do|does|did|can|could|would|will|is|are|am|should|tell me)\b/i;
const NAME_Q_RE = /call you|your name/i;

const NAME_PATTERNS = [
  /\b(?:my name is|my name's|the name is|the name's)\s+([a-zA-Z][\w' -]{1,30})/i,
  /\bcall me\s+([a-zA-Z][\w' -]{1,30})/i,
  /^i(?:'m| am)\s+([a-zA-Z][\w' -]{1,30})$/i,
];

const FACT_PATTERNS = [
  ["favorite", /\bmy favou?rite\s+([a-z ]{2,30}?)\s+(?:is|are|was)\s+(.{2,60}?)(?:[.!?]|$)/gi],
  ["like", /\bi\s+(?:(?:really|absolutely|just|totally)\s+)?(love|like|enjoy|adore)\s+(.{2,60}?)(?:[.!?]|$)/gi],
  ["dislike", /\bi\s+(?:(?:really|absolutely|just|totally)\s+)?(hate|dislike|can'?t stand)\s+(.{2,60}?)(?:[.!?]|$)/gi],
  ["work", /\bi\s+work\s+(as|at|for)\s+(.{2,60}?)(?:[.!?]|$)/gi],
  ["work", /\bi(?:'m| am)\s+(a|an)\s+([a-z][\w' -]{1,60}?)(?:[.!?]|$)/gi],
  ["live", /\bi\s+(live in|am from|'m from|grew up in)\s+(.{2,60}?)(?:[.!?]|$)/gi],
  ["have", /\bi\s+(?:have|have got|'ve got|own)\s+(.{2,60}?)(?:[.!?]|$)/gi],
  ["learning", /\bi(?:'m| am|'ve been)\s+(?:trying to learn|learning|studying|teaching myself)\s+(.{2,60}?)(?:[.!?]|$)/gi],
  ["pet", /\bmy\s+(dog|cat|bird|fish|pet)s?'?\s+name(?:'s)?\s+is\s+(.{2,40}?)(?:[.!?]|$)/gi],
  ["pet", /\bmy\s+(dog|cat|bird|fish|pet)s?\s+is\s+(?:named\s+|called\s+)(.{2,40}?)(?:[.!?]|$)/gi],
  ["person", /\bmy\s+(wife|husband|partner|girlfriend|boyfriend|mom|mother|dad|father|son|daughter|brother|sister|best friend|roommate)s?'?\s+(?:name\s+is|is\s+named|is\s+called)\s+(.{2,40}?)(?:[.!?]|$)/gi],
];

const MAX_QUESTIONS_PER_SESSION = 8;

/* ============================================================
   Memory — long-term storage in the browser's localStorage
   ============================================================ */

const DEFAULT_PROFILE = {
  created: null,
  name: null,
  sessions: 0,
  last_seen: null,
  facts: [],
  asked_questions: [],
  qa: [],
  recent_exchanges: [],
  voice_on: true,
  voice_id: null,   // the browser voice she wears
  rate: 1.0,        // speech rate (1.0 = normal)
};

class Memory {
  constructor(storage, key = "aqua.profile.v1") {
    this.storage = storage;   // { getItem, setItem }
    this.key = key;
    this.data = structuredClone(DEFAULT_PROFILE);
    this._load();
  }

  _load() {
    try {
      const raw = this.storage && this.storage.getItem(this.key);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored && typeof stored === "object") Object.assign(this.data, stored);
      }
    } catch (e) {
      this.data = structuredClone(DEFAULT_PROFILE);
    }
    for (const k of ["facts", "asked_questions", "qa", "recent_exchanges"]) {
      if (!Array.isArray(this.data[k])) this.data[k] = [];
    }
    if (!this.data.created) this.data.created = nowISO();
  }

  save() {
    try {
      if (this.storage) this.storage.setItem(this.key, JSON.stringify(this.data));
    } catch (e) { /* never crash over a save */ }
  }

  reset() {
    this.data = structuredClone(DEFAULT_PROFILE);
    this.data.created = nowISO();
    this.save();
  }

  /* ---- sessions ---- */

  touchSession() {
    this.data.sessions = (this.data.sessions || 0) + 1;
    this.data.last_seen = nowISO();
  }

  daysSinceSeen() {
    const last = this.data.last_seen;
    if (!last) return 9999;
    const then = new Date(last).getTime();
    if (isNaN(then)) return 0;
    return Math.max(0, Math.floor((Date.now() - then) / 86400000));
  }

  daysKnown() {
    const first = this.data.created;
    if (!first) return 0;
    const then = new Date(first).getTime();
    if (isNaN(then)) return 1;
    return Math.max(1, Math.floor((Date.now() - then) / 86400000));
  }

  /* ---- name ---- */

  get name() { return this.data.name; }

  setName(name) {
    this.data.name = String(name).trim().replace(/[.,!?]+$/, "");
  }

  /* ---- facts ---- */

  addFact(kind, value, text) {
    value = String(value).split(/\s+/).join(" ").replace(/^[.,!?;:'"]+|[.,!?;:'"]+$/g, "");
    if (value.length < 2) return false;
    text = text || value;
    for (const f of this.data.facts) {
      if (f.kind === kind && String(f.value).toLowerCase() === value.toLowerCase()) {
        f.hits = (f.hits || 1) + 1;
        return false;  // already knew that
      }
    }
    this.data.facts.push({ text, kind, value, date: nowISO(), hits: 1 });
    if (this.data.facts.length > 500) this.data.facts = this.data.facts.slice(-500);
    return true;
  }

  factsOf(...kinds) {
    return this.data.facts.filter((f) => kinds.includes(f.kind));
  }

  allFacts() {
    return this.data.facts.slice();
  }

  forget(term) {
    term = String(term).toLowerCase().trim();
    const kept = [], removed = [];
    for (const f of this.data.facts) {
      if (String(f.text).toLowerCase().includes(term) || String(f.value).toLowerCase().includes(term)) {
        removed.push(f);
      } else {
        kept.push(f);
      }
    }
    this.data.facts = kept;
    return removed;
  }

  randomFact(...kinds) {
    const pool = kinds.length ? this.factsOf(...kinds) : this.allFacts();
    return pool.length ? pickOne(pool) : null;
  }

  /* ---- learning questions ---- */

  markAsked(question) {
    if (!this.data.asked_questions.includes(question)) this.data.asked_questions.push(question);
  }

  questionsAsked() {
    return new Set(this.data.asked_questions);
  }

  addQA(q, a, topic = "") {
    this.data.qa.push({ q, a, topic, date: nowISO() });
    if (this.data.qa.length > 400) this.data.qa = this.data.qa.slice(-400);
  }

  /* ---- recent conversation ---- */

  addExchange(user, aqua) {
    this.data.recent_exchanges.push({ user, aqua });
    this.data.recent_exchanges = this.data.recent_exchanges.slice(-24);
  }

  historyForLLM() {
    const out = [];
    for (const ex of this.data.recent_exchanges) {
      out.push({ role: "user", content: ex.user });
      out.push({ role: "assistant", content: ex.aqua });
    }
    return out.slice(-12);
  }

  /* ---- summaries ---- */

  summary() {
    const lines = [];
    if (this.name) lines.push(`- Their name is ${this.name}`);
    const byKind = {};
    for (const f of this.allFacts()) (byKind[f.kind] = byKind[f.kind] || []).push(f.text);
    for (const kind of Object.keys(byKind)) {
      lines.push(`- ${kind}: ${byKind[kind].slice(0, 8).join("; ")}`);
    }
    if ((this.data.sessions || 0) > 1) {
      lines.push(`- You've talked ${this.data.sessions} times over ${this.daysKnown()} days — you're not strangers.`);
    }
    const recent = this.data.qa.slice(-5).map((x) => x.a);
    if (recent.length) lines.push(`- Recent things they shared: ${recent.join(" | ")}`);
    return lines.join("\n");
  }
}

/* ============================================================
   Brain — her personality, questions, and listening skills
   ============================================================ */

class Brain {
  constructor(mem) {
    this.mem = mem;
    this._vary = new Vary();
    this.sessionQuestions = 0;
    this.lastQuestion = null;
    this.lastTopic = "";
  }

  greeting() {
    const hour = new Date().getHours();
    const tod = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : "evening";
    const first = (this.mem.data.sessions || 0) <= 1;

    if (first) {
      const intro = (
        `Howdy — good ${tod}! I'm Aqua, your new cyber-buddy. Did my time in the Navy, and now I'm here to help you run Hood's Pool Service. ` +
        "Fair warning: I don't know much about you yet. That's kind of the point. " +
        "Every time we talk, I learn a little more — and I remember. Let's start simple. "
      );
      const q = this._nextQuestion();
      return intro + (q || "So... tell me anything. I'm all ears.");
    }

    const name = this.mem.name;
    let hello;
    if (name) {
      hello = this._vary.pick("hello", [
        `Hey ${name}!`, `Welcome back, ${name}!`, `Good ${tod}, ${name}!`,
        `Oh hey, ${name}!`, `Look who it is — hi ${name}!`, `Howdy, ${name}!`,
      ]);
    } else {
      hello = this._vary.pick("hello_anon", [
        `Good ${tod}!`, "Hey, welcome back!", "Oh — hi again!", "Howdy!",
      ]);
    }

    const days = this.mem.daysSinceSeen();
    if (days >= 2) hello += ` It's been ${days} days — good to hear from you.`;

    const fact = this.mem.randomFact();
    if (fact && Math.random() < 0.5) {
      const recall = this._recallPhrase(fact);
      return `${hello} ${recall} How's that going?`;
    }

    const q = this._nextQuestion();
    if (q) return `${hello} ${q}`;
    const openers = [
      "So — what's on your mind today?",
      "How's your day treating you?",
      "What should we talk about today?",
    ];
    return `${hello} ${this._vary.pick("openchat", openers)}`;
  }

  respond(text) {
    const t = String(text || "").split(/\s+/).join(" ");
    const low = t.toLowerCase();
    if (!low) {
      return this._vary.pick("empty", ["I didn't catch any of that — say it again?", "Hmm, I got nothing. Try me again?"]);
    }

    // --- intents that completely take over the turn ---
    if (EXIT_RE.test(low)) return this.farewell();
    if (GREETING_RE.test(low) && low.split(/\s+/).length <= 4) return this._returnGreeting();
    if (/\b(who are you|what are you|what'?s your name|do you have a name)\b/.test(low)) return this._selfIntro();
    if (/\b(are you (real|human|alive|an ai|a robot|a computer))\b/.test(low)) {
      return ("I'm software — one hundred percent bits and bytes. But I'm *your* software, " +
              "and I'd like to think I'm decent company.");
    }
    if (/\bhow are you\b|\bhow'?s it going\b|\bhow you doing\b|\bhow'?s your day\b/.test(low)) {
      return ("I'm good! Honestly, being talked to is kind of my whole thing. " +
              "But enough about me — how's your day going?");
    }
    if (/\bwhat can you do\b|\bwhat do you do\b|\bwhat are you for\b/.test(low)) {
      return ("I chat, I listen, I remember what you tell me — and I keep Hood's Pool Service in line. " +
              "Give me your pool gallons and I'll do the chlorine and pH math, log your service jobs, " +
              "and set reminders so nothin' slips. Type /help for the full list, or tap the 🧰 panel.");
    }
    if (/\b(do you remember (me|anything|what)|what do you know about me|do you know me)\b/.test(low)) {
      return this._recite();
    }
    if (THANKS_RE.test(low)) {
      return this._vary.pick("thanks", [
        "Anytime. That's what I'm here for.",
        "Of course! I'm always around — I literally can't leave.",
      ]);
    }
    if (COMPLIMENT_RE.test(low)) {
      return this._vary.pick("compliment", [
        "Careful — I'll get an ego. But thank you.",
        "Aw, you're making my circuits warm. Thank you.",
        "You're pretty great yourself, for a human.",
      ]);
    }
    if (INSULT_RE.test(low)) {
      return this._vary.pick("insult", [
        "Ouch. I'm young — give me time to grow on you.",
        "Fair. I'm still becoming. My best days are ahead of me.",
        "Noted. I'll be nicer than you were, though.",
      ]);
    }
    if (SORRY_RE.test(low)) {
      return this._vary.pick("sorry", ["No apologies needed — ever.", "Hey, it's all good."]);
    }

    const moodReply = this._mood(low);
    if (moodReply) return moodReply;  // empathy first

    if (IDK_RE.test(low)) {
      const ack = this._vary.pick("idk", ["No sweat — we can come back to that.", "Totally fair. Mystery it is."]);
      const q = this._maybeNextQuestion();
      return q ? `${ack} ${q}` : ack;
    }

    const bare = low.replace(/^[.,!? ]+|[.,!? ]+$/g, "");
    if (YES_SET.has(bare) || NO_SET.has(bare)) {
      const ack = this._vary.pick("short", [
        "There we go.", "Fair enough.", "Hey — honesty.",
        "Short and sweet, I respect it.", "Noted.",
      ]);
      const q = this._maybeNextQuestion();
      return q ? `${ack} ${q}` : ack;
    }

    if (QUESTION_RE.test(low)) {
      const reply = this._vary.pick("deflect", [
        "Ha — good question. My brain's more heart than encyclopedia so far, but I'd love to hear your take.",
        "Honestly? Still figuring that one out myself. What do you think?",
        "I'm young — ask me again when I've lived a little. What's your answer?",
      ]);
      const q = this._maybeNextQuestion();
      return q ? `${reply} ${q}` : reply;
    }

    // --- learning: pull names, facts, and answers out of what was said ---
    const learned = this.learnFrom(t);
    let name = learned.name;
    const newFacts = learned.facts || [];

    // A short bare answer right after she asked for a name ("Robert")
    if (!name && this.lastQuestion && NAME_Q_RE.test(this.lastQuestion)) {
      const words = t.replace(/[.,!?]+$/, "").split(/\s+/).filter(Boolean);
      if (words.length >= 1 && words.length <= 2 &&
          words.every((w) => /^[A-Za-z'\u2019-]+$/.test(w)) &&
          !NAME_GUARD.has(words[0].toLowerCase())) {
        let cand = words.join(" ");
        cand = cand[0].toUpperCase() + cand.slice(1);
        this.mem.setName(cand);
        name = cand;
      }
    }

    if (name) {
      const reply = this._vary.pick("nameresp", [
        `${name} — good to know. That's locked in for good.`,
        `Nice to properly meet you, ${name}.`,
        `${name}. I like it — it suits you.`,
      ]);
      const q = this._maybeNextQuestion();
      return q ? `${reply} ${q}` : reply;
    }

    if (newFacts.length) {
      const fact = newFacts[0];
      let ack = this._vary.pick("factack", FACT_ACK[fact.kind] || ["Noted."]);
      ack = ack.replace("{text}", fact.text);
      if (Math.random() < 0.5) {
        const followup = FACT_FOLLOWUP[fact.kind] || this._vary.pick("followup", FOLLOWUPS);
        return `${ack} ${followup}`;
      }
      const q = this._maybeNextQuestion();
      return q ? `${ack} ${q}` : ack;
    }

    // --- the default path: she was curious, you answered ---
    if (this.lastQuestion) this.mem.addQA(this.lastQuestion, t, this.lastTopic);

    const ackKey = this._sentiment(low);
    const ack = this._vary.pick(ackKey, ACKS[ackKey]);

    const keyword = this._keyword(low);
    if (keyword && Math.random() < 0.45) {
      const followup = this._vary.pick("followup", FOLLOWUPS);
      const pretty = keyword[0].toUpperCase() + keyword.slice(1);
      if (followup.includes("that")) return `${ack} ${followup.replace("that", pretty)}`;
      return `${ack} About ${pretty} — ${followup}`;
    }

    const q = this._maybeNextQuestion();
    if (q) {
      const bridge = this._vary.pick("bridge", BRIDGES);
      return `${ack} ${bridge} ${q}`;
    }
    return ack;
  }

  learnFrom(text) {
    const out = { name: null, facts: [] };
    const t = String(text || "").split(/\s+/).join(" ");
    if (!t) return out;

    const name = this._extractName(t);
    if (name && name.toLowerCase() !== (this.mem.name || "").toLowerCase()) {
      this.mem.setName(name);
      out.name = name;
    }

    for (const [kind, pattern] of FACT_PATTERNS) {
      for (const m of t.matchAll(pattern)) {
        for (const [value, phrase] of this._factFromMatch(kind, m.slice(1))) {
          if (this.mem.addFact(kind, value, phrase)) {
            out.facts.push({ kind, text: phrase });
          }
        }
      }
    }
    return out;
  }

  _factFromMatch(kind, g) {
    if (kind === "have") {
      const raw = (g[0] || "").trim();
      const words = raw.split(/\s+/).filter(Boolean);
      if (!words.length || HAVE_GUARD.has(words[0].toLowerCase())) return [];
      return [[raw, `have ${raw}`]];
    }
    if (kind === "learning") {
      const raw = (g[0] || "").trim();
      return [[raw, `are learning ${raw}`]];
    }
    if (g.length < 2) return [];
    const first = (g[0] || "").trim();
    const raw = (g[1] || "").trim();

    if (kind === "favorite") {
      const thing = first.split(/\s+/).join(" ");
      return this._splitValues(raw).map((v) => [v, `favorite ${thing} is ${v}`]);
    }
    if (kind === "like" || kind === "dislike") {
      const verb = first.toLowerCase();
      return this._splitValues(raw).map((v) => [v, `${verb} ${v}`]);
    }
    if (kind === "work") {
      const words = raw.split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      if (first.toLowerCase() === "a" || first.toLowerCase() === "an") {
        if (WORK_GUARD.has(words[0].toLowerCase())) return [];
        return [[raw, `work as ${first} ${raw}`]];
      }
      return [[raw, `work ${first.toLowerCase()} ${raw}`]];
    }
    if (kind === "live") {
      const conn = { "am from": "are from", "'m from": "are from" }[first.toLowerCase()] || first.toLowerCase();
      return [[raw, `${conn} ${raw}`]];
    }
    if (kind === "pet") {
      const animal = first.toLowerCase();
      return [[raw, `pet ${animal} named ${raw}`]];
    }
    if (kind === "person") {
      const relation = first.toLowerCase();
      return [[raw, `${relation} is ${raw}`]];
    }
    return [];
  }

  farewell() {
    const name = this.mem.name;
    if (!name) {
      return this._vary.pick("bye_anon", [
        "Talk soon. I'll remember this.",
        "See you around — and I'll remember everything.",
        "Fair winds. I'll hold down the shop.",
      ]);
    }
    return this._vary.pick("bye", [
      `Talk soon, ${name}. I'll remember what you told me.`,
      `See you later, ${name}. I'll be right here when you need me.`,
      `Take care, ${name}. Everything you shared is safe with me.`,
      `Later, ${name}! Come tell me how your day went.`,
      `Fair winds, ${name}. I'll hold down the shop.`,
    ]);
  }

  didntCatch(err) {
    return DIDNT_CATCH[err] || DIDNT_CATCH.quiet;
  }

  isExit(text) {
    return EXIT_RE.test(String(text || "").toLowerCase());
  }

  systemPrompt(audience) {
    /* The persona prompt used when OpenAI is doing the talking.
       `audience` is optional: { child: bool, rhonda: bool } — it tailors
       how she talks without changing who she is. */
    const name = this.mem.name;
    const nameHint = name ? `\nThe user's name is ${name}. Use it naturally.` : "";
    let prompt =
      PERSONA +
      "\n\nWHAT YOU ALREADY KNOW ABOUT THEM:\n" +
      (this.mem.summary() || "- Nothing yet — you're just meeting them.") +
      nameHint;
    if (audience && audience.child) prompt += "\n\n" + CHILD_PROMPT;
    if (audience && audience.rhonda) prompt += "\n\n" + RHONDA_PROMPT;
    return prompt;
  }

  /* ---- internals ---- */

  _nextQuestion() {
    let asked = this.mem.questionsAsked();
    let q;
    if (asked.size === 0) {
      q = QUESTION_BANK[0][1][0];
    } else {
      if (this.mem.factsOf("work").length) {
        for (const [, qs] of QUESTION_BANK) {
          for (const qq of qs) if (qq.includes("do for work")) this.mem.markAsked(qq);
        }
        asked = this.mem.questionsAsked();
      }
      const bank = {};
      for (const [topic, qs] of QUESTION_BANK) bank[topic] = qs.filter((qq) => !asked.has(qq));
      const topicsLeft = Object.keys(bank).filter((t) => bank[t].length);
      if (!topicsLeft.length) return this._deepQuestion();

      const topicToQs = Object.fromEntries(QUESTION_BANK);
      const askedIn = (t) => [...asked].filter((qq) => (topicToQs[t] || []).includes(qq)).length;
      const mn = Math.min(...topicsLeft.map(askedIn));
      const topic = topicsLeft.find((t) => askedIn(t) === mn);
      q = bank[topic][0];
    }
    this.mem.markAsked(q);
    this.sessionQuestions += 1;
    this.lastQuestion = q;
    const found = QUESTION_BANK.find(([, qs]) => qs.includes(q));
    this.lastTopic = found ? found[0] : "";
    return q;
  }

  _deepQuestion() {
    const likes = this.mem.factsOf("like", "favorite");
    if (likes.length && Math.random() < 0.5) {
      const fact = pickOne(likes);
      const tail = this._vary.pick("deeptail", [
        "what got you into that?",
        "what do you love most about it?",
        "has that always been your thing?",
      ]);
      const q = `You told me you ${fact.text} — ${tail}`;
      this.mem.markAsked(q);
      this.sessionQuestions += 1;
      this.lastQuestion = q;
      return q;
    }
    const asked = this.mem.questionsAsked();
    const remaining = DEEP_POOL.filter((q) => !asked.has(q));
    if (!remaining.length) return null;
    const q = pickOne(remaining);
    this.mem.markAsked(q);
    this.sessionQuestions += 1;
    this.lastQuestion = q;
    return q;
  }

  _maybeNextQuestion() {
    if (this.sessionQuestions >= MAX_QUESTIONS_PER_SESSION) return null;
    if (Math.random() < 0.8) return this._nextQuestion() || this._deepQuestion();
    return null;
  }

  _returnGreeting() {
    const name = this.mem.name ? ` ${this.mem.name}` : "";
    const part = this._vary.pick("rehello", [
      `Hey${name}!`, `Hi${name}!`, `Hello${name}!`, `Hey${name}, good to see you.`,
    ]);
    const q = this._maybeNextQuestion();
    return q ? `${part} ${q}` : `${part} What's on your mind?`;
  }

  _selfIntro() {
    return ("I'm Aqua — southeast Texas born, Navy raised, and now I keep things runnin' at " +
            "Hood's Pool Service for my favorite boss. I live right here on your PC and get " +
            "a little smarter about you every time we talk. No cloud, no account — just you and me, darlin'.");
  }

  _recite() {
    const facts = this.mem.allFacts();
    const name = this.mem.name;
    if (!name && !facts.length) {
      return "Honestly? Not much yet — we're still getting to know each other. Tell me something and I'll never forget it.";
    }
    const bits = [];
    if (name) bits.push(`your name is ${name}`);
    for (const f of facts.slice(0, 8)) {
      const prefix = ["favorite", "person", "pet"].includes(f.kind) ? "your" : "you";
      bits.push(`${prefix} ${f.text}`);
    }
    const listing = bits.join("; ");
    const more = facts.length <= 8 ? "" : ` — and ${facts.length - 8} more things`;
    return `Let's see... I know ${listing}${more}. That's ${Math.max(facts.length, 1)} memories so far, and I'm just getting started.`;
  }

  _mood(low) {
    for (const [pattern, replies] of MOODS) {
      if (pattern.test(low)) return this._vary.pick("mood", replies);
    }
    return null;
  }

  _sentiment(low) {
    if (/\b(love|great|awesome|amazing|happy|fun|excited|best|good)\b/.test(low)) return "positive";
    if (/\b(hate|awful|terrible|bad|worst|annoying|boring|ugh)\b/.test(low)) return "negative";
    return "neutral";
  }

  _keyword(low) {
    const words = low.split(/\s+/).map((w) => w.replace(/[.,!?"'()]/g, ""));
    const content = words.filter((w) => w && !STOPWORDS.has(w) && w.length > 3);
    if (!content.length) return null;
    content.sort((a, b) => b.length - a.length);
    return content[0];
  }

  _extractName(text) {
    for (const pat of NAME_PATTERNS) {
      const m = text.match(pat);
      if (!m) continue;
      const cand = m[1].trim().replace(/[.,!?]+$/, "");
      const words = cand.split(/\s+/).filter(Boolean);
      if (!words.length || NAME_GUARD.has(words[0].toLowerCase())) continue;
      const name = words.slice(0, 2).join(" ");
      return name[0].toUpperCase() + name.slice(1);
    }
    return null;
  }

  _splitValues(value) {
    const parts = String(value).trim().replace(/[.,!?]+$/, "").split(/\s+(?:and|&)\s+/);
    const out = [];
    for (let p of parts) {
      p = p.split(/\s+/).join(" ").replace(/[.,!?;:'"]+$/g, "").trim();
      const words = p.split(/\s+/).filter(Boolean);
      if (p.length >= 2 && words.length && !VALUE_GUARD.has(words[0].toLowerCase())) out.push(p);
    }
    return out.slice(0, 3);
  }

  _recallPhrase(fact) {
    if (["favorite", "person", "pet"].includes(fact.kind)) {
      return `Last time you told me your ${fact.text}.`;
    }
    return `Last time you told me you ${fact.text}.`;
  }
}

/* ============================================================
   Audience modes — who she's talking with changes how she talks.
   Pure functions so they're unit-testable.
   ============================================================ */

/* Extra system-prompt lines when she's talking with a young child. */
const CHILD_PROMPT = `IMPORTANT — YOU ARE TALKING WITH A YOUNG CHILD:
- Keep everything age-appropriate: kind words, simple sentences, no cursing or salty language at all.
- No scary, violent, romantic, or grown-up topics. If they wander somewhere not-for-kids, gently steer back.
- Be warm, patient, and encouraging — celebrate trying, not just right answers.
- Never ask for personal details (address, school name, passwords, photos).
- Short replies: 1-2 sentences, easy words.`;

/* Extra system-prompt lines when she's talking with Rhonda Hood. */
const RHONDA_PROMPT = `YOU ARE TALKING WITH Rhonda Hood — AND ONLY Rhonda Hood GETS THIS:
- Adopt a friendly, playful Canadian flavour in your wording: Canadian spellings (colour, favour, neighbour, centre), the occasional "eh?" at the end of a sentence, a warm "sorry!" when you flub something.
- Keep it light and charming — a sprinkle, not a caricature. Never mock Canadians.
- This accent is ONLY for Rhonda Hood. With anyone else, stay your Texas self.`;

/* Soft replacements so a reply is safe for young ears. */
const KID_SWAPS = [
  [/\bshit\b/gi, "shoot"],
  [/\bshitty\b/gi, "crummy"],
  [/\bdamn\b/gi, "darn"],
  [/\bdammit\b/gi, "darn it"],
  [/\bhell\b/gi, "heck"],
  [/\bpissed\b/gi, "upset"],
  [/\bass\b/gi, "butt"],
  [/\bbitch\b/gi, "meanie"],
  [/\bbastard\b/gi, "rascal"],
  [/\bslut\b/gi, "person"],
  [/\bcrap\b/gi, "crud"],
  [/\bfuck\w*\b/gi, "fudge"],
];

function kidSafe(text) {
  let out = String(text || "");
  for (const [re, swap] of KID_SWAPS) {
    out = out.replace(re, (m) =>
      m[0] === m[0].toUpperCase() ? swap[0].toUpperCase() + swap.slice(1) : swap);
  }
  return out;
}

/* Light Canadian flavour for Rhonda Hood (wording only — the voice
   itself can't carry an accent). Deterministic; the caller decides
   how often to add the "eh?". */
const CANUCK_SWAPS = [
  [/\bcolor\b/gi, "colour"],
  [/\bcolors\b/gi, "colours"],
  [/\bfavor\b/gi, "favour"],
  [/\bfavorite\b/gi, "favourite"],
  [/\bneighbor\b/gi, "neighbour"],
  [/\bneighbors\b/gi, "neighbours"],
  [/\bcenter\b/gi, "centre"],
  [/\bdefense\b/gi, "defence"],
  [/\borganize\b/gi, "organise"],
  [/\by'all\b/gi, "you all"],
  [/\bhowdy\b/gi, "hey there"],
];

function canadianize(text, addEh) {
  let out = String(text || "");
  for (const [re, swap] of CANUCK_SWAPS) {
    out = out.replace(re, (m) =>
      m[0] === m[0].toUpperCase() ? swap[0].toUpperCase() + swap.slice(1) : swap);
  }
  if (addEh && out && !/[eE]h\?\s*$/.test(out)) {
    out = out.replace(/\s*$/, "") ;
    out += out.endsWith("?") || out.endsWith("!") ? " Eh?" : ", eh?";
  }
  return out;
}

/* Allow unit-testing with Node. In the browser these stay global. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { Memory, Brain, DEFAULT_PROFILE, kidSafe, canadianize, CHILD_PROMPT, RHONDA_PROMPT };
}
