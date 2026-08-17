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

# ============================================================
# REALMLIFE FINAL AVATAR ROSTER
#
# RealmLife avatars are completely separate from Nexus.
#
# Final active roster:
#   Founder Stealth
#   Starter 1
#   Starter 2
#
# Historical premium avatar unlock records may remain safely
# in Mongo but are no longer exposed or selectable.
# ============================================================

AVATAR_TIERS = []
TIER_MAP = {}

STARTER_AVATARS = [
    {
        "id": "starter_1",
        "name": "Starter 1",
        "slot": "starter_1",
        "asset_id":
            "3717666fb2cf5f39e8349ef146493249",
        "model_url":
            "/api/media/models/3717666fb2cf5f39e8349ef146493249.glb",
    },
    {
        "id": "starter_2",
        "name": "Starter 2",
        "slot": "starter_2",
        "asset_id":
            "524b74f37e9bd9af20444594f13e4e2d",
        "model_url":
            "/api/media/models/524b74f37e9bd9af20444594f13e4e2d.glb",
    },
]

STARTER_MAP = {
    s["id"]: s
    for s in STARTER_AVATARS
}


async def avatar_assets():
    rows = await db.asset_library.find(
        {"context.project": "realmlife_avatars"},
        {"_id": 0, "context.slot": 1, "url": 1, "meta.thumb_url": 1, "meta.rigged": 1},
    ).to_list(100)
    return {r["context"]["slot"]: r for r in rows}

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
    assets = await avatar_assets()

    valid_avatar_ids = set(STARTER_MAP)

    if is_founder:
        valid_avatar_ids.add(
            "founder_stealth"
        )

    if player:
        selected = player.get(
            "selected_avatar"
        )

        if selected not in valid_avatar_ids:
            selected = (
                "founder_stealth"
                if is_founder
                else "starter_1"
            )

            await db.realmlife_players.update_one(
                {
                    "user_id":
                        user_id
                },
                {
                    "$set": {
                        "selected_avatar":
                            selected,
                        "updated_at":
                            _iso(),
                    }
                },
            )

            player["selected_avatar"] = (
                selected
            )

    def _enrich(entry):
        a = assets.get(entry["slot"]) or {}
        meta = a.get("meta") or {}

        model_url = (
            entry.get("model_url")
            or a.get("url")
        )

        return {
            **entry,
            "fire_power_required":
                entry.get("fp", 0),
            "thumb_url":
                meta.get("thumb_url"),
            "model_url":
                model_url,
            "model_ready":
                bool(model_url),
            "rigged":
                bool(meta.get("rigged"))
                or bool(model_url),
        }

    return {
        "player": player,
        "unlocks": sorted(owned),
        "fire_balance": await _fire_balance(user_id),
        "is_founder": bool(is_founder),
        "catalog": {
            "accessories": [
                {"id": k, "fire_power_required": v} for k, v in ACCESSORIES.items()
            ],
            "starters": [_enrich({**s, "fp": 0}) for s in STARTER_AVATARS],
            "avatar_tiers": [_enrich(t) for t in AVATAR_TIERS],
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
    default_selected = (
        "founder_stealth"
        if is_founder
        else "starter_1"
    )
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
    allowed = set(STARTER_MAP)

    if is_founder:
        allowed.add(
            "founder_stealth"
        )
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
