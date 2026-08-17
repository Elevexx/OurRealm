"""Lightweight per-user preference tracker (Phase 4B).

Stores rolling counters under `user.preferences` so personalization can
weight discovery without expensive recalculation. We only ever do tiny
single-field $inc updates — no aggregation pipelines, no extra writes.

Schema (under each user doc):

    preferences: {
      categories: { "Music": 17, "Podcasts": 2, ... },
      genres:     { "House": 4, "Ambient": 9, ... },
      moods:      { "Chill": 6, ... },
      radii:      { "50": 11, "100": 3, "any": 8 },
      total_plays: 22,
      total_likes: 5,
    }

Reads use `summarise(user_id)` which returns top-N for each axis so the
ranking blend stays cheap (O(N) over a handful of buckets per user).
"""
from __future__ import annotations

from typing import Dict, Optional

from core.db import db


# Signal weights — likes count more than plays because they're explicit.
WEIGHTS = {"play": 1, "like": 3, "comment": 2, "share": 2, "save": 2}


async def bump(
    user_id: str,
    *,
    category: Optional[str] = None,
    genre: Optional[str] = None,
    mood: Optional[str] = None,
    radius: Optional[str] = None,
    signal: str = "play",
) -> None:
    """Increment preference counters in a single Mongo write."""
    if not user_id:
        return
    weight = WEIGHTS.get(signal, 1)
    inc: Dict[str, int] = {}
    if category: inc[f"preferences.categories.{_safe(category)}"] = weight
    if genre:    inc[f"preferences.genres.{_safe(genre)}"]       = weight
    if mood:     inc[f"preferences.moods.{_safe(mood)}"]         = weight
    if radius:   inc[f"preferences.radii.{_safe(radius)}"]       = 1
    if signal == "play": inc["preferences.total_plays"] = 1
    if signal == "like": inc["preferences.total_likes"] = 1
    if not inc:
        return
    try:
        await db.users.update_one({"id": user_id}, {"$inc": inc})
    except Exception:
        # Preferences are best-effort — never block the calling endpoint.
        pass


async def summarise(user_id: str) -> dict:
    """Return a small dict the ranking layer can read cheaply."""
    if not user_id:
        return _empty()
    doc = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "preferences": 1}
    )
    prefs = (doc or {}).get("preferences") or {}
    return {
        "categories": _top(prefs.get("categories")),
        "genres":     _top(prefs.get("genres")),
        "moods":      _top(prefs.get("moods")),
        "radii":      _top(prefs.get("radii")),
        "total_plays": int(prefs.get("total_plays", 0)),
        "total_likes": int(prefs.get("total_likes", 0)),
    }


def _empty() -> dict:
    return {"categories": {}, "genres": {}, "moods": {}, "radii": {},
            "total_plays": 0, "total_likes": 0}


def _top(d: Optional[dict], n: int = 8) -> dict:
    if not d:
        return {}
    items = sorted(d.items(), key=lambda kv: kv[1] or 0, reverse=True)[:n]
    return {k: int(v or 0) for k, v in items}


def _safe(key: str) -> str:
    """Mongo dotted-path keys can't contain '.' or '$'. We escape both."""
    return str(key).replace(".", "_").replace("$", "_")


def personalization_active(summary: dict) -> bool:
    """A user gets a personalized blend once they've crossed a small
    engagement threshold. Below that we keep showing pure global rankings
    so new users aren't trapped in a bubble of their first few clicks.
    """
    return (summary.get("total_plays", 0) + summary.get("total_likes", 0) * 2) >= 5


def boost(track: dict, summary: dict) -> float:
    """Personalization signal in [0, 1]-ish range — higher = more
    aligned with the user's history. Used to blend with the global score.
    """
    if not summary:
        return 0.0
    cats = summary["categories"]; gens = summary["genres"]; mods = summary["moods"]
    max_cat = max(cats.values(), default=0) or 1
    max_gen = max(gens.values(), default=0) or 1
    max_mod = max(mods.values(), default=0) or 1
    c = cats.get(_safe(track.get("category") or ""), 0) / max_cat
    g = gens.get(_safe(track.get("genre")    or ""), 0) / max_gen
    m = mods.get(_safe(track.get("mood")     or ""), 0) / max_mod
    # Slight weight tilt: genre & category > mood
    return 0.4 * c + 0.4 * g + 0.2 * m
