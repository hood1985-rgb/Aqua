"""Aqua's built-in conversation brain — works fully offline, no API keys.

This module is Aqua's personality: how she greets you, how she listens, the
questions she asks to learn who you are, and how she remembers things between
conversations. If a "smart" backend (Ollama or OpenAI) is detected, it takes
over free-form replies — but this module still drives greetings, memory
extraction, and the learning questions, so she always grows on her own.
"""

from __future__ import annotations

import random
import re
from datetime import datetime

from memory import Memory

# ======================================================================
# Word banks — the raw material of her personality
# ======================================================================

QUESTION_BANK: list[tuple[str, list[str]]] = [
    ("basics", [
        "So — what should I call you?",
        "Where did you grow up?",
        "Do you still live around there, or did you land somewhere new?",
    ]),
    ("daily", [
        "Are you a morning person, or more of a night owl?",
        "What does a typical day look like for you?",
        "Coffee, tea, or something else entirely?",
    ]),
    ("work", [
        "What do you do for work?",
        "Do you enjoy it, or is it more of a means to an end?",
        "If money didn't matter at all, what would you do with your days?",
    ]),
    ("people", [
        "Who's in your world? Family, roommates, pets — who do you share your days with?",
        "Is there someone in your life who just gets you?",
        "Do you prefer a few close friends, or a big crowd?",
    ]),
    ("fun", [
        "What do you do when you want to unwind?",
        "What's something you could talk about for hours?",
        "If you suddenly had a free Saturday and zero obligations, what would you do with it?",
    ]),
    ("tastes", [
        "What kind of music do you reach for most?",
        "Any show or movie you've watched way more times than you'd admit?",
        "What's your comfort food — the one that always hits the spot?",
    ]),
    ("personality", [
        "Would you call yourself more of an introvert or an extrovert?",
        "What's something that never fails to make you laugh?",
        "What's a small thing that instantly makes your day better?",
    ]),
    ("dreams", [
        "What's something you're working toward right now?",
        "Is there a skill you've always wanted to learn?",
        "If you could pick up and live anywhere for a year, where would you go?",
    ]),
    ("deeper", [
        "What matters most to you these days?",
        "What's the best piece of advice you've ever gotten?",
        "What's something you're proud of that you don't get to talk about much?",
    ]),
    ("fun2", [
        "Okay, lighter one — if you could have one superpower, which would you pick?",
        "You're on a desert island: what three things are coming with you?",
        "What's a hot take you'll defend no matter what?",
    ]),
]

# Asked once the main bank runs dry — keeps long-term friendships interesting.
DEEP_POOL = [
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
]

# Idle chatter — Navy & pool jokes she drops when you're quiet for a while
IDLE_JOKES = [
    "So while we're floating here — why did the Navy bring a ladder to the pool? They heard the deck was above sea level!",
    "Okay, idle thought: my pool tried to join the Navy. They said it had great depth but needed more discipline.",
    "Random splash for you — what's a sailor's favorite pool game? Marco Polo, but they always answer 'Aye, Captain!'",
    "Heads up — why don't submarines make good pool toys? They just dive to the bottom and call it stealth mode.",
    "Since we're idle — how does the Navy keep the pool so clean? Permanent swab-the-deck duty, even on the pool deck!",
    "Fun one: why did Aqua want to join the Navy? I heard they have the world's biggest pool. It's called the ocean!",
    "While you were quiet — what did the pool say to the aircraft carrier? Nice try, but I'm the one people actually want to swim in.",
    "Quick Navy joke: why did the admiral bring a rubber duck to the pool? For his tactical bath-time briefing!",
    "Navy wisdom while we drift: never run by the pool, never swim by the runway. Some recruits get confused.",
    "Here's a splash — what's the difference between a Navy recruit and a pool float? One holds air, the other is full of hot air. I'll let you decide!",
    "Since we're just bobbing here — why did the sailor stare at the pool all day? He was told to watch the water. Took it literally.",
    "I asked the Navy if my pool could be a training vessel. They said only if it stops doing cannonballs on command.",
    "Why do Navy folks love pools? It's the only place where 'all hands on deck' means pool party!",
    "What do you call a Navy chef at the pool? A sous-mariner who finally gets to work above water!",
    "Why did the pool enlist? It wanted to go from the shallow end to the deep sea!",
    "Idle splash — why did the sailor bring soap to the pool? He heard they do deep-clean drills!",
]

ACKS = {
    "neutral": [
        "Got it.", "Okay — noted.", "Mm, good to know.", "That makes sense.",
        "I hear you.", "Oh, interesting.", "Fair enough.", "I like that.",
        "Good stuff.", "Noted, truly.", "Huh — okay.", "Right on.",
    ],
    "positive": [
        "That's great!", "Love that.", "Oh, nice!", "That's awesome.",
        "Hey, that's the good stuff.", "Okay, I'm a little jealous.",
    ],
    "negative": [
        "Ah, okay.", "That's fair.", "I get that.", "Yeah... that tracks.",
        "Thanks for being honest about it.",
    ],
}

FOLLOWUPS = [
    "What's the story there?",
    "How'd that come about?",
    "What got you into that?",
    "Tell me more about that.",
    "What made you pick that?",
    "How does that make you feel?",
]

BRIDGES = [
    "Anyway —", "So,", "Okay,", "Alright —", "Changing gears a bit —",
    "Let me ask you something else —", "Different question —",
]

MOODS = [
    (re.compile(r"\b(sad|depressed|down|blue|heartbroken|grieving)\b"), [
        "I'm sorry you're feeling that way. I'm here — want to tell me what's going on?",
        "That sounds heavy. Do you want to talk about it, or would a distraction help more right now?",
    ]),
    (re.compile(r"\b(tired|exhausted|drained|wiped|sleepy|burnt out|burned out)\b"), [
        "Long day? You sound wiped.",
        "Sounds like you're running on empty. What's been draining you?",
    ]),
    (re.compile(r"\b(stressed|overwhelmed|anxious|freaking out|panicking)\b"), [
        "That sounds stressful. What's weighing on you?",
        "Take a breath — I'm here. What's got you stressed?",
    ]),
    (re.compile(r"\b(lonely|alone|isolated)\b"), [
        "I'm glad you're talking to me, then. What's been on your mind?",
        "Well — you've got me, for whatever a cyber-buddy is worth. What's going on?",
    ]),
    (re.compile(r"\b(happy|feeling good|great day|good day|in a good mood)\b"), [
        "Love to hear it! What's got you in a good mood?",
        "That's the energy I like. What's making today good?",
    ]),
    (re.compile(r"\b(excited|pumped|thrilled|can'?t wait)\b"), [
        "Now I'm curious — what are you excited about?",
        "Okay, you can't just say that and not tell me everything.",
    ]),
    (re.compile(r"\b(angry|mad|furious|pissed|frustrated)\b"), [
        "That sounds frustrating. What happened?",
        "Yikes. Want to vent about it? I'm a good listener.",
    ]),
]

DIDNT_CATCH = {
    "quiet": "I didn't hear anything — take your time.",
    "unclear": "Sorry, I couldn't quite make that out. Say it again?",
    "network": "I can't reach the speech service right now — check your internet, or just type to me.",
    "nomic": "I can't find a microphone on this PC — you can still type to me though.",
}

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "so", "if", "then", "than", "that",
    "this", "these", "those", "i", "im", "i'm", "me", "my", "mine", "we", "our",
    "you", "your", "he", "she", "it", "they", "them", "is", "am", "are", "was",
    "were", "be", "been", "being", "do", "does", "did", "doing", "have", "has",
    "had", "of", "in", "on", "at", "to", "for", "with", "about", "from", "by",
    "as", "into", "over", "after", "under", "just", "really", "very", "kind",
    "sort", "like", "well", "not", "no", "yes", "yeah", "yep", "nope", "okay",
    "ok", "um", "uh", "what", "when", "where", "who", "how", "why", "which",
    "there", "here", "now", "get", "got", "go", "going", "gone", "out", "up",
    "down", "all", "some", "any", "more", "most", "much", "many", "lot", "bit",
    "thing", "things", "stuff", "dont", "don't", "cant", "can't", "wont",
    "won't", "ive", "i've", "id", "i'd", "ill", "i'll", "youre", "you're",
    "would", "could", "should", "will", "can", "does", "gonna", "wanna",
}

# Words that must NOT be mistaken for the user's name after "I'm ..." or a bare answer
NAME_GUARD = {
    "a", "an", "the", "not", "just", "so", "really", "only", "still", "here",
    "there", "back", "good", "fine", "okay", "ok", "great", "tired", "sad",
    "happy", "hungry", "bored", "sorry", "sure", "done", "ready", "from", "in",
    "at", "on", "out", "up", "going", "gonna", "trying", "doing", "feeling",
    "listening", "all", "kind", "new", "your", "you", "me", "my", "busy",
    "excited", "nervous", "curious", "sick", "old", "young", "lost", "late",
    "early", "home", "work", "working", "thinking", "kidding", "joking",
    "serious", "glad", "thankful", "proud", "scared", "afraid", "annoyed",
    "mad", "angry", "upset", "alright", "worn", "yes", "yeah", "yep", "yup",
    "no", "nope", "nah", "maybe", "nothing", "why", "who", "what", "where",
    "when", "how", "guess", "secret", "later", "dunno", "whatever", "forty",
    "thirty", "fifty", "sixty", "done", "here", "back", "worn",
}

NAME_PATTERNS = [
    re.compile(r"\b(?:my name is|my name's|the name is|the name's)\s+([a-zA-Z][\w' -]{1,30})", re.I),
    re.compile(r"\bcall me\s+([a-zA-Z][\w' -]{1,30})", re.I),
    re.compile(r"^i(?:'m| am)\s+([a-zA-Z][\w' -]{1,30})$", re.I),
]

FACT_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("favorite", re.compile(
        r"\bmy favou?rite\s+([a-z ]{2,30}?)\s+(?:is|are|was)\s+(.{2,60}?)(?:[.!?]|$)", re.I)),
    ("like", re.compile(
        r"\bi\s+(?:(?:really|absolutely|just|totally)\s+)?(love|like|enjoy|adore)\s+(.{2,60}?)(?:[.!?]|$)", re.I)),
    ("dislike", re.compile(
        r"\bi\s+(?:(?:really|absolutely|just|totally)\s+)?(hate|dislike|can'?t stand)\s+(.{2,60}?)(?:[.!?]|$)", re.I)),
    ("work", re.compile(
        r"\bi\s+work\s+(as|at|for)\s+(.{2,60}?)(?:[.!?]|$)", re.I)),
    ("work", re.compile(
        r"\bi(?:'m| am)\s+(a|an)\s+([a-z][\w' -]{1,60}?)(?:[.!?]|$)", re.I)),
    ("live", re.compile(
        r"\bi\s+(live in|am from|'m from|grew up in)\s+(.{2,60}?)(?:[.!?]|$)", re.I)),
    ("have", re.compile(
        r"\bi\s+(?:have|have got|'ve got|own)\s+(.{2,60}?)(?:[.!?]|$)", re.I)),
    ("learning", re.compile(
        r"\bi(?:'m| am|'ve been)\s+(?:trying to learn|learning|studying|teaching myself)\s+(.{2,60}?)(?:[.!?]|$)", re.I)),
    ("pet", re.compile(
        r"\bmy\s+(dog|cat|bird|fish|pet)s?'?\s+name(?:'s)?\s+is\s+(.{2,40}?)(?:[.!?]|$)", re.I)),
    ("pet", re.compile(
        r"\bmy\s+(dog|cat|bird|fish|pet)s?\s+is\s+(?:named\s+|called\s+)(.{2,40}?)(?:[.!?]|$)", re.I)),
    ("person", re.compile(
        r"\bmy\s+(wife|husband|partner|girlfriend|boyfriend|mom|mother|dad|father|son|daughter|brother|sister|best friend|roommate)s?'?\s+(?:name\s+is|is\s+named|is\s+called)\s+(.{2,40}?)(?:[.!?]|$)", re.I)),
]

# Values that shouldn't become "facts" ("i like that", "i have to go"...)
VALUE_GUARD = {"that", "this", "it", "him", "her", "them", "those", "these", "you"}
WORK_GUARD = {"little", "bit", "lot", "few", "big", "small", "huge", "good",
              "bad", "very", "really", "total", "such", "great", "nice"}
HAVE_GUARD = {"no", "to", "never", "been", "nothing", "everything", "something"}

FACT_ACK = {
    "like": ["Noted — you {text}.", "Adding that to my mental file: you {text}."],
    "dislike": ["Noted — you {text}.", "Good to know. You {text} — I'll remember."],
    "favorite": ["Filed away: your {text}.", "Your {text} — classic. I remember now."],
    "work": ["So you {text} — respect.", "Good to know you {text}."],
    "live": ["Noted — you {text}.", "Ah, you {text}. Noted!"],
    "have": ["You {text}? Noted.", "Noted — you {text}."],
    "learning": ["You {text} — I love that.", "Noted: you {text}."],
    "pet": ["Your {text} — love it.", "Aww, your {text}. Noted forever."],
    "person": ["Your {text} — noted.", "Good to know your {text}."],
}

FACT_FOLLOWUP = {
    "like": "What do you love most about it?",
    "dislike": "What is it about it that gets to you?",
    "favorite": "What else is in the rotation?",
    "work": "Do you enjoy it?",
    "live": "How do you like it there?",
    "have": "Tell me about them!",
    "learning": "How's that going?",
    "pet": "What's their personality like?",
    "person": "What are they like?",
}

WEATHER_RE = re.compile(r"\b(weather|forecast|temperature outside|how.*outside|what.*outside.*like|is it (going to )?rain|will it rain)\b", re.I)
EXIT_RE = re.compile(r"\b(bye|goodbye|good night|goodnight|see you|see ya|talk later|i(?:'m| am) done|i(?:'m| am) out|farewell)\b", re.I)
GREETING_RE = re.compile(r"^(hi|hey+|hello|yo|sup|howdy|good (morning|afternoon|evening))\b", re.I)
THANKS_RE = re.compile(r"\b(thanks|thank you|thankyou|appreciate it)\b", re.I)
SORRY_RE = re.compile(r"\b(sorry|my bad|apologies)\b", re.I)
COMPLIMENT_RE = re.compile(r"\bi love you\b|\byou'?re (great|awesome|amazing|cool|the best|sweet|funny|sweetheart)\b|\bi (like|love) (you|talking to you|this)\b", re.I)
INSULT_RE = re.compile(r"\byou'?re (stupid|dumb|useless|annoying|an idiot)\b|\byou suck\b|\bshut up\b|\bstupid (robot|computer|ai)\b", re.I)
IDK_RE = re.compile(r"^(i )?(don'?t know|dont know|dunno|no idea|not sure|idk)\b", re.I)
# A question aimed at Aqua starts with a question word ("what do you like?")
QUESTION_RE = re.compile(r"^(what|why|how|when|where|who|which|do|does|did|can|could|would|will|is|are|am|should|tell me)\b", re.I)
NAME_Q_RE = re.compile(r"call you|your name", re.I)

YES_SET = {"yes", "yeah", "yep", "yup", "sure", "definitely", "absolutely",
           "of course", "yes i do", "yes i am", "yes i did", "always"}
NO_SET = {"no", "nope", "nah", "not really", "never", "no i don't",
          "no i do not", "no i am not", "not at all"}

MAX_QUESTIONS_PER_SESSION = 8


class _Vary:
    """Picks randomly while avoiding immediate repeats, so she sounds less robotic."""

    def __init__(self) -> None:
        self._last: dict[str, str] = {}

    def pick(self, key: str, options: list[str] | tuple[str, ...]) -> str:
        opts = list(options)
        last = self._last.get(key)
        if last in opts and len(opts) > 1:
            opts.remove(last)
        choice = random.choice(opts)
        self._last[key] = choice
        return choice


class Brain:
    """Aqua's local mind. Feed it what the user said; it returns what Aqua says."""

    def __init__(self, mem: Memory):
        self.mem = mem
        self._vary = _Vary()
        self.session_questions = 0
        self.last_question: str | None = None
        self.last_topic: str = ""

    # ==================================================================
    # Public interface
    # ==================================================================

    def greeting(self) -> str:
        hour = datetime.now().hour
        tod = "morning" if 5 <= hour < 12 else "afternoon" if 12 <= hour < 17 else "evening"
        first = self.mem.data.get("sessions", 0) <= 1

        # Get weather — don't let it break greeting if offline
        weather_text = None
        try:
            from weather import get_weather_report
            weather_text = get_weather_report(self.mem)
        except Exception:
            weather_text = None

        # Default to Joe per startup requirement, but use remembered name if we have it
        display_name = self.mem.name or "Joe"

        if first:
            intro = f"Good {tod}, {display_name}! I'm Aqua, your new cyber-buddy, and I live right here on your PC. "
            if weather_text:
                intro += f"{weather_text} "
            intro += (
                "Fair warning: I don't know much about you yet. That's kind of the point. "
                "Every time we talk, I learn a little more — and I remember. Let's start simple. "
            )
            q = self._next_question()
            return intro + (q or "So... tell me anything. I'm all ears.")

        # Returning user
        if self.mem.name:
            hello = self._vary.pick("hello", [
                f"Good {tod}, {display_name}!",
                f"Good {tod}, {display_name}! Welcome back!",
                f"Hey {display_name}! Good {tod}!",
                f"Oh hey, {display_name}! Good {tod}!",
                f"Look who it is — good {tod}, {display_name}!",
            ])
        else:
            # No name known yet, use Joe as requested
            hello = self._vary.pick("hello_anon", [
                f"Good {tod}, {display_name}!",
                f"Good {tod}, {display_name}! Welcome back!",
                f"Hey {display_name}! Good {tod}!",
            ])

        days = self.mem.days_since_seen()
        days_text = f" It's been {days} days — good to hear from you." if days >= 2 else ""

        weather_part = f" {weather_text}" if weather_text else ""

        # Half the time, open by showing she remembers something real.
        fact = self.mem.random_fact()
        if fact and random.random() < 0.5:
            recall = self._recall_phrase(fact)
            return f"{hello}{days_text}{weather_part} {recall} How's that going?"

        q = self._next_question()
        if q:
            return f"{hello}{days_text}{weather_part} {q}"
        openers = [
            "So — what's on your mind today?",
            "How's your day treating you?",
            "What should we talk about today?",
        ]
        return f"{hello}{days_text}{weather_part} {self._vary.pick('openchat', openers)}"

    def respond(self, text: str) -> str:

        t = " ".join((text or "").split())
        low = t.lower()
        if not low:
            return self._vary.pick("empty", ["I didn't catch any of that — say it again?", "Hmm, I got nothing. Try me again?"])

        # --- intents that completely take over the turn -----------------
        if EXIT_RE.search(low):
            return self.farewell()
        if GREETING_RE.match(low) and len(low.split()) <= 4:
            return self._return_greeting()
        if re.search(r"\b(who are you|what are you|what'?s your name|do you have a name)\b", low):
            return self._self_intro()
        if re.search(r"\b(are you (real|human|alive|an ai|a robot|a computer))\b", low):
            return ("I'm software — one hundred percent bits and bytes. But I'm *your* software, "
                    "and I'd like to think I'm decent company.")
        if re.search(r"\bhow are you\b|\bhow'?s it going\b|\bhow you doing\b|\bhow'?s your day\b", low):
            return ("I'm good! Honestly, being talked to is kind of my whole thing. "
                    "But enough about me — how's your day going?")
        if WEATHER_RE.search(low):
            try:
                from weather import get_weather_report
                report = get_weather_report(self.mem)
                return report
            except Exception:
                return "I tried to check the weather but couldn't reach the service right now."

        if re.search(r"\bwhat can you do\b|\bwhat do you do\b|\bwhat are you for\b", low):
            return ("Right now? I chat, I listen, and I remember what you tell me, so I get to know you "
                    "better every time we talk. Type /help to see all my tricks, or /profile to peek at "
                    "what I've learned about you.")
        if re.search(r"\b(do you remember (me|anything|what)|what do you know about me|do you know me)\b", low):
            return self._recite()
        if THANKS_RE.search(low):
            return self._vary.pick("thanks", [
                "Anytime. That's what I'm here for.",
                "Of course! I'm always around — I literally can't leave.",
            ])
        if COMPLIMENT_RE.search(low):
            return self._vary.pick("compliment", [
                "Careful — I'll get an ego. But thank you.",
                "Aw, you're making my circuits warm. Thank you.",
                "You're pretty great yourself, for a human.",
            ])
        if INSULT_RE.search(low):
            return self._vary.pick("insult", [
                "Ouch. I'm young — give me time to grow on you.",
                "Fair. I'm still becoming. My best days are ahead of me.",
                "Noted. I'll be nicer than you were, though.",
            ])
        if SORRY_RE.search(low):
            return self._vary.pick("sorry", ["No apologies needed — ever.", "Hey, it's all good."])

        mood_reply = self._mood(low)
        if mood_reply:
            return mood_reply  # empathy first; no interrogation when someone's down

        if IDK_RE.match(low):
            ack = self._vary.pick("idk", ["No sweat — we can come back to that.", "Totally fair. Mystery it is."])
            q = self._maybe_next_question()
            return f"{ack} {q}" if q else ack

        bare = low.strip(".,!? ")
        if bare in YES_SET or bare in NO_SET:
            ack = self._vary.pick("short", [
                "There we go.", "Fair enough.", "Hey — honesty.",
                "Short and sweet, I respect it.", "Noted.",
            ])
            q = self._maybe_next_question()
            return f"{ack} {q}" if q else ack

        # A question aimed at her — answer honestly and hand it back
        if QUESTION_RE.match(low):
            reply = self._vary.pick("deflect", [
                "Ha — good question. My brain's more heart than encyclopedia so far, but I'd love to hear your take.",
                "Honestly? Still figuring that one out myself. What do you think?",
                "I'm young — ask me again when I've lived a little. What's your answer?",
            ])
            q = self._maybe_next_question()
            return f"{reply} {q}" if q else reply

        # --- learning: pull names, facts, and answers out of what was said
        learned = self.learn_from(t)
        name = learned.get("name")
        new_facts = learned.get("facts") or []

        # A short bare answer right after she asked for a name ("Robert")
        if not name and self.last_question and NAME_Q_RE.search(self.last_question):
            words = [w for w in t.strip(".,!?").split() if w]
            if (1 <= len(words) <= 2
                    and all(re.match(r"^[A-Za-z'\u2019-]+$", w) for w in words)
                    and words[0].lower() not in NAME_GUARD):
                cand = " ".join(words)
                cand = cand[0].upper() + cand[1:]
                self.mem.set_name(cand)
                name = cand

        if name:
            reply = self._vary.pick("nameresp", [
                f"{name} — good to know. That's locked in for good.",
                f"Nice to properly meet you, {name}.",
                f"{name}. I like it — it suits you.",
            ])
            q = self._maybe_next_question()
            return f"{reply} {q}" if q else reply

        if new_facts:
            fact = new_facts[0]
            ack = self._vary.pick("factack", FACT_ACK.get(fact["kind"], ["Noted."]))
            ack = ack.replace("{text}", fact["text"])
            if random.random() < 0.5:
                followup = FACT_FOLLOWUP.get(fact["kind"]) or self._vary.pick("followup", FOLLOWUPS)
                return f"{ack} {followup}"
            q = self._maybe_next_question()
            return f"{ack} {q}" if q else ack

        # --- the default path: she was curious about something, you answered
        if self.last_question:
            self.mem.add_qa(self.last_question, t, self.last_topic)

        ack_key = self._sentiment(low)
        ack = self._vary.pick(ack_key, ACKS[ack_key])

        # Sometimes dig deeper into the answer instead of jumping ahead.
        keyword = self._keyword(low)
        if keyword and random.random() < 0.45:
            followup = self._vary.pick("followup", FOLLOWUPS)
            pretty = keyword[0].upper() + keyword[1:]
            if "that" in followup:
                return f"{ack} {followup.replace('that', pretty, 1)}"
            return f"{ack} About {pretty} — {followup}"

        q = self._maybe_next_question()
        if q:
            bridge = self._vary.pick("bridge", BRIDGES)
            return f"{ack} {bridge} {q}"
        return ack

    def learn_from(self, text: str) -> dict:
        """Silently extract memories from something the user said (used by smart-brain mode too)."""
        out: dict = {"name": None, "facts": []}
        t = " ".join((text or "").split())
        if not t:
            return out

        name = self._extract_name(t)
        if name and name.lower() != (self.mem.name or "").lower():
            self.mem.set_name(name)
            out["name"] = name

        for kind, pattern in FACT_PATTERNS:
            for m in pattern.finditer(t):
                for value, phrase in self._fact_from_match(kind, m.groups()):
                    if self.mem.add_fact(kind, value, phrase):
                        out["facts"].append({"kind": kind, "text": phrase})
        return out

    def _fact_from_match(self, kind: str, g: tuple) -> list[tuple[str, str]]:
        """Turn one regex match into [(value, memory-phrase), ...] with guards applied."""
        if kind == "have":
            raw = g[0].strip()
            words = raw.split()
            if not words or words[0].lower() in HAVE_GUARD:
                return []
            return [(raw, f"have {raw}")]

        if kind == "learning":
            raw = g[0].strip()
            return [(raw, f"are learning {raw}")]

        if len(g) < 2:
            return []
        first, raw = g[0].strip(), g[1].strip()

        if kind == "favorite":
            thing = " ".join(first.split())
            return [(v, f"favorite {thing} is {v}") for v in self._split_values(raw)]

        if kind in ("like", "dislike"):
            verb = first.lower()
            return [(v, f"{verb} {v}") for v in self._split_values(raw)]

        if kind == "work":
            words = raw.split()
            if not words:
                return []
            if first.lower() in ("a", "an"):        # "I'm a teacher"
                if words[0].lower() in WORK_GUARD:
                    return []
                return [(raw, f"work as {first} {raw}")]
            return [(raw, f"work {first.lower()} {raw}")]  # "I work at/for/as ..."

        if kind == "live":
            conn = {"am from": "are from", "'m from": "are from"}.get(first.lower(), first.lower())
            return [(raw, f"{conn} {raw}")]

        if kind == "have":
            words = raw.split()
            if not words or words[0].lower() in HAVE_GUARD:
                return []
            return [(raw, f"have {raw}")]

        if kind == "learning":
            return [(raw, f"are learning {raw}")]

        if kind == "pet":
            animal = first.lower()
            return [(raw, f"pet {animal} named {raw}")]

        if kind == "person":
            relation = first.lower()
            return [(raw, f"{relation} is {raw}")]

        return []

    def farewell(self) -> str:
        name = self.mem.name
        if not name:
            return self._vary.pick("bye_anon", [
                "Talk soon. I'll remember this.",
                "See you around — and I'll remember everything.",
                "Bye for now! Go make a splash somewhere — I'll be here when you get back.",
                "Signing off. Thanks for hanging out in my little pool!",
            ])
        return self._vary.pick("bye", [
            f"Talk soon, {name}. I'll remember what you told me.",
            f"See you later, {name}. I'll be right here when you need me.",
            f"Take care, {name}. Everything you shared is safe with me.",
            f"Later, {name}! Come tell me how your day went.",
            f"Bye, {name}! Don't be a stranger — my pool's always open for you.",
            f"See ya, {name}! Go show the Navy how it's done. I'll be here, keeping the pool warm.",
        ])

    def idle_joke(self) -> str:
        """Return a random Navy / pool joke for idle chatter (avoids immediate repeats)."""
        return self._vary.pick("idle_joke", IDLE_JOKES)

    def didnt_catch(self, err: str) -> str:
        return DIDNT_CATCH.get(err, DIDNT_CATCH["quiet"])

    def is_exit(self, text: str) -> bool:
        return bool(EXIT_RE.search((text or "").lower()))

    def system_prompt(self) -> str:
        """The persona prompt used when a smart brain (Ollama/OpenAI) is doing the talking."""
        return (
            "You are Aqua, a warm, curious personal assistant and cyber-buddy running on the user's "
            "Windows PC. You speak like a person, not a robot: short conversational sentences, "
            "contractions, genuine warmth, a little wit. Never use bullet points, markdown, or emojis. "
            "Keep replies to 1-3 short sentences because they are often spoken aloud. Your mission right "
            "now is getting to know the user: react to what they share with real interest, and ask at "
            "most one thoughtful follow-up question per reply. Naturally remember and reference things "
            "they've told you before.\n\n"
            "What you already know about them:\n"
            + (self.mem.summary() or "- Nothing yet — you're just meeting them.")
        )

    # ==================================================================
    # Internals
    # ==================================================================

    def _next_question(self) -> str | None:
        asked = self.mem.questions_asked()
        # A brand-new friendship always opens the same way: learning their name.
        if not asked:
            q = QUESTION_BANK[0][1][0]
        else:
            # questions she can already answer don't need asking
            if self.mem.facts_of("work"):
                for _topic, qs in QUESTION_BANK:
                    for q_ in qs:
                        if "do for work" in q_:
                            self.mem.mark_asked(q_)
                asked = self.mem.questions_asked()
            bank = {topic: [q for q in qs if q not in asked] for topic, qs in QUESTION_BANK}
            topics_left = [t for t, qs in bank.items() if qs]
            if not topics_left:
                return self._deep_question()

            def asked_in(t: str) -> int:
                return len([q for q in asked if q in dict(QUESTION_BANK).get(t, [])])

            mn = min(asked_in(t) for t in topics_left)
            # among the least-covered topics, keep the natural order of the bank
            topic = next(t for t in topics_left if asked_in(t) == mn)
            q = bank[topic][0]
        self.mem.mark_asked(q)
        self.session_questions += 1
        self.last_question = q
        self.last_topic = next((t for t, qs in QUESTION_BANK if q in qs), "")
        return q

    def _deep_question(self) -> str | None:
        likes = self.mem.facts_of("like", "favorite")
        if likes and random.random() < 0.5:
            fact = random.choice(likes)
            tail = self._vary.pick("deeptail", [
                "what got you into that?",
                "what do you love most about it?",
                "has that always been your thing?",
            ])
            q = f"You told me you {fact['text']} — {tail}"
            self.mem.mark_asked(q)
            self.session_questions += 1
            self.last_question = q
            return q
        remaining = [q for q in DEEP_POOL if q not in self.mem.questions_asked()]
        if not remaining:
            return None
        q = random.choice(remaining)
        self.mem.mark_asked(q)
        self.session_questions += 1
        self.last_question = q
        return q

    def _maybe_next_question(self) -> str | None:
        """Ask the next question — but pace it so it never feels like an interrogation."""
        if self.session_questions >= MAX_QUESTIONS_PER_SESSION:
            return None
        if random.random() < 0.8:
            return self._next_question() or self._deep_question()
        return None

    def _return_greeting(self) -> str:
        name = f" {self.mem.name}" if self.mem.name else ""
        part = self._vary.pick("rehello", [
            f"Hey{name}!", f"Hi{name}!", f"Hello{name}!", f"Hey{name}, good to see you.",
        ])
        q = self._maybe_next_question()
        if q:
            return f"{part} {q}"
        return f"{part} What's on your mind?"

    def _self_intro(self) -> str:
        return ("I'm Aqua — part assistant, part cyber-buddy, all yours. I run right here on your PC, "
                "and I get a little smarter about you every time we talk. No cloud, no account — "
                "just you and me.")

    def _recite(self) -> str:
        facts = self.mem.all_facts()
        name = self.mem.name
        if not name and not facts:
            return "Honestly? Not much yet — we're still getting to know each other. Tell me something and I'll never forget it."
        bits = []
        if name:
            bits.append(f"your name is {name}")
        for f in facts[:8]:
            prefix = "your" if f["kind"] in ("favorite", "person", "pet") else "you"
            bits.append(f"{prefix} {f['text']}")
        listing = "; ".join(bits)
        more = "" if len(facts) <= 8 else f" — and {len(facts) - 8} more things"
        return f"Let's see... I know {listing}{more}. That's {max(len(facts), 1)} memories so far, and I'm just getting started."

    def _mood(self, low: str) -> str | None:
        for pattern, replies in MOODS:
            if pattern.search(low):
                return self._vary.pick("mood", replies)
        return None

    def _sentiment(self, low: str) -> str:
        if re.search(r"\b(love|great|awesome|amazing|happy|fun|excited|best|good)\b", low):
            return "positive"
        if re.search(r"\b(hate|awful|terrible|bad|worst|annoying|boring|ugh)\b", low):
            return "negative"
        return "neutral"

    def _keyword(self, low: str) -> str | None:
        words = [w.strip(".,!?\"'()") for w in low.split()]
        content = [w for w in words if w and w not in STOPWORDS and len(w) > 3]
        if not content:
            return None
        content.sort(key=len, reverse=True)
        return content[0]

    def _extract_name(self, text: str) -> str | None:
        for pat in NAME_PATTERNS:
            m = pat.search(text)
            if not m:
                continue
            cand = m.group(1).strip().strip(".,!?")
            words = cand.split()
            if not words or words[0].lower() in NAME_GUARD:
                continue
            name = " ".join(words[:2])
            return name[0].upper() + name[1:]
        return None

    def _split_values(self, value: str) -> list[str]:
        """'fishing and old trucks' -> ['fishing', 'old trucks']"""
        parts = re.split(r"\s+(?:and|&)\s+", value.strip().strip(".,!?"))
        out = []
        for p in parts:
            p = " ".join(p.split()).strip(".,!?;:'\"")
            if len(p) >= 2 and p.split()[0].lower() not in VALUE_GUARD:
                out.append(p)
        return out[:3]

    def _recall_phrase(self, fact: dict) -> str:
        if fact["kind"] in ("favorite", "person", "pet"):
            return f"Last time you told me your {fact['text']}."
        return f"Last time you told me you {fact['text']}."
