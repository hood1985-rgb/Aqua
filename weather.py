"""Aqua's weather — tells Joe what it's like outside.

Uses wttr.in (no API key needed) which auto-detects location by IP if we
don't have a location from memory. Falls back gracefully when offline.

Design:
- Tries requests first (if available), then urllib as fallback
- Never raises, always returns a friendly string
- Respects remembered location from memory (e.g. "Dallas")
- Short timeout so startup stays snappy
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Optional

try:
    import requests  # type: ignore
except Exception:  # pragma: no cover
    requests = None  # type: ignore


def _get_location_from_memory(mem) -> Optional[str]:
    """Try to pull a location from what Aqua remembers about the user."""
    if mem is None:
        return None
    try:
        facts = mem.facts_of("live") if hasattr(mem, "facts_of") else []
        if facts:
            # most recent fact is last in list
            loc = facts[-1].get("value") or facts[-1].get("text", "")
            loc = loc.strip()
            for prefix in ("in ", "at ", "from ", "live in ", "are from "):
                if loc.lower().startswith(prefix):
                    loc = loc[len(prefix):].strip()
            if loc:
                return loc
    except Exception:
        pass
    return None


def _fetch_wttr_requests(location: Optional[str]) -> Optional[dict]:
    """Fetch via requests library."""
    if requests is None:
        return None
    try:
        base = "https://wttr.in"
        if location:
            loc_enc = urllib.parse.quote(location)
            url = f"{base}/{loc_enc}?format=j1"
        else:
            url = f"{base}/?format=j1"

        r = requests.get(
            url,
            timeout=4,
            headers={"User-Agent": "Aqua/1.0 (weather)"},
        )
        r.raise_for_status()
        data = r.json()
        if "current_condition" in data and "weather" in data:
            return data
        return None
    except Exception:
        return None


def _fetch_wttr_urllib(location: Optional[str]) -> Optional[dict]:
    """Fetch via stdlib urllib as fallback."""
    try:
        base = "https://wttr.in"
        if location:
            loc_enc = urllib.parse.quote(location)
            url = f"{base}/{loc_enc}?format=j1"
        else:
            url = f"{base}/?format=j1"

        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Aqua/1.0 (weather)"},
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
            if "current_condition" in data and "weather" in data:
                return data
    except Exception:
        # Try http as last resort (some networks block https)
        try:
            base = "http://wttr.in"
            if location:
                loc_enc = urllib.parse.quote(location)
                url = f"{base}/{loc_enc}?format=j1"
            else:
                url = f"{base}/?format=j1"
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Aqua/1.0 (weather)"},
            )
            with urllib.request.urlopen(req, timeout=4) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                data = json.loads(raw)
                if "current_condition" in data and "weather" in data:
                    return data
        except Exception:
            return None
    return None


def _fetch_wttr(location: Optional[str]) -> Optional[dict]:
    """Fetch JSON from wttr.in. Returns dict or None on failure."""
    # Try requests first (more reliable), then urllib
    data = _fetch_wttr_requests(location)
    if data is not None:
        return data
    return _fetch_wttr_urllib(location)


def _format_weather(data: dict) -> str:
    """Turn wttr.in JSON into a friendly sentence."""
    try:
        cur = (data.get("current_condition") or [{}])[0]
        temp_f = cur.get("temp_F")
        temp_c = cur.get("temp_C")
        desc = (cur.get("weatherDesc") or [{}])[0].get("value", "")
        humidity = cur.get("humidity", "")
        wind_mph = cur.get("windspeedMiles", "")
        feels_f = cur.get("FeelsLikeF", "")

        today = (data.get("weather") or [{}])[0]
        maxtemp_f = today.get("maxtempF")
        mintemp_f = today.get("mintempF")
        maxtemp_c = today.get("maxtempC")
        mintemp_c = today.get("mintempC")

        parts = []

        if temp_f and desc:
            d = desc.lower()
            if feels_f and feels_f != temp_f:
                parts.append(f"Right now it's {temp_f}°F, feels like {feels_f}°F, and {d}")
            else:
                parts.append(f"Right now it's {temp_f}°F and {d}")
        elif temp_f:
            parts.append(f"Right now it's {temp_f}°F outside")
        elif temp_c and desc:
            parts.append(f"Right now it's {temp_c}°C and {desc.lower()}")
        elif desc:
            parts.append(f"Right now it's {desc.lower()} out there")

        if maxtemp_f and mintemp_f:
            parts.append(f"today you're looking at a high of {maxtemp_f}°F and a low of {mintemp_f}°F")
        elif maxtemp_c and mintemp_c:
            parts.append(f"today's high is {maxtemp_c}°C with a low of {mintemp_c}°C")

        if wind_mph:
            try:
                if int(wind_mph) >= 15:
                    parts.append(f"it's a bit breezy with winds around {wind_mph} mph")
            except Exception:
                pass

        if not parts:
            return "I checked the sky, but the report was a little fuzzy."

        if len(parts) == 1:
            return parts[0] + "."
        elif len(parts) == 2:
            return f"{parts[0]}, and {parts[1]}."
        else:
            return f"{parts[0]}, {parts[1]}, and {parts[2]}."

    except Exception:
        return "I tried to read the weather, but the forecast was a bit tangled."


def get_weather_report(mem=None) -> str:
    """Public entry point: returns a friendly weather sentence.

    If mem is provided, tries to use remembered location (e.g. 'Dallas').
    Otherwise falls back to IP-based detection via wttr.in.
    Never raises — always returns a string.
    """
    try:
        location = _get_location_from_memory(mem)

        data = _fetch_wttr(location)

        if data is None and location:
            # Retry without location (IP-based) if specific location failed
            data = _fetch_wttr(None)

        if data is None:
            return "I couldn't pull the weather right now — maybe the internet's taking a nap — but I hope it's beautiful where you are."

        # Try to get area name for context when we don't have a remembered location
        try:
            nearest = (data.get("nearest_area") or [{}])[0]
            area_name = (nearest.get("areaName") or [{}])[0].get("value") if nearest.get("areaName") else None
            if area_name and location is None:
                formatted = _format_weather(data)
                if formatted:
                    lowered = formatted[0].lower() + formatted[1:] if len(formatted) > 1 else formatted.lower()
                    return f"For {area_name}, {lowered}"
        except Exception:
            pass

        return _format_weather(data)

    except Exception:
        return "I couldn't pull the weather right now — but I hope it's beautiful where you are."


def get_weather_simple(mem=None) -> str:
    """Alias for backward compat / quick calls."""
    return get_weather_report(mem)
