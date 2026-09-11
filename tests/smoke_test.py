#!/usr/bin/env python3
"""Aqua's self-test: simulates a typed conversation and checks that her brain
and memory actually work. No audio, no internet, no microphone needed.

Run:  python tests/smoke_test.py
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brain import Brain  # noqa: E402
from memory import Memory  # noqa: E402


def main() -> int:
    tmp = Path(tempfile.mkdtemp()) / "profile.json"
    mem = Memory(path=tmp)
    mem.touch_session()  # aqua.py does this on startup
    brain = Brain(mem)

    print("=" * 60)
    print("SIMULATED FIRST CONVERSATION")
    print("=" * 60)

    print(f"\nAqua: {brain.greeting()}\n")

    turns = [
        "Robert",
        "I love fishing and old trucks",
        "I'm a teacher",
        "I live in Dallas",
        "sad today honestly",
        "who are you?",
        "what do you know about me?",
        "I have two dogs",
        "thanks aqua",
        "bye",
    ]
    for turn in turns:
        reply = brain.respond(turn)
        print(f"You:  {turn}")
        print(f"Aqua: {reply}\n")

    print("=" * 60)
    print("CHECKING HER MEMORY")
    print("=" * 60)

    assert mem.name == "Robert", f"name was {mem.name!r}"
    print(f"[ok] remembered the name: {mem.name}")

    texts = [f["text"] for f in mem.all_facts()]
    assert any("fishing" in t for t in texts), texts
    assert any("truck" in t for t in texts), texts
    assert any("teacher" in t for t in texts), texts
    assert any("dallas" in t.lower() for t in texts), texts
    assert any("dog" in t for t in texts), texts
    print(f"[ok] remembered {len(texts)} facts: {texts}")

    # second session: she should greet by name and recall something
    mem.save()  # the real app saves after every turn
    mem2 = Memory(path=tmp)
    mem2.touch_session()  # simulate a second app run
    brain2 = Brain(mem2)
    greeting = brain2.greeting()
    print(f"\nSecond-session greeting:\nAqua: {greeting}\n")
    assert "Robert" in greeting, greeting
    print("[ok] greeted him by name on the second session")

    # she never stores the same fact twice
    before = len(mem2.all_facts())
    brain2.learn_from("I love fishing")
    after = len(mem2.all_facts())
    assert before == after, "duplicate fact was stored"
    print("[ok] no duplicate facts")

    print("\nALL CHECKS PASSED - Aqua's brain is alive.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
