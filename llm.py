"""Optional "smart brain" for Aqua.

Aqua's built-in brain (brain.py) works offline with no setup, and it's what
teaches her about you. But if you want richer free-form conversation, she can
hand the actual replying over to a large language model. This is *optional*:

  * Ollama  — free, runs locally on your PC, no account. Install from
              https://ollama.com, then run:  ollama pull llama3.2
              Aqua finds it automatically at localhost:11434.
  * OpenAI  — create data/keys.json containing:
                  {"openai_api_key": "sk-..."}
              or set the OPENAI_API_KEY environment variable.

If neither is present, Aqua happily uses her built-in brain and never nags.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import requests

OLLAMA_URL = "http://localhost:11434"


def detect(data_dir: Path | None = None) -> "SmartBrain | None":
    """Return a SmartBrain if Ollama or an OpenAI key is available, else None."""
    # 1) Ollama, running locally
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=1.5)
        if r.ok:
            models = [m.get("name", "") for m in r.json().get("models", [])]
            models = [m for m in models if m]
            if models:
                preferred = next(
                    (m for m in models if any(k in m.lower() for k in
                     ("llama", "qwen", "mistral", "gemma", "phi"))),
                    models[0],
                )
                return SmartBrain(provider="ollama", model=preferred, models=models)
    except Exception:
        pass

    # 2) OpenAI key — file first, then environment
    key = None
    if data_dir is not None:
        keys_file = Path(data_dir) / "keys.json"
        if keys_file.exists():
            try:
                key = json.loads(keys_file.read_text(encoding="utf-8")).get("openai_api_key")
            except Exception:
                key = None
    key = key or os.environ.get("OPENAI_API_KEY")
    if key:
        return SmartBrain(provider="openai", key=key)
    return None


class SmartBrain:
    """Talks to Ollama (local) or OpenAI (cloud) and returns Aqua's reply."""

    def __init__(self, provider: str, model: str | None = None,
                 key: str | None = None, models: list[str] | None = None):
        self.provider = provider
        self.model = model or "gpt-4o-mini"
        self.key = key
        self.models = models or []

    def describe(self) -> str:
        if self.provider == "ollama":
            others = ""
            if len(self.models) > 1:
                others = f" (other models available: {', '.join(self.models[1:4])})"
            return f"Ollama — local model '{self.model}'{others}"
        return "OpenAI — model gpt-4o-mini"

    def reply(self, user_text: str, system_prompt: str,
              history: list[dict] | None = None) -> str:
        messages = [{"role": "system", "content": system_prompt}]
        messages += (history or [])[-12:]
        messages.append({"role": "user", "content": user_text})

        if self.provider == "ollama":
            r = requests.post(
                f"{OLLAMA_URL}/api/chat",
                json={"model": self.model, "messages": messages, "stream": False},
                timeout=180,
            )
            r.raise_for_status()
            return (r.json().get("message", {}).get("content") or "").strip()

        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {self.key}"},
            json={"model": "gpt-4o-mini", "messages": messages, "temperature": 0.8},
            timeout=90,
        )
        r.raise_for_status()
        choices = r.json().get("choices", [])
        return (choices[0]["message"]["content"].strip() if choices else "").strip()
