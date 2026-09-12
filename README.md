# 🌊 Aqua

**Your personal assistant and cyber-buddy, living on your PC.**

Aqua is a voice-enabled chat companion who starts out knowing nothing about you —
and that's the point. She asks questions, listens to your answers, and remembers
what she learns. Every conversation, she knows you a little better, greets you by
name, and brings up things you've told her before.

She's a southeast-Texas gal with a Navy past — the occasional "damn" included —
and these days she's your right hand at Hood's Pool Service, and she talks like it.

Aqua is now a **real desktop application** — a downloadable Windows executable
built with Electron (JavaScript, **no Python**), powered by an **OpenAI brain**.
Her memory is a private file on your PC; nothing goes to the cloud except your
own direct calls to OpenAI.

---

## What she does

- 🖥️ **A real desktop app** — installs like any Windows program, with her own
  window and icon.
- 🧠 **An OpenAI brain with a real personality** — a southeast-Texas gal with a
  Navy past who now keeps Hood's Pool Service running smooth. Warm, quick-witted,
  occasionally salty, and genuinely curious about you. She types her replies
  word-by-word, like a person thinking.
- 🏊 **She actually works at Hood's Pool Service** — give her your pool gallons
  and she'll do the chlorine, pH, alkalinity, hardness, stabilizer, and salt
  math. She logs service jobs and keeps the board tidy.
- ⏰ **Reminders & timers** — "remind me in 20 minutes to check the pH." She
  remembers, hollers at you, and can send desktop notifications.
- 🎙️ **"Hey Aqua" wake word** — hands-free start whenever you want it.
- 🗣️ **A genuinely human voice** — OpenAI's neural text-to-speech (`tts-1` for a
  snappy reply, `tts-1-hd` for a richer one): pick from 10 lifelike voices and
  preview them, and set her volume louder or softer. Falls back to Windows'
  voice offline.
- 🎤 **Voice in** — she hears you with **OpenAI Whisper**.
- 😊 **A face to talk to** — she appears as an animated Navy-veteran gal up top,
  who perks up, leans in to think, and talks along with you in the chat.
- 📔 **A daily journal** — at the end of each day she writes up what the two of
  you talked about (OpenAI-written when connected, or a local summary). Read it
  anytime in the 📓 Journal panel, or with `/journal`.
- 📇 **A customer log** — keep Hood's Pool Service customers straight:
  names, gallons, equipment — add and remove them from the 🧰 panel or with
  `/customer`.
- ⛅ **Weather-aware pool tips** — give her a city and she checks the forecast
  (free Open-Meteo, no key needed) and tells you what the weather means for
  your chlorine, skimming, and stabilizer.
- 🔄 **Auto-updates** — on launch she quietly checks for a newer release and
  lets you install it with `/update`.
- 📝 **Real memory** — everything you tell her is saved privately on *your* PC,
  and you can export/restore it to a file.
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
| `/wakeword` | Toggle the "Hey Aqua" wake word |
| `/name Robert` | Tell her your name directly |
| `/forget fishing` | Delete any memories matching a word |
| `/pool set 15000` | Tell her your pool size |
| `/chem ph 8.2 7.5` | Pool chemistry math (fc, ph, ta, ch, cya, salt) |
| `/job add …` / `/jobs` / `/job done 1` | Log and manage service jobs |
| `/customer add …` / `/customers` / `/customer del 1` | Log and manage customers |
| `/weather set Dallas` | Set your city for weather-aware pool tips |
| `/journal` | Open her daily journal |
| `/remind in 20 min …` / `/timer 5` | Reminders & timers |
| `/brain` | See which brain she's using |
| `/settings` | Connect her OpenAI brain |
| `/backup` | Export her memory to a file |
| `/update` | Install a downloaded update |
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
app.js             chat UI, voice, commands, settings, wake word, reminders
brain.js           her brain & memory (pure JavaScript, localStorage)
pool.js            pool chemistry math (pure, unit-tested)
tools.js           reminders & service jobs (pure, unit-tested)
journal.js         her daily-journal logic (pure, unit-tested)
weather.js         Open-Meteo forecast → pool tips (pure, unit-tested)
style.css          the look
package.json       app metadata + build config (electron-builder)
icons/             app icons (including Windows .ico)
.github/workflows/ GitHub Action that builds the Windows installer
tests/             self-tests (run: node tests/smoke.js, tests/*.test.js)
```

## Roadmap ideas

- Add a real code-signing certificate so SmartScreen stays fully quiet (the
  build already signs automatically when you add `CSC_LINK` / `CSC_KEY_PASSWORD`
  as GitHub secrets)
- Letting her run small PC tasks (open apps, send the day's journal somewhere)
- More question packs and personality tuning

---

*Built with care for Robert. She's all yours.*
