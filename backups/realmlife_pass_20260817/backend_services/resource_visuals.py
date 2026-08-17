"""Phase 1.6 — Resource Visual Studio + Universal Placement Registry.

Visual packs are versioned and never overwritten; activation flips the
active version (URL carries ?v= for cache invalidation) and supports
rollback. Generation runs through the persistent job system; one master
image is generated, all sizes are derived mechanically (no extra provider
spend). Placements read ONE canonical resource/balance/ledger — no
per-surface duplicates.
"""
import io
import logging
import uuid
from datetime import datetime, timezone

from core.db import db
from services.storage import media_dir
from services.r2_mirror import mirror_to_cloud

log = logging.getLogger("ourrealm.resource_visuals")

DERIVED_SIZES = (512, 256, 128, 64, 32)
THUMB_SIZE = (320, 200)


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes():
    await db.resource_visuals.create_index("id", unique=True)
    await db.resource_visuals.create_index([("resource_key", 1), ("version", -1)])
    await db.gm_surface_adapters.create_index("key", unique=True)


def derive_pack(master_bytes: bytes) -> dict:
    """Mechanically derive every required size from one master image."""
    from PIL import Image
    img = Image.open(io.BytesIO(master_bytes)).convert("RGBA")
    img = img.resize((1024, 1024)) if img.size != (1024, 1024) else img
    out = {}

    def _save(im, name):
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        out[name] = buf.getvalue()

    _save(img, "1024")
    for s in DERIVED_SIZES:
        _save(img.resize((s, s), Image.LANCZOS), str(s))
    thumb = Image.new("RGBA", THUMB_SIZE, (0, 0, 0, 0))
    icon = img.resize((160, 160), Image.LANCZOS)
    thumb.paste(icon, ((THUMB_SIZE[0] - 160) // 2, (THUMB_SIZE[1] - 160) // 2), icon)
    _save(thumb, "thumb")
    for bg, name in (((248, 249, 252, 255), "preview_light"), ((7, 12, 24, 255), "preview_dark")):
        pv = Image.new("RGBA", (256, 256), bg)
        ic = img.resize((192, 192), Image.LANCZOS)
        pv.paste(ic, (32, 32), ic)
        _save(pv, name)
    return out


def store_pack(resource_key: str, version: int, pack: dict) -> dict:
    urls = {}
    root = media_dir("resource_visuals")
    for name, data in pack.items():
        fn = f"{resource_key}_v{version}_{name}.png"
        p = root / fn
        p.write_bytes(data)
        urls[name] = mirror_to_cloud("resource_visuals", fn, p, f"/uploads/resource_visuals/{fn}")
    return urls


async def create_version(resource_key: str, master_bytes: bytes, *, source: str,
                         created_by: str, prompt: str = "", provider_cost: float = 0.0,
                         accessibility_label: str = "", asset_ref: str = "") -> dict:
    if len(master_bytes) > 12 * 1024 * 1024:
        raise ValueError("Image too large (12MB max)")
    from PIL import Image  # validates it's really an image (upload scanning)
    Image.open(io.BytesIO(master_bytes)).verify()
    latest = await db.resource_visuals.find_one({"resource_key": resource_key}, {"version": 1},
                                                sort=[("version", -1)])
    v = (latest or {}).get("version", 0) + 1
    pack = derive_pack(master_bytes)
    urls = store_pack(resource_key, v, pack)
    doc = {"id": uuid.uuid4().hex, "resource_key": resource_key, "version": v,
           "source": source, "prompt": prompt[:400], "provider_cost": provider_cost,
           "asset_ref": asset_ref, "accessibility_label": accessibility_label[:120],
           "images": urls, "active": False, "created_by": created_by, "created_at": _iso()}
    await db.resource_visuals.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def activate(resource_key: str, visual_id: str, actor: str) -> dict:
    vis = await db.resource_visuals.find_one({"id": visual_id, "resource_key": resource_key}, {"_id": 0})
    if not vis:
        raise ValueError("Visual version not found")
    await db.resource_visuals.update_many({"resource_key": resource_key}, {"$set": {"active": False}})
    await db.resource_visuals.update_one({"id": visual_id}, {"$set": {"active": True}})
    bust = f"?v={vis['version']}"  # cache/CDN invalidation
    await db.resource_registry.update_one({"key": resource_key}, {
        "$set": {"active_visual": {"id": visual_id, "version": vis["version"],
                                   "icon_url": vis["images"].get("64", "") + bust,
                                   "icon_512": vis["images"].get("512", "") + bust,
                                   "master_url": vis["images"].get("1024", "") + bust,
                                   "animation": vis.get("animation"),
                                   "label": vis.get("accessibility_label") or resource_key},
                 "updated_at": _iso()},
        "$inc": {"version": 1},
        "$push": {"audit": {"$each": [{"by": actor, "at": _iso(), "action": "visual_activated",
                                       "visual_id": visual_id, "visual_version": vis["version"]}],
                            "$slice": -50}}})
    return vis


# ─── Universal Placement Registry ─────────────────────────────────────────

FULL = {"display": True, "balance": True, "earn": True, "hold": True, "burn": True,
        "exchange": True, "admin_grant": True, "game_reward": True, "history": True,
        "public": True, "mobile": True}
DISPLAY = {**{k: False for k in FULL}, "display": True, "balance": True,
           "history": False, "public": True, "mobile": True}

BUILTIN_SURFACES = {
    "vault": {"label": "Fire Vault", "caps": FULL},
    "foryou": {"label": "For You", "caps": {**DISPLAY, "history": True}},
    "games": {"label": "Published Games (HUD + results)", "caps": {**FULL, "admin_grant": False}},
    "saved_games": {"label": "Saved Games", "caps": DISPLAY},
    "responsibility_center": {"label": "Responsibility Center", "caps": {**DISPLAY, "earn": True, "history": True}},
    "profiles": {"label": "Profiles & Achievements", "caps": DISPLAY},
    "notifications": {"label": "Notifications", "caps": {**DISPLAY, "balance": False}},
    "admin": {"label": "Admin Analytics", "caps": FULL},
}

MODES = ("unsupported", "disabled", "display", "full", "custom")
OP_KEYS = ("display_icon", "display_balance", "display_activity", "allow_earning",
           "allow_holding", "allow_burning", "allow_exchange", "allow_admin_grants",
           "allow_game_rewards", "public_visible", "owner_only", "hidden")


async def all_surfaces() -> dict:
    out = {k: {**v, "builtin": True} for k, v in BUILTIN_SURFACES.items()}
    async for a in db.gm_surface_adapters.find({}, {"_id": 0}):
        out[a["key"]] = {"label": a["label"], "caps": a["caps"], "builtin": False,
                         "registered_at": a.get("registered_at")}
    return out


async def register_adapter(key: str, label: str, caps: dict, actor: str) -> dict:
    """Future-surface adapter contract: declare capabilities, get auto-discovery."""
    key = key.strip().lower().replace(" ", "_")[:40]
    caps = {k: bool(caps.get(k)) for k in FULL}
    doc = {"key": key, "label": label[:80], "caps": caps, "registered_at": _iso(),
           "registered_by": actor}
    await db.gm_surface_adapters.update_one({"key": key}, {"$set": doc}, upsert=True)
    discovered = [r["key"] async for r in db.resource_registry.find(
        {"enable_everywhere": True, "archived": {"$ne": True}}, {"key": 1})]
    await db.orai_policy_audit.insert_one({
        "id": uuid.uuid4().hex, "capability": "surface_adapter", "by": actor, "at": _iso(),
        "changes": {"registered": key, "auto_discovered_resources": discovered}, "note": "adapter registration"})
    return {"surface": doc, "auto_discovered_resources": discovered}


def effective_placement(resource: dict, surface_key: str, surface: dict) -> dict:
    """Global 'Enable Everywhere' respects more-restrictive per-surface policy
    and never exceeds the surface's declared capabilities."""
    caps = surface["caps"]
    conf = (resource.get("placements") or {}).get(surface_key) or {}
    mode = conf.get("mode")
    if mode is None:
        mode = "full" if resource.get("enable_everywhere") else "disabled"
    if mode in ("disabled", "unsupported"):
        return {"mode": "disabled", "ops": {k: False for k in OP_KEYS}}
    base = {"display_icon": caps["display"], "display_balance": caps["balance"],
            "display_activity": caps["history"], "allow_earning": caps["earn"] and mode == "full",
            "allow_holding": caps["hold"] and mode == "full",
            "allow_burning": caps["burn"] and mode == "full",
            "allow_exchange": caps["exchange"] and mode == "full",
            "allow_admin_grants": caps["admin_grant"] and mode == "full",
            "allow_game_rewards": caps["game_reward"] and mode == "full",
            "public_visible": caps["public"] and bool(resource.get("public")),
            "owner_only": not caps["public"], "hidden": False}
    if mode == "display":
        for k in ("allow_earning", "allow_holding", "allow_burning", "allow_exchange",
                  "allow_admin_grants", "allow_game_rewards"):
            base[k] = False
    for k, v in (conf.get("overrides") or {}).items():
        if k in OP_KEYS and v is False:  # overrides may only restrict, never expand
            base[k] = False
    return {"mode": mode, "ops": base}


async def placements_for_surface(surface_key: str, user_id: str | None) -> list:
    surfaces = await all_surfaces()
    surface = surfaces.get(surface_key)
    if not surface:
        raise ValueError("Unknown surface")
    from services import resources as rs
    out = []
    async for r in db.resource_registry.find(
            {"archived": {"$ne": True}, "enabled": True, "status": {"$ne": "draft"}}, {"_id": 0}):
        eff = effective_placement(r, surface_key, surface)
        if eff["mode"] == "disabled" or eff["ops"]["hidden"] or not eff["ops"]["display_icon"]:
            continue
        if not r.get("public") and not eff["ops"]["owner_only"]:
            continue
        row = {"key": r["key"], "name": r["name"], "icon": r.get("icon"),
               "color": r.get("color"), "visual": r.get("active_visual"),
               "config_version": r.get("version"), "ops": eff["ops"], "mode": eff["mode"]}
        if user_id and eff["ops"]["display_balance"]:
            from services.economy import available_balance
            row["balance"] = await available_balance(user_id, r["key"])
        out.append(row)
    return out
