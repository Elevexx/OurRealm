"""Dragon Realm: The Fire Quest — server-authoritative content, progress,
and Fire Power claims for the turn_based_creature_rpg runtime family.

Runtime family : turn_based_creature_rpg
Runtime ID     : runtime_dragon_realm_rpg_v1
Template ID    : tpl_dragon_realm_fire_quest_v1
Renderer       : renderer_pixel_creature_rpg_v1 (React, not the sandboxed iframe)
"""
import uuid
from datetime import datetime, timezone

from core.db import db

GAME_ID = "dragon_realm_fire_quest"
RUNTIME_ID = "runtime_dragon_realm_rpg_v1"
TEMPLATE_ID = "tpl_dragon_realm_fire_quest_v1"
RENDERER_ID = "renderer_pixel_creature_rpg_v1"


def _iso():
    return datetime.now(timezone.utc).isoformat()


DEFAULT_CONFIG = {
    "id": "config", "enabled": True, "access_mode": "founder_only",
    "eligible_user_ids": [], "eligible_usernames": [],
    "maintenance_message": "Dragon Realm is resting. Check back soon!",
    "game_version": "0.1.0-forest-slice",
    "rewards": {"quest_complete": 25, "dragon_first_defeat": 10, "boss_thornbeast": 100},
    "updated_at": None, "updated_by": None,
}

# ── Enchanted Forest content (server-authoritative ids) ──────────────────
DRAGONS = {
    "emberling": {"id": "emberling", "name": "Emberling", "element": "fire", "rarity": "common",
                  "level": 12, "hp": 34, "attack": 8, "defense": 5, "magic": 7, "speed": 8,
                  "lore": "A hatchling that sneezes sparks when startled."},
    "mossback": {"id": "mossback", "name": "Mossback", "element": "nature", "rarity": "common",
                 "level": 13, "hp": 40, "attack": 7, "defense": 8, "magic": 5, "speed": 5,
                 "lore": "Sleeps so long that moss gardens grow on its shell."},
    "vinewing": {"id": "vinewing", "name": "Vinewing", "element": "nature", "rarity": "uncommon",
                 "level": 14, "hp": 36, "attack": 9, "defense": 6, "magic": 8, "speed": 9,
                 "lore": "Glides between ancient trees on leaf-woven wings."},
    "leafscale": {"id": "leafscale", "name": "Leafscale", "element": "nature", "rarity": "common",
                  "level": 12, "hp": 32, "attack": 7, "defense": 6, "magic": 7, "speed": 7,
                  "lore": "Its scales change color with the seasons."},
    "barkhorn": {"id": "barkhorn", "name": "Barkhorn", "element": "earth", "rarity": "uncommon",
                 "level": 15, "hp": 44, "attack": 10, "defense": 9, "magic": 4, "speed": 4,
                 "lore": "Charges through ruins like a living battering ram."},
    "glowtail": {"id": "glowtail", "name": "Glowtail", "element": "light", "rarity": "rare",
                 "level": 16, "hp": 38, "attack": 8, "defense": 6, "magic": 11, "speed": 10,
                 "lore": "Its tail-light guides lost travelers out of the deep woods."},
}
BOSS = {"id": "thornbeast", "name": "THORNBEAST", "element": "nature", "level": 20,
        "hp": 150, "attack": 12, "defense": 9, "magic": 9, "speed": 6,
        "attacks": ["Poison Spikes", "Vine Whip", "Root Prison", "Forest Regeneration", "Thorn Shield"],
        "lore": "Guardian of the Enchanted Forest, wreathed in living thorns."}
QUEST = {"id": "q_first_flame", "title": "The First Flame",
         "description": "The Forest Elder asks you to prove yourself as a Dragon Warden.",
         "objectives": [
             {"id": "discover3", "label": "Discover 3 wild dragons", "target": 3},
             {"id": "befriend1", "label": "Befriend a dragon", "target": 1},
             {"id": "boss", "label": "Defeat THORNBEAST", "target": 1}],
         "region": "enchanted_forest"}
REWARD_DEFS = {  # reward_id -> (config key, ledger reason)
    "quest_q_first_flame": ("quest_complete", "dragon_realm_quest_claim"),
    "boss_thornbeast": ("boss_thornbeast", "dragon_realm_boss_claim"),
    **{f"dragon_first_{d}": ("dragon_first_defeat", "dragon_realm_dragon_claim") for d in DRAGONS},
}


async def get_config() -> dict:
    doc = await db.dragon_realm_config.find_one({"id": "config"}, {"_id": 0})
    if not doc:
        await db.dragon_realm_config.update_one(
            {"id": "config"}, {"$setOnInsert": DEFAULT_CONFIG}, upsert=True)
        return dict(DEFAULT_CONFIG)
    return {**DEFAULT_CONFIG, **doc, "rewards": {**DEFAULT_CONFIG["rewards"], **(doc.get("rewards") or {})}}


def user_allowed(cfg: dict, user: dict) -> bool:
    if not cfg.get("enabled"):
        return False
    mode = cfg.get("access_mode", "founder_only")
    if user.get("is_founder"):
        return True
    if mode in ("live", "launch"):
        return True
    if mode in ("custom", "beta"):
        return (user["id"] in (cfg.get("eligible_user_ids") or []) or
                (user.get("username") or "").lower() in [u.lower() for u in (cfg.get("eligible_usernames") or [])])
    return False  # founder_only / maintenance


async def get_save(user_id: str) -> dict:
    doc = await db.dragon_realm_saves.find_one({"user_id": user_id, "game": GAME_ID}, {"_id": 0})
    if not doc:
        rst = await db.dragon_realm_resets.find_one({"user_id": user_id, "game": GAME_ID})
        doc = {"user_id": user_id, "game": GAME_ID, "save": None, "save_version": 0,
               "epoch": int((rst or {}).get("count") or 0),
               "trusted": {"discovered": [], "befriended": [], "first_defeats": [],
                           "boss_defeated": False, "quest_complete": False,
                           "rewards": {}, "last_event_at": None, "events": 0},
               "created_at": _iso(), "updated_at": _iso()}
        await db.dragon_realm_saves.insert_one({**doc})
        doc.pop("_id", None)
    return doc


def _pending_reward(amount: int, reason: str) -> dict:
    return {"amount": int(amount), "reason": reason, "status": "unclaimed", "created_at": _iso()}


async def record_event(user: dict, ev: dict) -> dict:
    """Validate + apply a trusted progress event. Returns updated trusted doc."""
    cfg = await get_config()
    doc = await get_save(user["id"])
    t = doc["trusted"]
    etype = str(ev.get("type") or "")
    enemy = str(ev.get("enemy_id") or "")
    now = datetime.now(timezone.utc)
    # basic anti-replay pacing: battles cannot resolve more than once per 4s
    last = t.get("last_event_at")
    if etype in ("battle_win", "battle_befriend") and last:
        try:
            if (now - datetime.fromisoformat(last)).total_seconds() < 4:
                raise ValueError("Too fast — battle events are rate limited")
        except ValueError:
            raise
        except Exception:  # noqa: BLE001
            pass
    sets, rewards = {}, t.get("rewards") or {}

    if etype in ("battle_win", "battle_befriend", "battle_loss"):
        if enemy not in DRAGONS:
            raise ValueError("Unknown dragon")
        if enemy not in t["discovered"]:
            t["discovered"].append(enemy)
        if etype == "battle_befriend" and enemy not in t["befriended"]:
            t["befriended"].append(enemy)
        if etype == "battle_win" and enemy not in t["first_defeats"]:
            t["first_defeats"].append(enemy)
            rid = f"dragon_first_{enemy}"
            amt = int(cfg["rewards"].get("dragon_first_defeat") or 0)
            if amt > 0 and rid not in rewards:
                rewards[rid] = _pending_reward(amt, REWARD_DEFS[rid][1])
    elif etype == "boss_win":
        if len(t["discovered"]) < 3 or len(t["befriended"]) < 1:
            raise ValueError("Boss gate is still locked — complete the Elder's objectives first")
        if not t["boss_defeated"]:
            t["boss_defeated"] = True
            amt = int(cfg["rewards"].get("boss_thornbeast") or 0)
            if amt > 0 and "boss_thornbeast" not in rewards:
                rewards["boss_thornbeast"] = _pending_reward(amt, REWARD_DEFS["boss_thornbeast"][1])
    else:
        raise ValueError("Unknown event type")

    # quest completion check (server-side)
    if (not t["quest_complete"] and len(t["discovered"]) >= 3
            and len(t["befriended"]) >= 1 and t["boss_defeated"]):
        t["quest_complete"] = True
        amt = int(cfg["rewards"].get("quest_complete") or 0)
        if amt > 0 and "quest_q_first_flame" not in rewards:
            rewards["quest_q_first_flame"] = _pending_reward(amt, REWARD_DEFS["quest_q_first_flame"][1])

    t["rewards"] = rewards
    t["last_event_at"] = now.isoformat()
    t["events"] = int(t.get("events") or 0) + 1
    await db.dragon_realm_saves.update_one(
        {"user_id": user["id"], "game": GAME_ID},
        {"$set": {"trusted": t, "updated_at": _iso(), **sets}})
    return t


async def claim_reward(user: dict, reward_id: str) -> dict:
    """Atomic, idempotent, replay-proof claim via the real Fire Vault ledger."""
    if reward_id not in REWARD_DEFS:
        raise ValueError("Unknown reward")
    doc = await db.dragon_realm_saves.find_one_and_update(
        {"user_id": user["id"], "game": GAME_ID,
         f"trusted.rewards.{reward_id}.status": "unclaimed"},
        {"$set": {f"trusted.rewards.{reward_id}.status": "claiming",
                  "updated_at": _iso()}})
    if not doc:
        cur = await db.dragon_realm_saves.find_one(
            {"user_id": user["id"], "game": GAME_ID}, {"_id": 0, "trusted.rewards": 1})
        st = ((cur or {}).get("trusted", {}).get("rewards", {}).get(reward_id) or {}).get("status")
        raise ValueError("Already claimed" if st in ("claimed", "claiming") else "Reward not available")
    reward = doc["trusted"]["rewards"][reward_id]
    amount, reason = int(reward["amount"]), reward["reason"]
    idem = f"dr:{user['id']}:{reward_id}:e{int(doc.get('epoch') or 0)}"
    from services.fire_vault import credit_fire, settle_due, collect_fire
    try:
        txn = await credit_fire(user["id"], "dragon_realm", GAME_ID, idem, amount,
                                idempotency_key=idem, finalize_at=_iso())
        await settle_due(user["id"])
        if txn:
            await collect_fire(user, [txn["id"]])  # straight into the Fire Power Vault
        await db.dragon_realm_saves.update_one(
            {"user_id": user["id"], "game": GAME_ID},
            {"$set": {f"trusted.rewards.{reward_id}.status": "claimed",
                      f"trusted.rewards.{reward_id}.claimed_at": _iso(),
                      f"trusted.rewards.{reward_id}.txn_id": (txn or {}).get("id"),
                      "updated_at": _iso()}})
    except Exception:
        await db.dragon_realm_saves.update_one(  # roll back so the reward is not lost
            {"user_id": user["id"], "game": GAME_ID,
             f"trusted.rewards.{reward_id}.status": "claiming"},
            {"$set": {f"trusted.rewards.{reward_id}.status": "unclaimed"}})
        raise
    from services import game_studio as gs
    await gs.audit({"id": user["id"], "username": user.get("username")},
                   "dragon_realm_reward_claimed", GAME_ID,
                   detail=f"{reward_id} reason={reason}", cost=0)
    return {"reward_id": reward_id, "amount": amount, "reason": reason,
            "txn_id": (txn or {}).get("id"), "idempotency_key": idem}


async def save_state(user: dict, payload: dict) -> dict:
    """Versioned client save. Never erases the last valid save on failure."""
    if not isinstance(payload, dict) or len(str(payload)) > 60000:
        raise ValueError("Invalid save payload")
    doc = await get_save(user["id"])
    version = int(doc.get("save_version") or 0) + 1
    await db.dragon_realm_saves.update_one(
        {"user_id": user["id"], "game": GAME_ID},
        {"$set": {"save": payload, "save_version": version,
                  "prev_save": doc.get("save"), "updated_at": _iso()}})
    return {"save_version": version}


async def wallet_summary(user: dict) -> dict:
    from services.fire_vault import wallet_for
    w = await wallet_for(user)
    return {"vault": int(w.get("vault_balance") or 0),
            "collectable": int(w.get("collectable_balance") or 0),
            "pending": int(w.get("pending_balance") or 0)}
