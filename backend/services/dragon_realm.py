"""Dragon Realm: The Fire Quest — server-authoritative content, progress,
and Fire Power claims for the turn_based_creature_rpg runtime family.

Runtime family : turn_based_creature_rpg
Runtime ID     : runtime_dragon_realm_rpg_v1
Template ID    : tpl_dragon_realm_fire_quest_v1
Renderer       : renderer_pixel_creature_rpg_v1 (React, not the sandboxed iframe)
"""
from datetime import datetime, timezone

from core.db import db

GAME_ID = "dragon_realm_fire_quest"
RUNTIME_ID = "runtime_dragon_realm_rpg_v1"
TEMPLATE_ID = "tpl_dragon_realm_fire_quest_v1"
RENDERER_ID = "renderer_pixel_creature_rpg_v1"
ACCESS_MODES = ("founder_only", "custom", "beta", "live", "maintenance")


def _iso():
    return datetime.now(timezone.utc).isoformat()


DEFAULT_CONFIG = {
    "id": "config", "enabled": True, "access_mode": "founder_only",
    "eligible_user_ids": [], "eligible_usernames": [],
    "maintenance_message": "Dragon Realm is resting. Check back soon!",
    "game_version": "0.2.0-full-world",
    "rewards": {"quest_complete": 25, "dragon_first_defeat": 10,
                "boss_thornbeast": 100, "boss_gemnasher": 100, "boss_duneblaze": 100,
                "boss_frostwyrm": 100, "boss_skytitan": 100, "boss_dragon_king": 250},
    "updated_at": None, "updated_by": None,
}


def _d(id_, name, element, rarity, lv, lore):
    return {"id": id_, "name": name, "element": element, "rarity": rarity, "level": lv,
            "hp": int(24 + lv * 1.7), "attack": int(5 + lv * 0.45), "defense": int(4 + lv * 0.35),
            "magic": int(4 + lv * 0.45), "speed": int(5 + lv * 0.25), "lore": lore}


REGION_ORDER = ["enchanted_forest", "crystal_caverns", "sandsear_desert",
                "frozen_peaks", "storm_isles", "dragonfall_castle"]

REGIONS = {
    "enchanted_forest": {
        "name": "Enchanted Forest", "boss_id": "thornbeast",
        "dragons": [
            _d("emberling", "Emberling", "fire", "common", 12, "A hatchling that sneezes sparks when startled."),
            _d("mossback", "Mossback", "nature", "common", 13, "Sleeps so long that moss gardens grow on its shell."),
            _d("vinewing", "Vinewing", "nature", "uncommon", 14, "Glides between ancient trees on leaf-woven wings."),
            _d("leafscale", "Leafscale", "nature", "common", 12, "Its scales change color with the seasons."),
            _d("barkhorn", "Barkhorn", "earth", "uncommon", 15, "Charges through ruins like a living battering ram."),
            _d("glowtail", "Glowtail", "light", "rare", 16, "Its tail-light guides lost travelers out of the deep woods.")]},
    "crystal_caverns": {
        "name": "Crystal Caverns", "boss_id": "gemnasher",
        "dragons": [
            _d("gemscale", "Gemscale", "crystal", "common", 17, "Its hide refracts torchlight into rainbows."),
            _d("shardwing", "Shardwing", "crystal", "common", 18, "Sheds razor feathers of living quartz."),
            _d("prismtail", "Prismtail", "light", "uncommon", 18, "Splits any beam of light into dazzling ribbons."),
            _d("quartzclaw", "Quartzclaw", "earth", "common", 19, "Tunnels through granite as if it were sand."),
            _d("amethyst_wyrm", "Amethyst Wyrm", "crystal", "rare", 20, "Coils around geodes and dreams in violet."),
            _d("crystal_drake", "Crystal Drake", "crystal", "uncommon", 20, "Its roar rings like a struck chime.")]},
    "sandsear_desert": {
        "name": "Sandsear Desert", "boss_id": "duneblaze",
        "dragons": [
            _d("cinderjaw", "Cinderjaw", "fire", "common", 22, "Chews embers the way others chew bones."),
            _d("duneclaw", "Duneclaw", "earth", "common", 22, "Swims beneath the dunes, only its fins showing."),
            _d("ashwing", "Ashwing", "fire", "uncommon", 23, "Leaves a trail of grey snow wherever it flies."),
            _d("sunshell", "Sunshell", "light", "uncommon", 24, "Basks atop ruins, storing noonlight in its shell."),
            _d("scorchtail", "Scorchtail", "fire", "common", 24, "Its tail-tip burns hot enough to glass sand."),
            _d("emberhorn", "Emberhorn", "fire", "rare", 25, "Old desert songs say its horns light the temples.")]},
    "frozen_peaks": {
        "name": "Frozen Peaks", "boss_id": "frostwyrm",
        "dragons": [
            _d("snowfin", "Snowfin", "ice", "common", 27, "Surfs avalanches for fun."),
            _d("icehorn", "Icehorn", "ice", "common", 27, "Its horn never melts, even in dragonfire."),
            _d("glacierwing", "Glacierwing", "ice", "uncommon", 28, "Wings of clear ice, invisible against the sky."),
            _d("frostscale", "Frostscale", "ice", "common", 29, "Frost blooms wherever it rests."),
            _d("winterclaw", "Winterclaw", "ice", "uncommon", 29, "Carves ice caves with a single swipe."),
            _d("frost_drake", "Crystal Frost Drake", "crystal", "rare", 30, "Half crystal, half blizzard, wholly proud.")]},
    "storm_isles": {
        "name": "Storm Isles", "boss_id": "skytitan",
        "dragons": [
            _d("thunderclaw", "Thunderclaw", "lightning", "common", 32, "Static crackles between its talons."),
            _d("cloudwing", "Cloudwing", "air", "common", 32, "Naps inside thunderheads."),
            _d("voltfin", "Voltfin", "lightning", "uncommon", 33, "Charges itself by diving through storms."),
            _d("tempest_drake", "Tempest Drake", "air", "uncommon", 34, "Its wingbeats birth small cyclones."),
            _d("stormtail", "Stormtail", "lightning", "common", 34, "Whips lightning like a lasso."),
            _d("skyfang", "Skyfang", "air", "rare", 35, "Guardian of the ancient sky temples.")]},
    "dragonfall_castle": {
        "name": "Dragonfall Castle", "boss_id": "dragon_king",
        "dragons": [
            _d("ash_tyrant", "Ash Tyrant", "fire", "uncommon", 41, "Commands the cinder legions of the outer walls."),
            _d("darkscale", "Darkscale", "shadow", "uncommon", 42, "Slips between torchlight and doubt."),
            _d("magmawing", "Magmawing", "fire", "uncommon", 43, "Its wake sets the black stone weeping lava."),
            _d("voidclaw", "Voidclaw", "shadow", "rare", 44, "Tears little holes in the evening sky."),
            _d("infernal_wyrm", "Infernal Wyrm", "fire", "rare", 44, "Coiled around the throne road for a century."),
            _d("castle_guardian", "Castle Guardian", "earth", "rare", 45, "The last oath-bound sentinel of the old kings.")]},
}

BOSSES = {
    "thornbeast": {"id": "thornbeast", "name": "THORNBEAST", "element": "nature", "level": 20,
                   "hp": 150, "attack": 12, "defense": 9, "magic": 9, "speed": 6, "region": "enchanted_forest",
                   "attacks": ["Poison Spikes", "Vine Whip", "Root Prison", "Forest Regeneration", "Thorn Shield"]},
    "gemnasher": {"id": "gemnasher", "name": "GEMNASHER", "element": "crystal", "level": 25,
                  "hp": 190, "attack": 14, "defense": 12, "magic": 12, "speed": 7, "region": "crystal_caverns",
                  "attacks": ["Crystal Barrage", "Summon Crystals", "Reflect Magic", "Prism Beam", "Shattering Roar"]},
    "duneblaze": {"id": "duneblaze", "name": "DUNEBLAZE", "element": "fire", "level": 30,
                  "hp": 235, "attack": 17, "defense": 13, "magic": 15, "speed": 9, "region": "sandsear_desert",
                  "attacks": ["Fire Breath", "Sandstorm", "Lava Eruption", "Burning Ground", "Solar Charge"]},
    "frostwyrm": {"id": "frostwyrm", "name": "FROSTWYRM", "element": "ice", "level": 35,
                  "hp": 285, "attack": 19, "defense": 16, "magic": 18, "speed": 10, "region": "frozen_peaks",
                  "attacks": ["Ice Breath", "Blizzard", "Freeze Player", "Icicle Barrage", "Frozen Armor"]},
    "skytitan": {"id": "skytitan", "name": "SKYTITAN", "element": "lightning", "level": 40,
                 "hp": 340, "attack": 22, "defense": 17, "magic": 21, "speed": 13, "region": "storm_isles",
                 "attacks": ["Lightning Strike", "Thunder Roar", "Call Storm Clouds", "Chain Lightning", "Cyclone", "Skyfall"]},
    "dragon_king": {"id": "dragon_king", "name": "LEGENDARY DRAGON KING", "element": "shadow", "level": 50,
                    "hp": 300, "attack": 26, "defense": 19, "magic": 25, "speed": 14, "region": "dragonfall_castle",
                    "multi_phase": True,
                    "supports": [
                        {"id": "inferno_head", "name": "Inferno Head", "element": "fire", "level": 46,
                         "hp": 130, "attack": 20, "defense": 13, "magic": 20, "speed": 12},
                        {"id": "shadow_head", "name": "Shadow Head", "element": "shadow", "level": 46,
                         "hp": 120, "attack": 18, "defense": 12, "magic": 22, "speed": 13}],
                    "attacks": ["Multi-Head Attack", "Elemental Breath", "Summon Minions", "Royal Flame",
                                "Shadow Inferno", "Phase Transition", "Ultimate Cataclysm"]},
}

DRAGON_REGION = {d["id"]: rid for rid, r in REGIONS.items() for d in r["dragons"]}
ALL_DRAGONS = {d["id"]: d for r in REGIONS.values() for d in r["dragons"]}

QUESTS = {rid: {
    "id": f"q_{rid}", "title": {
        "enchanted_forest": "The First Flame", "crystal_caverns": "Shards of Truth",
        "sandsear_desert": "Embers in the Sand", "frozen_peaks": "The Frozen Oath",
        "storm_isles": "Eye of the Storm", "dragonfall_castle": "The Dragon Warden"}[rid],
    "region": rid,
    "objectives": [
        {"id": "discover3", "label": f"Discover 3 dragons of the {r['name']}", "target": 3},
        *([{"id": "befriend1", "label": "Befriend a dragon", "target": 1}] if rid == "enchanted_forest" else []),
        {"id": "boss", "label": f"Defeat {BOSSES[r['boss_id']]['name']}", "target": 1}],
} for rid, r in REGIONS.items()}

REWARD_DEFS = {  # reward_id -> (config key, ledger reason)
    **{f"dragon_first_{d}": ("dragon_first_defeat", "dragon_realm_dragon_claim") for d in ALL_DRAGONS},
    **{f"boss_{b}": (f"boss_{b}", "dragon_realm_final_boss_claim" if b == "dragon_king"
                     else "dragon_realm_boss_claim") for b in BOSSES},
    **{f"quest_{rid}": ("quest_complete", "dragon_realm_quest_claim") for rid in REGIONS},
}


def region_unlocked(t: dict, rid: str) -> bool:
    i = REGION_ORDER.index(rid)
    return i == 0 or t.get("bosses", {}).get(REGION_ORDER[i - 1], False)


def _region_progress(t: dict, rid: str) -> dict:
    ids = [d["id"] for d in REGIONS[rid]["dragons"]]
    return {"discovered": len([x for x in t.get("discovered", []) if x in ids]),
            "boss": bool(t.get("bosses", {}).get(rid)),
            "quest": bool(t.get("quests", {}).get(rid))}


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
    if mode == "live":
        return True
    if mode in ("custom", "beta"):
        return (user["id"] in (cfg.get("eligible_user_ids") or []) or
                (user.get("username") or "").lower() in [u.lower() for u in (cfg.get("eligible_usernames") or [])])
    return False  # founder_only / maintenance


def _migrate_trusted(t: dict) -> dict:
    if "bosses" not in t:  # v0.1 forest-slice save
        t["bosses"] = {"enchanted_forest": bool(t.pop("boss_defeated", False))}
        t["quests"] = {"enchanted_forest": bool(t.pop("quest_complete", False))}
    t.setdefault("bosses", {})
    t.setdefault("quests", {})
    return t


async def get_save(user_id: str) -> dict:
    doc = await db.dragon_realm_saves.find_one({"user_id": user_id, "game": GAME_ID}, {"_id": 0})
    if not doc:
        rst = await db.dragon_realm_resets.find_one({"user_id": user_id, "game": GAME_ID})
        doc = {"user_id": user_id, "game": GAME_ID, "save": None, "save_version": 0,
               "epoch": int((rst or {}).get("count") or 0),
               "trusted": {"discovered": [], "befriended": [], "first_defeats": [],
                           "bosses": {}, "quests": {},
                           "rewards": {}, "last_event_at": None, "events": 0},
               "created_at": _iso(), "updated_at": _iso()}
        await db.dragon_realm_saves.insert_one({**doc})
        doc.pop("_id", None)
    doc["trusted"] = _migrate_trusted(doc.get("trusted") or {})
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
    last = t.get("last_event_at")
    if etype in ("battle_win", "battle_befriend", "boss_win") and last:
        try:
            if (now - datetime.fromisoformat(last)).total_seconds() < 4:
                raise ValueError("Too fast — battle events are rate limited")
        except ValueError:
            raise
        except Exception:  # noqa: BLE001
            pass
    rewards = t.get("rewards") or {}

    if etype in ("battle_win", "battle_befriend", "battle_loss"):
        if enemy not in ALL_DRAGONS:
            raise ValueError("Unknown dragon")
        rid = DRAGON_REGION[enemy]
        if not region_unlocked(t, rid):
            raise ValueError(f"{REGIONS[rid]['name']} is still locked")
        if enemy not in t["discovered"]:
            t["discovered"].append(enemy)
        if etype == "battle_befriend" and enemy not in t["befriended"]:
            t["befriended"].append(enemy)
        if etype == "battle_win" and enemy not in t["first_defeats"]:
            t["first_defeats"].append(enemy)
            r_id = f"dragon_first_{enemy}"
            amt = int(cfg["rewards"].get("dragon_first_defeat") or 0)
            if amt > 0 and r_id not in rewards:
                rewards[r_id] = _pending_reward(amt, REWARD_DEFS[r_id][1])
    elif etype == "boss_win":
        rid = str(ev.get("region") or "enchanted_forest")
        if rid not in REGIONS:
            raise ValueError("Unknown region")
        if not region_unlocked(t, rid):
            raise ValueError(f"{REGIONS[rid]['name']} is still locked")
        prog = _region_progress(t, rid)
        need_befriend = rid == "enchanted_forest" and len(t["befriended"]) < 1
        if prog["discovered"] < 3 or need_befriend:
            raise ValueError("Boss gate is still locked — complete the region objectives first")
        if rid == "dragonfall_castle" and not all(t["bosses"].get(r) for r in REGION_ORDER[:-1]):
            raise ValueError("The Dragon King only appears once every region boss has fallen")
        boss_id = REGIONS[rid]["boss_id"]
        if not t["bosses"].get(rid):
            t["bosses"][rid] = True
            r_id = f"boss_{boss_id}"
            amt = int(cfg["rewards"].get(f"boss_{boss_id}") or 0)
            if amt > 0 and r_id not in rewards:
                rewards[r_id] = _pending_reward(amt, REWARD_DEFS[r_id][1])
    else:
        raise ValueError("Unknown event type")

    for rid2 in REGIONS:  # server-side quest completion sweep
        if t["quests"].get(rid2):
            continue
        prog = _region_progress(t, rid2)
        befriend_ok = rid2 != "enchanted_forest" or len(t["befriended"]) >= 1
        if prog["discovered"] >= 3 and prog["boss"] and befriend_ok:
            t["quests"][rid2] = True
            r_id = f"quest_{rid2}"
            amt = int(cfg["rewards"].get("quest_complete") or 0)
            if amt > 0 and r_id not in rewards:
                rewards[r_id] = _pending_reward(amt, REWARD_DEFS[r_id][1])

    t["rewards"] = rewards
    t["last_event_at"] = now.isoformat()
    t["events"] = int(t.get("events") or 0) + 1
    await db.dragon_realm_saves.update_one(
        {"user_id": user["id"], "game": GAME_ID},
        {"$set": {"trusted": t, "updated_at": _iso()}})
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
    except Exception:
        await db.dragon_realm_saves.update_one(  # roll back so the reward is not lost
            {"user_id": user["id"], "game": GAME_ID,
             f"trusted.rewards.{reward_id}.status": "claiming"},
            {"$set": {f"trusted.rewards.{reward_id}.status": "unclaimed"}})
        raise
    # Ledger credit succeeded (or was an idempotent replay) — stamp claimed FIRST.
    await db.dragon_realm_saves.update_one(
        {"user_id": user["id"], "game": GAME_ID},
        {"$set": {f"trusted.rewards.{reward_id}.status": "claimed",
                  f"trusted.rewards.{reward_id}.claimed_at": _iso(),
                  f"trusted.rewards.{reward_id}.txn_id": (txn or {}).get("id"),
                  "updated_at": _iso()}})
    try:  # move straight into the Fire Power Vault (recoverable via Fire page if it fails)
        await settle_due(user["id"])
        if txn:
            await collect_fire(user, [txn["id"]])
    except Exception:  # noqa: BLE001
        pass
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
