"""Game Access & Visibility — founder-controlled per-game access modes.

Single source of truth: game["access"]. Legacy game["release"] configs are
read-only migrated on the fly (never rewritten automatically). ALL enforcement
is server-side via evaluate(); the frontend only mirrors the result.
"""
import logging
from datetime import datetime, timezone

from core.db import db

log = logging.getLogger("ourrealm.game_access")

MODES = ("founder_only", "custom_users", "badge_access", "progression_access",
         "view_only", "preview", "public_preview", "published", "maintenance")

MODE_LABELS = {
    "founder_only": "Founder Only", "custom_users": "Custom Users",
    "badge_access": "Badge Access", "progression_access": "Progression Access",
    "view_only": "View Only", "preview": "Preview",
    "public_preview": "Public Preview", "published": "Published / Live",
    "maintenance": "Maintenance"}

PUBLIC_PREVIEW_MESSAGE = ("Public Preview — play free as a guest. Sign in to collect Fire Power, "
                          "Keys, Engagement Resources and permanent saves.")
PUBLIC_PREVIEW_MEMBER_MESSAGE = ("Public Preview — you're signed in, so enabled rewards "
                                 "and saves count permanently.")
VIEW_ONLY_MESSAGE = ("View Only Mode — gameplay, saves, Fire Power, and Key rewards "
                     "are disabled.")
MAINTENANCE_MESSAGE = "This game is under maintenance — play is temporarily disabled."

FLAG_KEYS = ("fire", "keys", "saves", "leaderboard", "reports")


def _iso():
    return datetime.now(timezone.utc).isoformat()


def default_flags(mode: str) -> dict:
    if mode in ("view_only", "public_preview"):
        return {k: False for k in FLAG_KEYS}
    if mode == "preview":  # rewards default OFF in Preview unless founder enables
        return {"fire": False, "keys": False, "saves": False, "leaderboard": False, "reports": True}
    return {k: True for k in FLAG_KEYS}


def normalize_config(body: dict) -> dict:
    mode = body.get("mode")
    if mode not in MODES:
        raise ValueError(f"Unknown access mode: {mode}")
    users = []
    seen = set()
    for u in (body.get("users") or [])[:500]:
        if isinstance(u, dict) and u.get("id") and u.get("username"):
            if u["id"] not in seen:
                seen.add(u["id"])
                users.append({"id": str(u["id"]), "username": str(u["username"])})
    flags = {**default_flags(mode)}
    for k in FLAG_KEYS:
        if k in (body.get("flags") or {}):
            flags[k] = bool(body["flags"][k])
    if mode == "view_only":  # hard-locked, never founder-enabled
        flags = default_flags(mode)
    fin = body.get("filters") or {}
    filters = {
        "badges": [str(b)[:60] for b in (fin.get("badges") or [])][:50],
        "badge_match": "all" if fin.get("badge_match") == "all" else "any",
        "min_level": int(fin["min_level"]) if fin.get("min_level") not in (None, "") else None,
        "max_level": int(fin["max_level"]) if fin.get("max_level") not in (None, "") else None,
        "min_fire": int(fin["min_fire"]) if fin.get("min_fire") not in (None, "") else None,
        "min_account_age_days": int(fin["min_account_age_days"]) if fin.get("min_account_age_days") not in (None, "") else None,
        "audience": fin.get("audience") if fin.get("audience") in ("all", "teen_only", "adult_only") else "all",
    }
    return {
        "mode": mode, "users": users,
        "badges": [str(b)[:60] for b in (body.get("badges") or [])][:50],
        "badge_match": "all" if body.get("badge_match") == "all" else "any",
        "levels": sorted({int(x) for x in (body.get("levels") or []) if str(x).lstrip("-").isdigit()})[:30],
        "min_level": int(body["min_level"]) if body.get("min_level") not in (None, "") else None,
        "max_level": int(body["max_level"]) if body.get("max_level") not in (None, "") else None,
        "flags": flags, "filters": filters,
        "founder_bypass": body.get("founder_bypass") is not False,
        "visible_when_blocked": bool(body.get("visible_when_blocked")),
        "maintenance_message": str(body.get("maintenance_message") or "")[:300],
    }


def migrate_release(game: dict) -> dict:
    """Read-only equivalent of the legacy release config (never persisted)."""
    rel = game.get("release") or {}
    mode, req = rel.get("mode") or "launch", rel.get("requirements") or {}
    cfg = {"mode": "published", "users": [], "badges": [], "badge_match": "any",
           "levels": [], "min_level": None, "max_level": None,
           "flags": default_flags("published"), "filters": {}, "founder_bypass": True,
           "visible_when_blocked": False, "maintenance_message": "",
           "migrated_from_release": bool(game.get("release"))}
    if mode in ("founder_only", "archive"):
        cfg["mode"] = "founder_only"
    elif mode == "maintenance":
        cfg["mode"] = "maintenance"
    elif mode == "beta":
        cfg["mode"] = "custom_users"
        cfg["users"] = [{"id": x, "username": x} for x in (req.get("beta_list") or [])]
    elif mode == "custom":
        if req.get("badges"):
            cfg["mode"] = "badge_access"
            cfg["badges"] = list(req["badges"])
        elif req.get("users"):
            cfg["mode"] = "custom_users"
            cfg["users"] = [{"id": x, "username": x} for x in req["users"]]
    if req.get("min_level"):
        cfg["filters"] = {"min_level": int(req["min_level"])}
    if cfg["mode"] != "published":
        cfg["flags"] = default_flags(cfg["mode"])
    return cfg


def get_config(game: dict) -> dict:
    cfg = game.get("access")
    if isinstance(cfg, dict) and cfg.get("mode") in MODES:
        return {**cfg}
    return migrate_release(game)


async def load_user_ctx(user: dict | None) -> dict:
    if not user:
        return {"guest": True, "badges": set(), "level": 0, "fire": 0,
                "created_at": None, "age_class": None}
    uid = user["id"]
    badges = set()
    async for b in db.user_badges.find({"user_id": uid}, {"_id": 0, "badge_key": 1}):
        if b.get("badge_key"):
            badges.add(b["badge_key"])
    lvl = await db.user_level_progress.find_one({"user_id": uid}, {"current_level_number": 1}) or {}
    wallet = await db.fire_wallets.find_one({"user_id": uid}, {"vault_balance": 1}) or {}
    u = await db.users.find_one({"id": uid}, {"created_at": 1, "age_class": 1}) or {}
    return {"guest": False, "badges": badges,
            "level": int(lvl.get("current_level_number") or 0),
            "fire": int(wallet.get("vault_balance") or 0),
            "created_at": u.get("created_at"), "age_class": u.get("age_class")}


def _out(allowed, reason, mode, *, view_only=False, flags=None, message=None,
         visible=None, trace=None):
    return {"allowed": allowed, "reason": reason, "mode": mode,
            "label": MODE_LABELS.get(mode, mode),
            "view_only": view_only,
            "flags": flags if flags is not None else default_flags(mode),
            "message": message,
            "visible": visible if visible is not None else allowed,
            "trace": trace or []}


def _account_age_days(created_at) -> int:
    if not created_at:
        return 0
    try:
        dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except Exception:
        return 0


def _check_filters(cfg: dict, ctx: dict, trace: list):
    """Optional layered eligibility filters. Returns deny reason or None."""
    f = cfg.get("filters") or {}
    if f.get("badges"):
        sel = set(f["badges"])
        ok = bool(sel & ctx["badges"]) if f.get("badge_match", "any") == "any" else sel <= ctx["badges"]
        trace.append(f"filter badges({f.get('badge_match','any')}): {'pass' if ok else 'FAIL'}")
        if not ok:
            return "required_badge_missing"
    if f.get("min_level") is not None and ctx["level"] < f["min_level"]:
        trace.append(f"filter min_level {f['min_level']}: FAIL (user {ctx['level']})")
        return "progression_too_low"
    if f.get("max_level") is not None and ctx["level"] > f["max_level"]:
        trace.append(f"filter max_level {f['max_level']}: FAIL (user {ctx['level']})")
        return "progression_too_high"
    if f.get("min_fire") is not None and ctx["fire"] < f["min_fire"]:
        trace.append(f"filter min_fire {f['min_fire']}: FAIL (user {ctx['fire']})")
        return "fire_power_too_low"
    if f.get("min_account_age_days") is not None:
        age = _account_age_days(ctx.get("created_at"))
        if age < f["min_account_age_days"]:
            trace.append(f"filter account_age {f['min_account_age_days']}d: FAIL (user {age}d)")
            return "account_too_new"
    aud = f.get("audience") or "all"
    if aud == "teen_only" and ctx.get("age_class") != "teen":
        return "audience_restricted"
    if aud == "adult_only" and ctx.get("age_class") == "teen":
        return "audience_restricted"
    return None


async def evaluate(game: dict, user: dict | None, ctx: dict | None = None) -> dict:
    """Authoritative access decision for one game + one user (or guest)."""
    cfg = get_config(game)
    mode = cfg["mode"]
    flags = {**default_flags(mode), **(cfg.get("flags") or {})}
    if mode == "view_only":
        flags = default_flags(mode)
    trace = [f"mode={mode}"]

    if user is None:  # guest
        if mode in ("public_preview", "published"):
            return _out(True, "public_preview", mode, flags=default_flags("public_preview"),
                        message=PUBLIC_PREVIEW_MESSAGE, trace=trace + ["guest allowed"])
        return _out(False, "auth_required", mode, visible=False, trace=trace + ["guest denied"])

    from core.permissions import get_admin_role
    if cfg.get("founder_bypass", True) and get_admin_role(user):
        trace.append("founder/admin bypass")
        msg = PUBLIC_PREVIEW_MEMBER_MESSAGE if mode == "public_preview" else \
            VIEW_ONLY_MESSAGE if mode == "view_only" else None
        return _out(True, "founder_bypass", mode, flags=flags, message=msg,
                    visible=True, trace=trace)

    if ctx is None:
        ctx = await load_user_ctx(user)

    if mode == "founder_only":
        return _out(False, "founder_only", mode, visible=False, trace=trace)
    if mode == "maintenance":
        return _out(False, "maintenance_mode", mode,
                    message=cfg.get("maintenance_message") or MAINTENANCE_MESSAGE,
                    visible=bool(cfg.get("visible_when_blocked")), trace=trace)
    if mode == "custom_users":
        idset = set()
        for u in cfg.get("users") or []:
            idset.add(u.get("id"))
            idset.add(u.get("username"))
        if user["id"] not in idset and user.get("username") not in idset:
            return _out(False, "user_not_allowed", mode, visible=False, trace=trace)
        trace.append("user in allow list")
    if mode == "badge_access":
        sel = set(cfg.get("badges") or [])
        if sel:
            ok = bool(sel & ctx["badges"]) if cfg.get("badge_match", "any") == "any" else sel <= ctx["badges"]
            trace.append(f"badges({cfg.get('badge_match','any')}) need {sorted(sel)}, have {sorted(ctx['badges'])}")
            if not ok:
                return _out(False, "required_badge_missing", mode, visible=False, trace=trace)
    if mode == "progression_access":
        n = ctx["level"]
        trace.append(f"user level {n}")
        lv = cfg.get("levels") or []
        if lv and n not in lv:
            return _out(False, "progression_not_allowed", mode, visible=False, trace=trace)
        if cfg.get("min_level") is not None and n < cfg["min_level"]:
            return _out(False, "progression_too_low", mode, visible=False, trace=trace)
        if cfg.get("max_level") is not None and n > cfg["max_level"]:
            return _out(False, "progression_too_high", mode, visible=False, trace=trace)

    if mode in ("custom_users", "badge_access", "progression_access", "preview", "published"):
        deny = _check_filters(cfg, ctx, trace)
        if deny:
            return _out(False, deny, mode, visible=False, trace=trace)

    if mode == "view_only":
        return _out(True, "view_only", mode, view_only=True, flags=flags,
                    message=VIEW_ONLY_MESSAGE, trace=trace)
    if mode == "public_preview":
        # Signed-in members earn enabled rewards permanently — only guests are
        # reward-locked (the server can't credit an anonymous browser).
        return _out(True, "public_preview", mode, flags=default_flags("published"),
                    message=PUBLIC_PREVIEW_MEMBER_MESSAGE,
                    trace=trace + ["signed-in member: enabled rewards active"])
    if mode == "preview":
        return _out(True, "preview", mode, flags=flags,
                    message="Preview build — Founder-controlled test access.", trace=trace)
    return _out(True, "allowed", mode, flags=flags, trace=trace)


def resolve_cover(g: dict) -> str | None:
    """Shared cover resolver: cover → thumbnail → generated/spec cover → None."""
    spec = g.get("spec") or {}
    return (g.get("cover_url") or g.get("thumbnail_url") or g.get("thumbnail")
            or spec.get("cover_url") or spec.get("thumbnail") or None)


def summary_text(cfg: dict) -> str:
    mode = cfg.get("mode", "published")
    parts = [MODE_LABELS.get(mode, mode)]
    if mode == "custom_users" and cfg.get("users"):
        parts.append("accessible to " + ", ".join("@" + u["username"] for u in cfg["users"][:8])
                     + (f" +{len(cfg['users']) - 8} more" if len(cfg["users"]) > 8 else ""))
    if mode == "badge_access" and cfg.get("badges"):
        parts.append(("ANY of " if cfg.get("badge_match", "any") == "any" else "ALL of ")
                     + ", ".join(cfg["badges"][:8]) + " badges")
    if mode == "progression_access":
        if cfg.get("levels"):
            parts.append("levels " + ", ".join(map(str, cfg["levels"])))
        if cfg.get("min_level") is not None:
            parts.append(f"minimum level {cfg['min_level']}")
        if cfg.get("max_level") is not None:
            parts.append(f"maximum level {cfg['max_level']}")
    f = cfg.get("filters") or {}
    if f.get("badges"):
        parts.append(("any" if f.get("badge_match", "any") == "any" else "all") + " badge filter: " + ", ".join(f["badges"][:6]))
    if f.get("min_level") is not None:
        parts.append(f"min level {f['min_level']}")
    if f.get("max_level") is not None:
        parts.append(f"max level {f['max_level']}")
    if f.get("min_fire") is not None:
        parts.append(f"min {f['min_fire']} Fire Power")
    if f.get("min_account_age_days") is not None:
        parts.append(f"account ≥ {f['min_account_age_days']}d old")
    if (f.get("audience") or "all") != "all":
        parts.append(f["audience"].replace("_", " "))
    fl = cfg.get("flags") or default_flags(mode)
    parts.append(f"Fire Power {'ON' if fl.get('fire') else 'OFF'}")
    parts.append(f"Keys {'ON' if fl.get('keys') else 'OFF'}")
    parts.append(f"Saves {'ON' if fl.get('saves') else 'OFF'}")
    parts.append(f"Leaderboard {'ON' if fl.get('leaderboard') else 'OFF'}")
    if cfg.get("founder_bypass", True):
        parts.append("Founder/Admin bypass ON")
    return " — ".join([parts[0], ", ".join(parts[1:])]) if len(parts) > 1 else parts[0]


async def audit_change(game_id: str, actor: dict, prev: dict, new: dict, reason: str,
                       action: str = "access_changed") -> dict:
    import os
    import uuid
    entry = {"id": uuid.uuid4().hex, "game_id": game_id, "action": action,
             "changed_by": actor.get("username"), "prev": prev, "new": new,
             "reason": reason[:400], "at": _iso(),
             "env_db": os.environ.get("DB_NAME", ""),
             "mode": (new or {}).get("mode"),
             "reward_changes": {k: {"from": (prev.get("flags") or {}).get(k),
                                    "to": (new.get("flags") or {}).get(k)}
                                for k in FLAG_KEYS
                                if (prev.get("flags") or {}).get(k) != (new.get("flags") or {}).get(k)} if prev else {}}
    await db.game_access_audit.insert_one({**entry})
    return entry
