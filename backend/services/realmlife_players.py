"""RealmLife player/avatar system — fully independent from Nexus avatars.

Collections:
  realmlife_players         one profile per user (style, custom, selected_avatar)
  realmlife_avatar_unlocks  permanent account-bound unlocks (accessories + tiers)

Fire Power terminology only (UNLOCK / BURN) — never monetary wording.
"""
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from core.db import db

ACCESSORIES = {
    "cap": 100,
    "sunglasses": 100,
    "watch": 250,
    "bracelet": 250,
    "jacket": 500,
    "backpack": 500,
    "premium_shoes": 750,
}

# Fire Power values copied from Nexus AVATAR_FP_COSTS progression
# (1000 / 5000 / 10000 / 25000 / 50000 / 100000) — systems stay separate.
AVATAR_TIERS = [
    {"id": "rl_premium", "name": "Premium", "fp": 1000, "accent": "#22d3ee"},
    {"id": "rl_rare", "name": "Rare", "fp": 5000, "accent": "#3b82f6"},
    {"id": "rl_epic", "name": "Epic", "fp": 10000, "accent": "#8b5cf6"},
    {"id": "rl_elite", "name": "Elite", "fp": 25000, "accent": "#ec4899"},
    {"id": "rl_mythic", "name": "Mythic", "fp": 50000, "accent": "#f97316"},
    {"id": "rl_legendary", "name": "Legendary", "fp": 100000, "accent": "#eab308"},
]
TIER_MAP = {t["id"]: t for t in AVATAR_TIERS}

STYLES = ["style_a", "style_b"]
BOTTOMS = ["shorts", "pants"]
HAIR_STYLES = ["buzz", "crop", "side", "curly", "ponytail", "long"]
SKIN_TONES = ["#f6d7b8", "#eab98c", "#d29a6a", "#a9713f", "#7c4a24", "#5a3016"]

DEFAULT_CUSTOM = {
    "skin": "#eab98c",
    "hair_style": "crop",
    "hair_color": "#2c2118",
    "eye_color": "#3b6fb0",
    "shirt_color": "#f5f5f0",
    "bottoms": "shorts",
    "bottoms_color": "#7a5230",
    "shoe_color": "#f5f5f0",
    "accessories": {},
}

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _clean_color(value, fallback):
    v = str(value or "")
    return v if _HEX.match(v) else fallback


def _sanitize_custom(custom, owned_accessories):
    src = custom if isinstance(custom, dict) else {}
    out = dict(DEFAULT_CUSTOM)
    out["skin"] = _clean_color(src.get("skin"), DEFAULT_CUSTOM["skin"])
    out["hair_style"] = (
        src.get("hair_style")
        if src.get("hair_style") in HAIR_STYLES else DEFAULT_CUSTOM["hair_style"])
    out["hair_color"] = _clean_color(src.get("hair_color"), DEFAULT_CUSTOM["hair_color"])
    out["eye_color"] = _clean_color(src.get("eye_color"), DEFAULT_CUSTOM["eye_color"])
    out["shirt_color"] = _clean_color(src.get("shirt_color"), DEFAULT_CUSTOM["shirt_color"])
    out["bottoms"] = src.get("bottoms") if src.get("bottoms") in BOTTOMS else "shorts"
    out["bottoms_color"] = _clean_color(src.get("bottoms_color"), DEFAULT_CUSTOM["bottoms_color"])
    out["shoe_color"] = _clean_color(src.get("shoe_color"), DEFAULT_CUSTOM["shoe_color"])

    acc_out = {}
    for item_id, cfg in (src.get("accessories") or {}).items():
        if item_id not in ACCESSORIES or item_id not in owned_accessories:
            continue
        if not isinstance(cfg, dict):
            continue
        acc_out[item_id] = {
            "equipped": bool(cfg.get("equipped")),
            "color": _clean_color(cfg.get("color"), "#22262e"),
        }
    out["accessories"] = acc_out
    return out


async def _owned(user_id):
    rows = await db.realmlife_avatar_unlocks.find(
        {"user_id": user_id}, {"_id": 0, "item_id": 1, "kind": 1}).to_list(200)
    return {r["item_id"] for r in rows}


async def _fire_balance(user_id):
    w = await db.fire_wallets.find_one(
        {"user_id": user_id}, {"_id": 0, "vault_balance": 1})
    return int((w or {}).get("vault_balance") or 0)


async def get_state(user_id, is_founder=False):
    player = await db.realmlife_players.find_one(
        {"user_id": user_id}, {"_id": 0})
    owned = await _owned(user_id)
    return {
        "player": player,
        "unlocks": sorted(owned),
        "fire_balance": await _fire_balance(user_id),
        "is_founder": bool(is_founder),
        "catalog": {
            "accessories": [
                {"id": k, "fire_power_required": v} for k, v in ACCESSORIES.items()
            ],
            "avatar_tiers": [
                {**t, "fire_power_required": t["fp"]} for t in AVATAR_TIERS
            ],
            "styles": STYLES,
            "hair_styles": HAIR_STYLES,
            "skin_tones": SKIN_TONES,
            "bottoms": BOTTOMS,
        },
    }


async def create_or_update(user_id, username, style, custom, is_founder=False):
    if style not in STYLES:
        raise HTTPException(status_code=422, detail="Unknown player style.")
    owned = await _owned(user_id)
    clean = _sanitize_custom(custom, owned)
    now = _iso()
    default_selected = "founder_stealth" if is_founder else "starter"
    await db.realmlife_players.update_one(
        {"user_id": user_id},
        {"$set": {"style": style, "custom": clean, "updated_at": now},
         "$setOnInsert": {"user_id": user_id, "username": username,
                          "selected_avatar": default_selected, "created_at": now}},
        upsert=True)
    return await db.realmlife_players.find_one({"user_id": user_id}, {"_id": 0})


async def customize(user_id, custom=None, style=None):
    player = await db.realmlife_players.find_one({"user_id": user_id})
    if not player:
        raise HTTPException(status_code=404, detail="Create your RealmLife player first.")
    owned = await _owned(user_id)
    updates = {"updated_at": _iso()}
    if custom is not None:
        updates["custom"] = _sanitize_custom(custom, owned)
    if style is not None:
        if style not in STYLES:
            raise HTTPException(status_code=422, detail="Unknown player style.")
        updates["style"] = style
    await db.realmlife_players.update_one({"user_id": user_id}, {"$set": updates})
    return await db.realmlife_players.find_one({"user_id": user_id}, {"_id": 0})


async def unlock(user_id, item_id, is_founder=False):
    """Atomic idempotent Fire Power burn -> permanent RealmLife unlock."""
    if item_id in ACCESSORIES:
        kind, cost = "accessory", ACCESSORIES[item_id]
    elif item_id in TIER_MAP:
        kind, cost = "avatar", TIER_MAP[item_id]["fp"]
    else:
        raise HTTPException(status_code=404, detail="Unknown RealmLife unlock.")

    existing = await db.realmlife_avatar_unlocks.find_one(
        {"user_id": user_id, "item_id": item_id})
    if existing:
        return {"ok": True, "already_unlocked": True}

    if is_founder:
        await db.realmlife_avatar_unlocks.update_one(
            {"user_id": user_id, "item_id": item_id},
            {"$setOnInsert": {"user_id": user_id, "item_id": item_id, "kind": kind,
                              "fp_burned": 0, "founder_grant": True,
                              "tx_id": "founder-vault", "at": _iso()}},
            upsert=True)
        return {"ok": True, "founder_vault": True, "burned": 0}

    wallet = await db.fire_wallets.find_one_and_update(
        {"user_id": user_id, "vault_balance": {"$gte": cost}},
        {"$inc": {"vault_balance": -cost}})
    if not wallet:
        raise HTTPException(
            status_code=402,
            detail=f"🔥{cost:,} Fire Power required. Not enough in your Vault.")

    tx_id = uuid.uuid4().hex[:16]
    try:
        await db.realmlife_avatar_unlocks.insert_one({
            "user_id": user_id, "item_id": item_id, "kind": kind,
            "fp_burned": cost, "tx_id": tx_id, "at": _iso()})
    except Exception:
        await db.fire_wallets.update_one(
            {"user_id": user_id}, {"$inc": {"vault_balance": cost}})
        return {"ok": True, "already_unlocked": True}

    await db.fire_wallet_transactions.insert_one({
        "id": tx_id, "user_id": user_id, "type": "realmlife_unlock_burn",
        "amount": -cost, "item_id": item_id, "kind": kind, "at": _iso()})
    return {"ok": True, "tx_id": tx_id, "burned": cost}


async def select_avatar(user_id, avatar_id, is_founder=False):
    allowed = {"starter"}
    if is_founder:
        allowed.add("founder_stealth")
    owned = await _owned(user_id)
    allowed.update(t for t in TIER_MAP if t in owned)
    if avatar_id not in allowed:
        raise HTTPException(
            status_code=403,
            detail="That RealmLife avatar is not unlocked for this account.")
    result = await db.realmlife_players.update_one(
        {"user_id": user_id},
        {"$set": {"selected_avatar": avatar_id, "updated_at": _iso()}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Create your RealmLife player first.")
    return {"ok": True, "selected_avatar": avatar_id}
