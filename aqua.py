#!/usr/bin/env python3
"""Aqua — your personal assistant and cyber-buddy, living on your PC.

Talk to her by voice (press Enter and just speak) or type normally. She asks
questions to learn who you are, remembers everything between conversations in
a private local file, and speaks with a natural neural voice.

Run with:  python aqua.py     (or double-click "Run Aqua.bat" on Windows)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# ---- pretty terminal colors (with a fallback if colorama is missing) -------
try:
    from colorama import init as _colorama_init, Fore, Style
    _colorama_init(wrap=True)
except Exception:  # pragma: no cover
    class _Fore:
        CYAN = YELLOW = GREEN = MAGENTA = RED = ""
    class _Style:
        RESET_ALL = DIM = BRIGHT = ""
    Fore, Style = _Fore, _Style

from brain import Brain
from llm import detect as detect_smart_brain
from memory import DATA_DIR, Memory
from voice import EDGE_VOICES, Listener, Speaker

BANNER = r"""
     _    ____   ____ ___ ___
    / \  |  _ \ / ___|_ _|_ _|
   / _ \ | |_) | |  _ | | | |
  / ___ \|  _ <| |_| || | | |
 /_/   \_\_| \_\\____|___|___|
        your cyber-buddy
"""

HELP_TEXT = """Commands — type these anytime:
  /help            show this list
  /profile         see everything Aqua has learned about you
  /weather         check the weather in your area
  /voice on|off    turn her voice on or off
  /voices          list the voices she can wear
  /voice <id>      switch voice (e.g.  /voice en-US-JennyNeural )
  /rate +10%       speak faster (+) or slower (-), e.g.  /rate -10%
  /handsfree       toggle always-listening mode (no keyboard needed)
  /name <name>     tell her your name
  /forget <word>   make her forget memories containing that word
  /brain           which brain she's thinking with, and how to upgrade it
  /reset           wipe everything she knows (asks first)
  /quit            say goodbye and exit

Tips:
  * Press Enter on an empty line to speak to her with your voice.
  * Just type if you'd rather stay quiet — she's not picky.
  * She remembers between chats: everything lives in data/profile.json.
"""


def dim(text: str) -> str:
    return f"{Style.DIM}{Fore.CYAN}{text}{Style.RESET_ALL}"


def show_and_speak(text: str, speaker: Speaker) -> None:
    print(f"\n{Fore.CYAN}{Style.BRIGHT}Aqua{Style.RESET_ALL}: {text}")
    speaker.say(text)


def main() -> int:
    parser = argparse.ArgumentParser(description="Aqua — your personal cyber-buddy.")
    parser.add_argument("--mute", "--no-voice", action="store_true",
                        help="start with her voice turned off (text only)")
    parser.add_argument("--handsfree", action="store_true",
                        help="start in always-listening mode")
    args = parser.parse_args()

    try:  # make emoji/unicode safe on Windows consoles
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    print(f"{Fore.CYAN}{BANNER}{Style.RESET_ALL}")

    # ---- set up her mind, voice, and ears -------------------------------
    mem = Memory()
    mem.touch_session()
    mem.save()

    speaker = Speaker(
        voice_id=mem.data.get("voice_id", "en-US-AriaNeural"),
        rate=mem.data.get("rate", "+8%"),
        enabled=bool(mem.data.get("voice_on", True)) and not args.mute,
    )

    listener: Listener | None = None
    try:
        listener = Listener()
    except Exception as e:
        print(dim(f"(no microphone available: {e} — you can still type to her)"))

    brain = Brain(mem)

    smart = None
    try:
        smart = detect_smart_brain(DATA_DIR)
    except Exception:
        smart = None
    if smart:
        print(dim(f"(smart brain active: {smart.describe()})"))
    else:
        print(dim("(thinking with her built-in local brain — type /brain for upgrades)"))

    if listener is not None:
        print(dim("(press Enter to talk with your voice, or just type — /help for commands)"))
    else:
        print(dim("(type to talk to her — /help for commands)"))

    # ---- first words ----------------------------------------------------
    show_and_speak(brain.greeting(), speaker)

    handsfree = bool(args.handsfree) and listener is not None
    if args.handsfree and listener is None:
        print(dim("(can't start hands-free without a microphone)"))

    stop = False

    # ---------------------------------------------------------------- command handler
    def handle_command(line: str) -> None:
        nonlocal handsfree, stop, smart, brain, mem, speaker, listener

        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        rest = (parts[1] if len(parts) > 1 else "").strip()

        if cmd == "/help":
            print(dim(HELP_TEXT))
            speaker.say("Sure — I put the list on screen for you.")

        elif cmd == "/profile":
            facts = mem.all_facts()
            print(f"\n{Fore.YELLOW}── What Aqua remembers ─────────────────────")
            print(f"Name:     {mem.name or '(not yet known)'}")
            print(f"Sessions: {mem.data.get('sessions', 1)}   "
                  f"(you two met {mem.days_known()} day(s) ago)")
            if facts:
                print("Memories:")
                for f in facts:
                    print(f"  • you {f['text']}" if f['kind'] not in ('favorite', 'person', 'pet')
                          else f"  • your {f['text']}")
            else:
                print("Memories: none yet — talk to her more!")
            print(f"{'─' * 46}{Style.RESET_ALL}")
            speaker.say(f"I remember {len(facts)} things about you so far — the list is on screen.")

        elif cmd == "/voices":
            print(f"\n{Fore.YELLOW}Voices she can wear:{Style.RESET_ALL}")
            for vid, label in EDGE_VOICES.items():
                marker = "  <- current" if vid == speaker.voice_id else ""
                print(f"  {vid:24} {label}{marker}")
            print(dim("switch with:  /voice en-US-GuyNeural"))

        elif cmd == "/voice":
            if rest.lower() in ("on", "off"):
                on = rest.lower() == "on"
                speaker.enabled = on
                mem.data["voice_on"] = on
                mem.save()
                print(dim(f"voice {'on' if on else 'off'}"))
                if on:
                    speaker.say("Voice is back on. Missed me?")
            elif rest:
                try:
                    if rest not in EDGE_VOICES:
                        raise ValueError(f"unknown voice '{rest}' — try /voices")
                    speaker.voice_id = rest
                    mem.data["voice_id"] = rest
                    mem.save()
                    speaker.say(f"This is my new voice. What do you think?")
                except ValueError as e:
                    print(dim(f"{e}"))
            else:
                print(dim(f"voice is {'on' if speaker.enabled else 'off'}; "
                          f"usage: /voice on|off  or  /voice <id>"))

        elif cmd == "/rate":
            if rest and rest[-1] == "%" and rest[:-1].lstrip("+-").isdigit():
                speaker.rate = rest
                mem.data["rate"] = rest
                mem.save()
                speaker.say("Let me know if this pace works for you.")
            else:
                print(dim(f"current rate {speaker.rate}; usage: /rate +10%  or  /rate -10%"))

        elif cmd == "/handsfree":
            handsfree = not handsfree
            state = "ON — I'm all ears, just talk" if handsfree else "OFF — back to typing"
            print(dim(f"hands-free {state}"))
            if handsfree and listener is None:
                handsfree = False
                print(dim("(no microphone available)"))
            else:
                speaker.say("I'm listening." if handsfree else "Okay, back to keyboard and mouse.")

        elif cmd == "/mute":
            speaker.enabled = not speaker.enabled
            mem.data["voice_on"] = speaker.enabled
            mem.save()
            print(dim(f"voice {'on' if speaker.enabled else 'off'}"))

        elif cmd == "/name":
            if rest:
                mem.set_name(rest)
                mem.save()
                show_and_speak(f"Got it — {rest}. Nice to put a name to the voice.", speaker)
            else:
                print(dim("usage: /name Robert"))

        elif cmd == "/forget":
            if not rest:
                print(dim("usage: /forget fishing"))
            else:
                removed = mem.forget(rest)
                mem.save()
                if removed:
                    items = ", ".join(f"'you {f['text']}'" for f in removed[:5])
                    show_and_speak(f"Done — I forgot {len(removed)} memor{'y' if len(removed) == 1 else 'ies'}: {items}.", speaker)
                else:
                    show_and_speak(f"I don't remember anything about '{rest}' anyway.", speaker)

        elif cmd == "/brain":
            if smart:
                print(dim(f"active: {smart.describe()}"))
                speaker.say("I'm thinking with a smarter brain right now.")
            else:
                print(dim("active: built-in local brain (offline, no setup)"))
                print(dim("""
To give her a smarter brain (optional):
  Ollama (free, runs on your PC, private):
    1. install from https://ollama.com
    2. run:  ollama pull llama3.2
    3. restart Aqua — she'll find it automatically
  OpenAI (uses the internet, needs your own API key):
    create the file  data/keys.json  containing:
        {"openai_api_key": "sk-..."}
"""))
                speaker.say("Right now I'm running on my built-in brain. The screen shows how to upgrade me if you ever want.")

        elif cmd == "/weather":
            try:
                from weather import get_weather_report
                # rest can be a location override, e.g. /weather Dallas
                if rest:
                    # create a dummy mem-like object with location? just fetch directly
                    from weather import _fetch_wttr, _format_weather
                    data = _fetch_wttr(rest)
                    if data:
                        report = _format_weather(data)
                        show_and_speak(f"For {rest}, {report[0].lower() + report[1:]}" if report else f"Here's the weather for {rest}.", speaker)
                    else:
                        # fallback to general report with override text
                        mem_temp = mem
                        # temporarily inject a fake fact for location
                        report = get_weather_report(mem)
                        show_and_speak(report, speaker)
                else:
                    report = get_weather_report(mem)
                    show_and_speak(report, speaker)
            except Exception as e:
                show_and_speak(f"I tried to check the weather but couldn't reach the service: {e}", speaker)

        elif cmd == "/reset":
            confirm = input(dim("This wipes EVERYTHING Aqua knows about you. "
                                "Type RESET to confirm: "))
            if confirm.strip().upper() == "RESET":
                mem.reset()
                brain = Brain(mem)
                show_and_speak("Okay... clean slate. Hi — I'm Aqua. Who are you?", speaker)
            else:
                show_and_speak("Good — I was a little nervous there.", speaker)

        elif cmd in ("/quit", "/exit", "/bye"):
            show_and_speak(brain.farewell(), speaker)
            stop = True

        else:
            show_and_speak("Hmm, I don't know that one. /help shows the list.", speaker)

    # ---------------------------------------------------------------- main loop
    while not stop:
        try:
            if handsfree and listener is not None:
                print(dim("(listening…) say 'stop listening' to pause, or 'goodbye' to leave"))
                text, err = listener.listen_and_transcribe()
                if text is None:
                    if err == "network":
                        print(dim("(speech service unreachable — check internet)"))
                        handsfree = False
                        print(dim("(switched back to typing mode)"))
                    continue
                print(f"\n{Fore.GREEN}You{Style.RESET_ALL}: {text}")
                low = text.lower().strip().strip(".,!?")
                if low in ("stop listening", "stop hands free", "hands free off", "stop listening mode"):
                    handsfree = False
                    show_and_speak("Okay — back to keyboard and mouse.", speaker)
                    continue
            else:
                raw = input(f"\n{Fore.GREEN}You{Style.RESET_ALL}: ").strip()
                if not raw:
                    if listener is None:
                        print(dim("(tip: type what you want to say — /help shows commands)"))
                        continue
                    print(dim("(listening…)"))
                    text, err = listener.listen_and_transcribe()
                    if text is None:
                        show_and_speak(brain.didnt_catch(err or "quiet"), speaker)
                        continue
                    print(f"{Fore.GREEN}You{Style.RESET_ALL}: {text}")
                else:
                    text = raw
        except (KeyboardInterrupt, EOFError):
            print()
            show_and_speak(brain.farewell(), speaker)
            break

        # commands
        if text.startswith("/"):
            handle_command(text)
            continue

        # plain conversation
        if brain.is_exit(text):
            show_and_speak(brain.farewell(), speaker)
            break

        reply = None
        if smart is not None:
            brain.learn_from(text)  # she still learns, even with a smart brain
            try:
                reply = smart.reply(text, brain.system_prompt(), mem.history_for_llm())
            except Exception:
                print(dim("(smart brain hiccupped — using her built-in brain this once)"))
                reply = None
        if not reply:
            reply = brain.respond(text)

        mem.add_exchange(text, reply)
        mem.save()
        show_and_speak(reply, speaker)

    mem.save()
    print(dim(f"(she saved this conversation to {DATA_DIR / 'profile.json'} — see you next time)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
