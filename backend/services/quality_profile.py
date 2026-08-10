"""Server-authoritative Founder Maximum Quality profile.
Single source of truth for every creation route (ORAi, /admin/games,
GameMaker quote/create, Studio). Forces 10/10 for founder builds and stamps
founder_max_quality so downstream jobs/planners/builders can prove it."""

FOUNDER_MAX = {"complexity": 10, "ai_power": 10, "founder_max_quality": True}


def is_founder(user) -> bool:
    return bool(user) and (user.get("role") == "founder" or user.get("is_founder"))


def apply_founder_max(payload: dict, user) -> dict:
    """Mutates+returns payload: founders always get 10/10, flag stamped."""
    if is_founder(user):
        payload["complexity"] = 10
        payload["ai_power"] = 10
        payload["founder_max_quality"] = True
    else:
        payload.setdefault("complexity", 10)
        payload.setdefault("ai_power", 10)
        payload["founder_max_quality"] = False
    return payload
