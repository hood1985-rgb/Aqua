"""Aqua's voice: speaking and listening.

Speaking (her side):
  1. Preferred: edge-tts — Microsoft's neural voices over the internet. These
     sound genuinely human. Needs an internet connection.
  2. Fallback: pyttsx3 — the voices built into Windows. Works offline, sounds
     a little more robotic, but she'll never be silent just because the
     internet dropped.

Listening (your side):
  The Listener records from your microphone with sounddevice, waits for you
  to finish talking (silence detection), then sends the audio to Google's
  free web speech service to turn it into text. No API key required.
"""

from __future__ import annotations

import array
import asyncio
import os
import re
import tempfile
import time

# A curated set of pleasant neural voices (there are many more — see /voices).
EDGE_VOICES = {
    "en-US-AriaNeural": "Aria (US, female) — the default Aqua",
    "en-US-JennyNeural": "Jenny (US, female)",
    "en-US-MichelleNeural": "Michelle (US, female)",
    "en-US-AnaNeural": "Ana (US, female, younger)",
    "en-US-GuyNeural": "Guy (US, male)",
    "en-US-ChristopherNeural": "Christopher (US, male)",
    "en-US-RogerNeural": "Roger (US, male)",
    "en-GB-SoniaNeural": "Sonia (UK, female)",
    "en-GB-LibbyNeural": "Libby (UK, female)",
    "en-GB-RyanNeural": "Ryan (UK, male)",
    "en-AU-NatashaNeural": "Natasha (AU, female)",
    "en-AU-WilliamNeural": "William (AU, male)",
    "en-IE-EmilyNeural": "Emily (Ireland, female)",
}

_STRIP_RE = re.compile(
    "[\U0001F000-\U0001FAFF\u2190-\u27BF\u2B00-\u2BFF\uFE0F]"
)


def clean_for_speech(text: str) -> str:
    """Remove emojis and odd symbols so neural voices don't choke."""
    text = _STRIP_RE.sub("", text or "")
    text = text.replace("*", "").replace("#", "").replace("`", "")
    return " ".join(text.split()).strip()


class Speaker:
    """Turns Aqua's words into sound."""

    def __init__(self, voice_id: str = "en-US-AriaNeural", rate: str = "+8%",
                 enabled: bool = True):
        self.voice_id = voice_id if voice_id in EDGE_VOICES else "en-US-AriaNeural"
        self.rate = rate if re.match(r"^[+-]\d+%$", rate or "") else "+8%"
        self.enabled = enabled
        self.last_engine: str | None = None
        self.last_error: str | None = None

    def say(self, text: str) -> None:
        if not self.enabled:
            return
        spoken = clean_for_speech(text)
        if not spoken:
            return
        try:
            self._say_edge(spoken)
            self.last_engine = "edge-tts (neural voice)"
        except Exception as e:  # offline, blocked, or lib missing
            self.last_error = str(e)
            try:
                self._say_windows(spoken)
                self.last_engine = "Windows built-in voice"
            except Exception as e2:
                self.last_error = f"{e} / {e2}"

    # ---------- engines ----------

    def _say_edge(self, text: str) -> None:
        import edge_tts
        import soundfile as sf
        import sounddevice as sd

        fd, path = tempfile.mkstemp(suffix=".mp3")
        os.close(fd)
        try:
            async def _gen() -> None:
                communicate = edge_tts.Communicate(text, self.voice_id, rate=self.rate)
                await communicate.save(path)

            asyncio.run(_gen())
            data, samplerate = sf.read(path, dtype="float32")
            sd.play(data, samplerate)
            sd.wait()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def _say_windows(self, text: str) -> None:
        import pyttsx3

        engine = pyttsx3.init()
        try:
            # prefer a female-sounding built-in voice if one exists
            for v in engine.getProperty("voices"):
                name = (v.name or "").lower()
                if any(k in name for k in ("zira", "aria", "hazel", "susan")):
                    engine.setProperty("voice", v.id)
                    break
            engine.setProperty("rate", 178)
            engine.say(text)
            engine.runAndWait()
        finally:
            try:
                engine.stop()
            except Exception:
                pass


class Listener:
    """Records one utterance from the microphone and transcribes it."""

    RATE = 16000      # sample rate required by the speech service
    BLOCK = 1024      # frames per read (~64 ms)

    def __init__(self) -> None:
        import sounddevice  # noqa: F401  (fails fast if unavailable)
        import speech_recognition  # noqa: F401
        self._recognizer = None

    # ---------- public ----------

    def listen_and_transcribe(self, max_wait: float = 18.0,
                              max_speech: float = 15.0,
                              silence: float = 1.15) -> tuple[str | None, str | None]:
        """Returns (text, None) on success or (None, error_kind) on failure.

        error_kind: 'quiet' (nothing said), 'unclear' (couldn't transcribe),
        'network' (speech service unreachable), 'nomic' (no microphone).
        """
        try:
            raw = self._record(max_wait, max_speech, silence)
        except Exception as e:
            kind = "nomic" if "Error opening" in str(e) or "Device" in str(e) else "quiet"
            return None, kind
        if raw is None or len(raw) < self.RATE * 2 * 0.3:  # under ~0.3s of sound
            return None, "quiet"
        return self.transcribe(raw)

    def transcribe(self, raw: bytes) -> tuple[str | None, str | None]:
        import speech_recognition as sr

        if self._recognizer is None:
            self._recognizer = sr.Recognizer()
        audio = sr.AudioData(raw, self.RATE, 2)
        try:
            text = (self._recognizer.recognize_google(audio, language="en-US") or "").strip()
            if not text:
                return None, "unclear"
            return text, None
        except sr.UnknownValueError:
            return None, "unclear"
        except sr.RequestError:
            return None, "network"
        except Exception:
            return None, "unclear"

    # ---------- recording with silence detection ----------

    def _record(self, max_wait: float, max_speech: float, silence: float) -> bytes | None:
        import sounddevice as sd

        chunks: list[bytes] = []
        with sd.InputStream(samplerate=self.RATE, channels=1,
                            dtype="int16", blocksize=self.BLOCK) as mic:
            # ~0.6s of ambient noise to set the trigger threshold
            ambient = []
            for _ in range(10):
                data, _ = mic.read(self.BLOCK)
                ambient.append(self._rms(self._bytes(data)))
            avg = sum(ambient) / max(len(ambient), 1)
            peak = max(ambient) if ambient else 0
            threshold = max(int(avg * 2.5), int(peak * 1.6), 250)

            started_at = None
            last_voice_at = None
            t0 = time.time()
            while True:
                data, _ = mic.read(self.BLOCK)
                level = self._rms(self._bytes(data))
                now = time.time()

                if started_at is None:
                    if level > threshold:
                        started_at, last_voice_at = now, now
                        chunks.append(self._bytes(data))
                    elif now - t0 > max_wait:
                        return None
                else:
                    chunks.append(self._bytes(data))
                    if level > threshold:
                        last_voice_at = now
                    if (now - last_voice_at > silence
                            or now - started_at > max_speech):
                        break
        return b"".join(chunks)

    @staticmethod
    def _bytes(data) -> bytes:
        if hasattr(data, "tobytes"):
            return data.tobytes()
        return bytes(data)

    @classmethod
    def _rms(cls, raw: bytes) -> int:
        samples = array.array("h", raw)
        if not samples:
            return 0
        return int((sum(s * s for s in samples) / len(samples)) ** 0.5)
