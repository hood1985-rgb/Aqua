"""Aqua's long-term memory.

Everything you tell Aqua is stored in a small JSON file (data/profile.json)
right on your own PC. Nothing is uploaded anywhere. The file holds your name,
facts she's picked up, the questions she's already asked, and recent
conversations so she has context next time you talk.
"""

from __future__ import annotations

import copy
import json
import random
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
PROFILE_PATH = DATA_DIR / "profile.json"

DEFAULT_PROFILE = {
    "created": None,          # ISO date you two first met
    "name": None,             # your name
    "sessions": 0,            # how many times you've talked
    "last_seen": None,        # ISO date of the last chat
    "facts": [],              # [{"text", "kind", "value", "date", "hits"}]
    "asked_questions": [],    # question texts already asked (learning mode)
    "qa": [],                 # [{"q", "a", "topic", "date"}]
    "recent_exchanges": [],   # last ~24 turns, for context / smart brains
    "voice_on": True,
    "voice_id": "en-US-AriaNeural",
    "rate": "+8%",
}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Memory:
    """Load / save / grow Aqua's memory of you."""

    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else PROFILE_PATH
        self.data = copy.deepcopy(DEFAULT_PROFILE)
        self._load()

    # ---------- persistence ----------

    def _load(self) -> None:
        if self.path.exists():
            try:
                stored = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(stored, dict):
                    # merge so new default keys appear in old profiles
                    self.data.update(stored)
            except Exception:
                # corrupted profile shouldn't kill the app — start fresh
                self.data = copy.deepcopy(DEFAULT_PROFILE)
        if not self.data.get("created"):
            self.data["created"] = _now()

    def save(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                json.dumps(self.data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:
            pass  # never crash over a save; we'll try again next turn

    def reset(self) -> None:
        self.data = copy.deepcopy(DEFAULT_PROFILE)
        self.data["created"] = _now()
        self.save()

    # ---------- sessions ----------

    def touch_session(self) -> None:
        self.data["sessions"] = int(self.data.get("sessions", 0)) + 1
        self.data["last_seen"] = _now()

    def days_since_seen(self) -> int:
        last = self.data.get("last_seen")
        if not last:
            return 9999
        try:
            then = datetime.fromisoformat(last)
            return max(0, (datetime.now() - then).days)
        except Exception:
            return 0

    def days_known(self) -> int:
        first = self.data.get("created")
        if not first:
            return 0
        try:
            then = datetime.fromisoformat(first)
            return max(1, (datetime.now() - then).days)
        except Exception:
            return 1

    # ---------- name ----------

    @property
    def name(self) -> str | None:
        return self.data.get("name")

    def set_name(self, name: str) -> None:
        self.data["name"] = name.strip().strip(".,!?")

    # ---------- facts (the things she learns about you) ----------

    def add_fact(self, kind: str, value: str, text: str | None = None) -> bool:
        value = " ".join(value.split()).strip(".,!?;:'\"")
        if len(value) < 2:
            return False
        text = text or value
        for f in self.data["facts"]:
            if f["kind"] == kind and f["value"].lower() == value.lower():
                f["hits"] = int(f.get("hits", 1)) + 1
                return False  # already knew that
        self.data["facts"].append(
            {"text": text, "kind": kind, "value": value, "date": _now(), "hits": 1}
        )
        # keep the list tidy if someone talks a *lot*
        if len(self.data["facts"]) > 500:
            self.data["facts"] = self.data["facts"][-500:]
        return True

    def facts_of(self, *kinds: str) -> list[dict]:
        return [f for f in self.data.get("facts", []) if f["kind"] in kinds]

    def all_facts(self) -> list[dict]:
        return list(self.data.get("facts", []))

    def forget(self, term: str) -> list[dict]:
        term = term.lower().strip()
        kept, removed = [], []
        for f in self.data.get("facts", []):
            if term in f["text"].lower() or term in f["value"].lower():
                removed.append(f)
            else:
                kept.append(f)
        self.data["facts"] = kept
        return removed

    def random_fact(self, *kinds: str) -> dict | None:
        pool = self.facts_of(*kinds) if kinds else self.all_facts()
        return random.choice(pool) if pool else None

    # ---------- learning questions ----------

    def mark_asked(self, question: str) -> None:
        if question not in self.data["asked_questions"]:
            self.data["asked_questions"].append(question)

    def questions_asked(self) -> set[str]:
        return set(self.data.get("asked_questions", []))

    def add_qa(self, q: str, a: str, topic: str = "") -> None:
        self.data.setdefault("qa", []).append(
            {"q": q, "a": a, "topic": topic, "date": _now()}
        )
        if len(self.data["qa"]) > 400:
            self.data["qa"] = self.data["qa"][-400:]

    # ---------- recent conversation (context) ----------

    def add_exchange(self, user: str, aqua: str) -> None:
        self.data.setdefault("recent_exchanges", []).append(
            {"user": user, "aqua": aqua}
        )
        self.data["recent_exchanges"] = self.data["recent_exchanges"][-24:]

    def history_for_llm(self) -> list[dict]:
        out = []
        for ex in self.data.get("recent_exchanges", []):
            out.append({"role": "user", "content": ex["user"]})
            out.append({"role": "assistant", "content": ex["aqua"]})
        return out[-12:]

    # ---------- summaries ----------

    def summary(self) -> str:
        """Compact text version of what Aqua knows — used for /profile and smart brains."""
        lines = []
        if self.name:
            lines.append(f"- Their name is {self.name}")
        by_kind: dict[str, list[str]] = {}
        for f in self.all_facts():
            by_kind.setdefault(f["kind"], []).append(f["text"])
        for kind, texts in by_kind.items():
            lines.append(f"- {kind}: " + "; ".join(texts[:8]))
        if self.data.get("sessions", 0) > 1:
            lines.append(
                f"- You've talked {self.data['sessions']} times over "
                f"{self.days_known()} days — you're not strangers."
            )
        recent = [qa["a"] for qa in self.data.get("qa", [])[-5:]]
        if recent:
            lines.append("- Recent things they shared: " + " | ".join(recent))
        return "\n".join(lines)
