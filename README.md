# 🌊 Aqua

**Your personal assistant and cyber-buddy, living on your Windows PC.**

Aqua is a voice-enabled chat companion who starts out knowing nothing about you —
and that's the point. She asks questions, listens to your answers, and remembers
what she learns. Every conversation, she knows you a little better, greets you by
name, and brings up things you've told her before. She talks out loud in a natural
human voice, and she listens when you speak.

---

## What she does

- 💬 **Open conversation** — chat by typing, or press Enter and just talk. She
  speaks her replies out loud.
- 🧠 **Progressive learning** — she asks friendly questions across a dozen
  topics (your world, your work, your tastes, your dreams) and paces herself so
  it never feels like an interrogation.
- 📝 **Real memory** — everything you tell her is saved to a private file on
  *your* PC. Close her, come back next week — she'll pick up right where you
  left off, and open with something she remembers about you.
- 🗣️ **Human-sounding voice** — powered by Microsoft's neural voices (the same
  ones you hear in modern assistants). If your internet drops, she falls back
  to the built-in Windows voice so she's never silent.
- ❤️ **A little heart** — she notices when you're tired or down and responds
  like a friend would, not a form letter.
- 🔒 **Private by design** — no account, no cloud, no telemetry. Her memory is
  a plain JSON file you can read, edit, or wipe anytime.

## Getting started (Windows)

**Step 1 — Install Python** (one time)

Get Python 3.10+ from [python.org/downloads](https://www.python.org/downloads/).
On the first installer screen, **check the box that says "Add python.exe to PATH"**
before clicking Install.

**Step 2 — Set Aqua up** (one time)

Double-click **`setup.bat`**. A black window opens and installs everything she
needs into a private `.venv` folder. Takes a few minutes.

**Step 3 — Talk to her**

Double-click **`Run Aqua.bat`** any time you want to chat.

> Prefer the terminal? `python aqua.py` works too, and `python tests/smoke_test.py`
> runs a quick self-test of her brain.

## How to talk with her

| You do | What happens |
|---|---|
| Just type | She reads and answers — silently or out loud |
| Press **Enter** on an empty line | The mic opens — speak naturally, pause, and she replies |
| Type `/handsfree` | Always-listening mode: no keyboard needed at all |
| Say "goodbye" | She says goodbye and saves everything |

## Commands

| Command | What it does |
|---|---|
| `/help` | Show all commands |
| `/profile` | See everything she's learned about you |
| `/voice on` / `/voice off` | Turn her voice on or off |
| `/voices` then `/voice en-US-GuyNeural` | Browse and switch voices (US/UK/AU/IE, male & female) |
| `/rate +10%` or `/rate -10%` | Speak faster or slower |
| `/handsfree` | Toggle always-listening mode |
| `/name Robert` | Tell her your name directly |
| `/forget fishing` | Delete any memories matching a word |
| `/brain` | See which brain she's using, and how to upgrade it |
| `/reset` | Wipe her memory completely (she'll ask first) |
| `/quit` | Say goodbye and exit |

## How she learns

Her memory lives in `data/profile.json` — open it sometime, it's just text.
She stores:

- your **name** and how long you two have known each other,
- **facts** she picks out of your sentences ("I love fishing", "I'm a teacher",
  "I have two dogs", "my wife's name is…"),
- the **questions** she's already asked (so she never repeats herself), and
- your recent conversation, for context.

On each startup she greets you by name, sometimes opens with something she
remembers ("Last time you told me you love fishing — how's that going?"), and
continues learning where she left off. Ask her *"what do you know about me?"*
anytime to hear it all back.

## Optional: give her a smarter brain

Her built-in brain works offline with zero setup and is what does the learning.
If you ever want deeper free-form conversation, she can think with a large
language model instead — she'll still learn and remember the same way:

- **Ollama (free, private, runs on your PC)** — install from
  [ollama.com](https://ollama.com), run `ollama pull llama3.2`, and restart
  Aqua. She finds it automatically.
- **OpenAI (internet, your API key)** — create `data/keys.json` containing
  `{"openai_api_key": "sk-..."}` and restart Aqua.

Type `/brain` to see which one she's currently using.

## Troubleshooting

| Problem | Fix |
|---|---|
| `setup.bat` says Python wasn't found | Reinstall Python and check **"Add python.exe to PATH"** on the first screen |
| She can't hear you | Windows Settings → Privacy & security → Microphone → make sure "Let desktop apps access your microphone" is **On** |
| She sounds robotic | Her neural voice needs internet; check your connection (she falls back to the built-in Windows voice offline) |
| Speech-to-text seems dead | Same thing — her ears use a free online speech service. Typing always works. |
| Want a truly fresh start | `/reset` inside Aqua, or just delete the `data` folder |

## Project layout

```
aqua.py          entry point — run this
brain.py         her personality, questions, and listening skills
memory.py        long-term memory (data/profile.json)
voice.py         speaking (neural + Windows fallback) and listening
llm.py           optional Ollama/OpenAI smart brain
setup.bat        one-time Windows installer
Run Aqua.bat     double-click to chat
tests/           self-test for her brain
data/            her memory — created at runtime, never committed
```

## Roadmap ideas

- Wake word ("Hey Aqua") for hands-free start
- Reminders and timers ("remind me at 3pm")
- Letting her run small PC tasks (open apps, check the weather)
- A memory browser window
- More question packs and personality tuning

---

*Built with care for Robert. She's all yours.*
