# 🌊 Aqua

**Your personal assistant and cyber-buddy, living on your PC.**

Aqua is a voice-enabled chat companion who starts out knowing nothing about you —
and that's the point. She asks questions, listens to your answers, and remembers
what she learns. Every conversation, she knows you a little better, greets you by
name, and brings up things you've told her before.

Aqua is now a **real desktop application** — a downloadable Windows executable
built with Electron (JavaScript, **no Python**), powered by an **OpenAI brain**.
Her memory is a private file on your PC; nothing goes to the cloud except your
own direct calls to OpenAI.

---

## What she does

- 🖥️ **A real desktop app** — installs like any Windows program, with her own
  window and icon.
- 🧠 **An OpenAI brain with a real personality** — warm, playful, quick-witted,
  and genuinely curious about you. She teases gently, remembers everything, and
  talks like a friend, not a form letter.
- 🗣️ **A genuinely human voice** — she speaks with OpenAI's neural text-to-speech
  (`tts-1-hd`): pick from 10 lifelike voices and preview them in the Voices panel.
  Falls back to Windows' voice when offline.
- 💬 **Open conversation** — chat by typing, or tap the mic and just talk.
- 🎤 **Voice in** — she hears you with **OpenAI Whisper**.
- 📝 **Real memory** — everything you tell her is saved privately on *your* PC.
  She still learns your name, facts, and tastes the same way she always has.
- 🔒 **Private by design** — no account, no telemetry. Your API key is stored
  only on your machine and used only to talk to OpenAI directly.

---

## Getting the app

### Option A — download a ready-made .exe (easiest)

Go to the **Releases** page of this repository and download **`Aqua-Setup-1.0.0.exe`**
(the installer) or **`Aqua-Portable-1.0.0.exe`** (no install — just run it).

- **Installer:** double-click, choose where to install, and it adds Aqua to your
  Start menu and desktop.
- **Portable:** a single `.exe` you can put anywhere and double-click.

> Windows may show *"Windows protected your PC"* because the app isn't code-signed.
> Click **More info → Run anyway**.

### Option B — build it yourself (needs Node.js)

1. Install Node.js from [nodejs.org](https://nodejs.org) (the LTS version).
2. In the Aqua folder, open a terminal and run:
   ```
   npm install
   npm run dist
   ```
3. The installer and portable `.exe` land in the `dist/` folder.

To just run her during development: `npm start`.

---

## Connecting her OpenAI brain

1. Open Aqua and click **⚙️ Settings** (or type `/settings`).
2. Paste your OpenAI API key (get one at
   [platform.openai.com/api-keys](https://platform.openai.com/api-keys)).
3. Optionally change the model (e.g. `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`).
4. Her top bar now shows **"OpenAI brain · gpt-4o-mini"**.

Your key is stored locally in the app's private data folder
(`%APPDATA%\Aqua\keys.json`) and is sent only to OpenAI. You can also set an
`OPENAI_API_KEY` environment variable instead. The same key powers her **voice**
(OpenAI TTS) and her **ears** (Whisper) — without a key she can still type-chat
using her built-in local brain, speaking with Windows' built-in voice.

---

## How to talk with her

| You do | What happens |
|---|---|
| Just type | She reads and answers — silently or out loud |
| Tap **🎤** | The mic opens — speak, pause, and she replies (Whisper) |
| Tap **🎧** | Always-listening mode: no keyboard needed at all |
| Say "goodbye" | She says goodbye and saves everything |

## Commands

| Command | What it does |
|---|---|
| `/help` | Show all commands |
| `/profile` | See everything she's learned about you |
| `/voice on` / `/voice off` | Turn her voice on or off |
| `/voices` then `/voice nova` | Browse and switch voices (neural or Windows) |
| `/rate +10%` or `/rate -10%` | Speak faster or slower |
| `/handsfree` | Toggle always-listening mode |
| `/name Robert` | Tell her your name directly |
| `/forget fishing` | Delete any memories matching a word |
| `/brain` | See which brain she's using |
| `/settings` | Connect her OpenAI brain |
| `/reset` | Wipe her memory completely (she'll ask first) |
| `/quit` | Say goodbye and exit |

## How she learns

Her long-term memory lives in the app's private storage on your PC. She stores:

- your **name** and how long you two have known each other,
- **facts** she picks out of your sentences ("I love fishing", "I'm a teacher",
  "I have two dogs", "my wife's name is…"),
- the **questions** she's already asked (so she never repeats herself), and
- your recent conversation, for context.

On each startup she greets you by name, sometimes opens with something she
remembers ("Last time you told me you love fishing — how's that going?"), and
continues learning where she left off. Even with the OpenAI brain, her local
brain still drives greetings and memory extraction — she always grows on her own.

## Troubleshooting

| Problem | Fix |
|---|---|
| SmartScreen blocks the app | Click **More info → Run anyway** (it's unsigned) |
| She can't hear you | Allow the microphone when Windows asks; check Settings → Privacy → Microphone |
| Mic says "add your key" | Whisper needs your OpenAI key — add it in ⚙️ Settings |
| She doesn't speak | Tap 🔊 to check her voice is on, and check your volume. The neural voice needs your OpenAI key; without it she uses the Windows voice. |
| OpenAI errors | Check your key, your plan/credit, and your internet connection |
| Want a truly fresh start | `/reset` inside Aqua |

## Project layout

```
main.js            Electron main process — window, key storage, OpenAI calls
preload.js         secure bridge between the UI and the main process
index.html         the app window's UI
app.js             chat UI, voice, commands, settings
brain.js           her brain & memory (pure JavaScript, localStorage)
style.css          the look
package.json       app metadata + build config (electron-builder)
icons/             app icons (including Windows .ico)
.github/workflows/ GitHub Action that builds the Windows installer
tests/smoke.js     self-test for her brain (run: node tests/smoke.js)
```

## Roadmap ideas

- Code-sign the installer so SmartScreen stays quiet
- Wake word ("Hey Aqua") for hands-free start
- Reminders and timers ("remind me at 3pm")
- Letting her run small PC tasks (open apps, check the weather)
- More question packs and personality tuning

---

*Built with care for Robert. She's all yours.*
