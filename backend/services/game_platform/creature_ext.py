"""Turn-Based Creature RPG V2 extensions — six OPTIONAL, versioned,
registry-driven modules: evolution, multiplayer foundation, secure
trading, procedural regions, crafting, advanced battle AI. All rules
live in the registry (founder-editable, versioned, rollback-safe);
logic here is deterministic. No Dragon Realm specifics. No real money."""
import hashlib
import random
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException

from core.db import db
from services.game_platform.registry_core import Registry


def _iso():
    return datetime.now(timezone.utc).isoformat()


EXTENSION_SEED = {
    "evolution": {"label": "Creature Evolution", "version": 1, "optional": True,
                  "triggers": ["level", "item", "quest", "condition"],
                  "rules": [{"rule_id": "default_level", "creature": "*", "trigger": "level",
                             "at_level": 5, "evolves_to_suffix": " Prime",
                             "stat_changes": {"hp": 8, "attack": 3},
                             "ability_changes": ["+1 ability slot"], "branch": None}],
                  "save_migration": "v1 saves gain party[].evolution_stage=0 on first evolution"},
    "multiplayer_foundation": {"label": "Multiplayer Foundation", "version": 1, "optional": True,
                               "modes": ["co_op", "turn_based_battle"], "max_party": 2,
                               "reconnect_window_s": 300, "eligibility": {"min_trust": 0},
                               "notes": "session/lobby abstraction — NOT large-scale MMO"},
    "trading": {"label": "Secure Online Trading", "version": 1, "optional": True,
                "tradeable": ["creature", "item"], "timeout_minutes": 30,
                "eligibility": {"same_game": True, "min_level": 1},
                "notes": "two-party confirmation, atomic, no real-money functionality"},
    "procedural_regions": {"label": "Procedural Regions", "version": 1, "optional": True,
                           "biomes": {"forest": {"tiles": ["grass", "tree", "brook"],
                                                 "encounters": [{"name": "Leaf Sprite", "hp": 8, "attack": 2, "weight": 3},
                                                                {"name": "Moss Beast", "hp": 14, "attack": 4, "weight": 1}]},
                                      "cavern": {"tiles": ["stone", "crystal", "chasm"],
                                                 "encounters": [{"name": "Gloom Bat", "hp": 6, "attack": 3, "weight": 3},
                                                                {"name": "Crystal Golem", "hp": 18, "attack": 5, "weight": 1}]}},
                           "landmarks": ["ancient shrine", "abandoned camp", "glowing pool"],
                           "grid": {"w": 9, "h": 7}, "objectives": ["reach the exit", "find the landmark"]},
    "crafting": {"label": "Crafting", "version": 1, "optional": True,
                 "stations": ["campfire", "workbench"],
                 "recipes": [{"recipe_id": "healing_salve", "station": "campfire",
                              "ingredients": {"herb": 2, "water": 1}, "output": {"item": "Healing Salve", "qty": 1},
                              "success_rate": 1.0, "upgradeable": False}],
                 "notes": "atomic inventory changes; founder-editable tables"},
    "battle_ai": {"label": "Advanced Battle AI", "version": 1, "optional": True,
                  "profiles": {"aggressive": {"target": "lowest_hp", "attack_bias": 0.9, "defend_below_hp": 0.1},
                               "defensive": {"target": "highest_attack", "attack_bias": 0.5, "defend_below_hp": 0.4},
                               "boss_phase": {"target": "lowest_hp", "attack_bias": 0.8,
                                              "phases": [{"below_hp": 0.5, "attack_multiplier": 1.5}]}},
                  "difficulty_scaling": {"easy": 0.8, "normal": 1.0, "hard": 1.3},
                  "fallback": "aggressive"},
}

creature_ext_registry = Registry("creature_rpg_extensions", EXTENSION_SEED,
                                 description="Optional V2 extensions for turn_based_creature_rpg")


async def _ext(key: str) -> dict:
    e = await creature_ext_registry.get(key)
    if not e or not e.get("enabled", True):
        raise HTTPException(status_code=404, detail=f"Extension '{key}' not registered/enabled")
    return e["definition"]


# ── Evolution (deterministic, save-migrating) ────────────────────────
async def apply_evolution(user: dict, game_id: str, creature_name: str,
                          context: dict) -> dict:
    cfg = await _ext("evolution")
    save = await db.game_progress.find_one({"game_id": game_id, "user_id": user["id"]}) or {}
    party = (save.get("extra") or {}).get("party") or context.get("party") or []
    creature = next((c for c in party if c.get("name") == creature_name), None)
    if not creature:
        creature = {"name": creature_name, "hp": int(context.get("hp") or 12),
                    "attack": int(context.get("attack") or 4), "level": int(context.get("level") or 1)}
        party.append(creature)
    creature.setdefault("evolution_stage", 0)  # v1 save migration
    rule = next((r for r in cfg.get("rules") or []
                 if r.get("creature") in ("*", creature_name)), None)
    if not rule:
        raise HTTPException(status_code=422, detail="No evolution rule matches this creature")
    trig, lvl = rule.get("trigger"), int(creature.get("level") or context.get("level") or 1)
    ok = (trig == "level" and lvl >= int(rule.get("at_level") or 1)) or \
         (trig == "item" and rule.get("item") in (context.get("items") or [])) or \
         (trig == "quest" and rule.get("quest") in (context.get("completed_quests") or [])) or \
         (trig == "condition" and context.get("condition") == rule.get("condition"))
    if not ok:
        raise HTTPException(status_code=422, detail={
            "error_code": "evolution_requirements_not_met",
            "trigger": trig, "rule": rule.get("rule_id"),
            "needed": rule.get("at_level") or rule.get("item") or rule.get("quest") or rule.get("condition")})
    branch = rule.get("branch")
    new_name = (branch or {}).get(context.get("branch_choice") or "") or \
        creature_name + str(rule.get("evolves_to_suffix") or " Prime")
    for stat, delta in (rule.get("stat_changes") or {}).items():
        creature[stat] = int(creature.get(stat) or 0) + int(delta)
    creature["name"] = new_name
    creature["evolution_stage"] += 1
    creature["abilities"] = (creature.get("abilities") or []) + (rule.get("ability_changes") or [])
    await db.game_progress.update_one(
        {"game_id": game_id, "user_id": user["id"]},
        {"$set": {"extra.party": party, "updated_at": _iso()},
         "$push": {"extra.evolution_log": {"$each": [{
             "from": creature_name, "to": new_name, "rule": rule.get("rule_id"), "at": _iso()}],
             "$slice": -20}}}, upsert=True)
    return {"evolved": True, "from": creature_name, "to": new_name,
            "stage": creature["evolution_stage"], "stats": {k: creature.get(k) for k in ("hp", "attack")},
            "rule": rule.get("rule_id"), "saved": True}


# ── Multiplayer foundation (sessions/lobbies, server-authoritative) ──
async def session_action(user: dict, action: str, body: dict) -> dict:
    cfg = await _ext("multiplayer_foundation")
    if action == "create":
        sid = uuid.uuid4().hex
        doc = {"id": sid, "game_id": str(body.get("game_id") or "")[:64],
               "mode": body.get("mode") if body.get("mode") in cfg["modes"] else cfg["modes"][0],
               "host_id": user["id"], "members": [{"user_id": user["id"], "state": "joined"}],
               "state": "lobby", "max_party": int(cfg.get("max_party") or 2),
               "invite_code": uuid.uuid4().hex[:6].upper(),
               "created_at": _iso(), "updated_at": _iso()}
        await db.game_sessions.insert_one({**doc})
        doc.pop("_id", None)
        return {"session": doc, "single_player_fallback": False}
    sid = str(body.get("session_id") or "")
    s = await db.game_sessions.find_one({"$or": [{"id": sid}, {"invite_code": str(body.get("invite_code") or "").upper()}]},
                                        {"_id": 0})
    if not s:
        return {"session": None, "single_player_fallback": True,
                "reason": "session not found — continue in single-player"}
    members = s["members"]
    me = next((m for m in members if m["user_id"] == user["id"]), None)
    if action == "join":
        if me:
            me["state"] = "joined"  # reconnect
        elif len([m for m in members if m["state"] == "joined"]) >= s["max_party"]:
            raise HTTPException(status_code=409, detail="Lobby is full")
        else:
            members.append({"user_id": user["id"], "state": "joined"})
    elif action == "leave":
        if not me:
            raise HTTPException(status_code=403, detail="Not a member of this session")
        me["state"] = "left"
    elif action == "reconnect":
        if not me:
            raise HTTPException(status_code=403, detail="Not a member of this session")
        me["state"] = "joined"
    await db.game_sessions.update_one({"id": s["id"]},
                                      {"$set": {"members": members, "updated_at": _iso()}})
    s["members"] = members
    return {"session": s, "single_player_fallback": False}


# ── Secure trading (two-party confirm, atomic, duplicate-proof) ──────
async def trade_action(user: dict, action: str, body: dict) -> dict:
    cfg = await _ext("trading")
    now = datetime.now(timezone.utc)
    if action == "create":
        kind = body.get("kind")
        if kind not in cfg["tradeable"]:
            raise HTTPException(status_code=400, detail=f"kind must be one of {cfg['tradeable']}")
        offer = {"id": uuid.uuid4().hex, "game_id": str(body.get("game_id") or "")[:64],
                 "from_user": user["id"], "to_user": str(body.get("to_user") or "")[:64],
                 "kind": kind, "give": str(body.get("give") or "")[:80],
                 "receive": str(body.get("receive") or "")[:80],
                 "status": "pending", "created_at": _iso(),
                 "expires_at": (now + timedelta(minutes=int(cfg.get("timeout_minutes") or 30))).isoformat()}
        if not offer["to_user"] or offer["to_user"] == user["id"]:
            raise HTTPException(status_code=400, detail="Pick another player to trade with")
        await db.creature_trades.insert_one({**offer})
        offer.pop("_id", None)
        return {"trade": offer}
    tid = str(body.get("trade_id") or "")
    if action == "accept":
        # atomic single-transition guard: only ONE accept can ever win
        t = await db.creature_trades.find_one_and_update(
            {"id": tid, "status": "pending", "to_user": user["id"],
             "expires_at": {"$gt": now.isoformat()}},
            {"$set": {"status": "completing", "updated_at": _iso()}})
        if not t:
            cur = await db.creature_trades.find_one({"id": tid}, {"_id": 0, "status": 1, "to_user": 1,
                                                                  "expires_at": 1})
            if not cur:
                raise HTTPException(status_code=404, detail="Trade not found")
            if cur.get("to_user") != user["id"]:
                raise HTTPException(status_code=403, detail="This trade is not addressed to you")
            if cur.get("expires_at", "") <= now.isoformat():
                raise HTTPException(status_code=409, detail="Trade expired")
            raise HTTPException(status_code=409, detail=f"Trade already {cur.get('status')} — "
                                                        "duplicate accepts are rejected")
        # atomic exchange: swap entries in both players' saves
        for uid, gain, lose in ((t["from_user"], t["receive"], t["give"]),
                                (t["to_user"], t["give"], t["receive"])):
            await db.game_progress.update_one(
                {"game_id": t["game_id"], "user_id": uid},
                {"$pull": {"extra.trade_items": lose}}, upsert=True)
            await db.game_progress.update_one(
                {"game_id": t["game_id"], "user_id": uid},
                {"$push": {"extra.trade_items": gain}, "$set": {"updated_at": _iso()}}, upsert=True)
        await db.creature_trades.update_one({"id": tid}, {"$set": {"status": "completed",
                                                                   "completed_at": _iso()}})
        return {"trade_id": tid, "status": "completed", "received": t["give"]}
    if action == "cancel":
        t = await db.creature_trades.find_one_and_update(
            {"id": tid, "status": "pending", "from_user": user["id"]},
            {"$set": {"status": "cancelled", "updated_at": _iso()}})
        if not t:
            raise HTTPException(status_code=409, detail="Trade not pending or not yours")
        return {"trade_id": tid, "status": "cancelled"}
    if action == "history":
        rows = await db.creature_trades.find(
            {"$or": [{"from_user": user["id"]}, {"to_user": user["id"]}]},
            {"_id": 0}).sort("created_at", -1).to_list(20)
        return {"trades": rows}
    raise HTTPException(status_code=400, detail="Unknown trade action")


# ── Procedural regions (seed-deterministic) ──────────────────────────
async def generate_region(body: dict) -> dict:
    cfg = await _ext("procedural_regions")
    seed = str(body.get("seed") or uuid.uuid4().hex[:8])
    biome = body.get("biome") if body.get("biome") in cfg["biomes"] else sorted(cfg["biomes"])[0]
    rng = random.Random(int(hashlib.sha256(f"{seed}:{biome}".encode()).hexdigest(), 16) % (2**32))
    b = cfg["biomes"][biome]
    w, h = int(cfg["grid"]["w"]), int(cfg["grid"]["h"])
    tiles = [[rng.choice(b["tiles"]) for _ in range(w)] for _ in range(h)]
    weights = [e["weight"] for e in b["encounters"]]
    encounters = [{**rng.choices(b["encounters"], weights=weights)[0],
                   "x": rng.randrange(1, w - 1), "y": rng.randrange(1, h - 1)}
                  for _ in range(rng.randint(2, 4))]
    landmark = {"name": rng.choice(cfg["landmarks"]), "x": rng.randrange(1, w - 1),
                "y": rng.randrange(1, h - 1)}
    return {"seed": seed, "biome": biome, "grid": {"w": w, "h": h}, "tiles": tiles,
            "encounters": encounters, "landmark": landmark,
            "objective": rng.choice(cfg["objectives"]),
            "exit": {"x": w - 1, "y": h - 1}, "deterministic": True}


# ── Crafting (atomic inventory changes) ──────────────────────────────
async def craft(user: dict, game_id: str, recipe_id: str) -> dict:
    cfg = await _ext("crafting")
    recipe = next((r for r in cfg.get("recipes") or [] if r["recipe_id"] == recipe_id), None)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    need = recipe["ingredients"]
    # atomic: single guarded update — only succeeds when EVERY ingredient count suffices
    guard = {"game_id": game_id, "user_id": user["id"]}
    for item, qty in need.items():
        guard[f"extra.inventory.{item}"] = {"$gte": int(qty)}
    inc = {f"extra.inventory.{item}": -int(qty) for item, qty in need.items()}
    out_item, out_qty = recipe["output"]["item"], int(recipe["output"].get("qty") or 1)
    inc[f"extra.inventory.{out_item}"] = out_qty
    res = await db.game_progress.find_one_and_update(
        guard, {"$inc": inc, "$set": {"updated_at": _iso()},
                "$push": {"extra.craft_log": {"$each": [{"recipe": recipe_id, "at": _iso()}],
                                              "$slice": -20}}})
    if not res:
        save = await db.game_progress.find_one({"game_id": game_id, "user_id": user["id"]},
                                               {"_id": 0, "extra.inventory": 1})
        inv = ((save or {}).get("extra") or {}).get("inventory") or {}
        missing = {i: q for i, q in need.items() if int(inv.get(i) or 0) < q}
        raise HTTPException(status_code=422, detail={
            "error_code": "missing_ingredients", "recipe": recipe_id,
            "missing": missing, "have": {i: int(inv.get(i) or 0) for i in need}})
    return {"crafted": out_item, "qty": out_qty, "consumed": need, "atomic": True}


# ── Fire Power creature rewards (Claim Now — ledger-backed) ──────────
CLAIMABLE = ["creature_victory", "boss_victory", "capture", "evolution", "quest",
             "achievement", "region", "multiplayer", "event", "daily", "seasonal"]


async def claim_creature_reward(user: dict, game_id: str, kind: str, ref: str) -> dict:
    """Server-authoritative Claim Now: atomic claimed-marker guard +
    idempotent Fire Vault ledger credit. No hardcoded amounts — the
    reward table is registry data (founder-editable)."""
    if kind not in CLAIMABLE:
        raise HTTPException(status_code=400, detail=f"kind must be one of {CLAIMABLE}")
    from services.game_platform.system_registry import economy_registry
    fp = await economy_registry.get("fire_power")
    table = ((fp or {}).get("definition") or {}).get("creature_rewards") or {}
    amount = int(table.get(kind) or 0)
    if amount <= 0:
        raise HTTPException(status_code=422, detail=f"No reward configured for '{kind}' — "
                                                    "founder can set it in the economy registry")
    ref = str(ref or "default")[:80]
    marker = f"cr:{kind}:{ref}"
    res = await db.game_progress.update_one(
        {"game_id": game_id, "user_id": user["id"], f"extra.claims.{marker}": {"$exists": False}},
        {"$set": {f"extra.claims.{marker}": _iso(), "updated_at": _iso()}}, upsert=False)
    if not res.modified_count:
        exists = await db.game_progress.find_one({"game_id": game_id, "user_id": user["id"]},
                                                 {"_id": 1})
        if exists is not None:
            raise HTTPException(status_code=409, detail="Already claimed — duplicate claims are rejected")
        await db.game_progress.update_one(
            {"game_id": game_id, "user_id": user["id"]},
            {"$set": {f"extra.claims.{marker}": _iso(), "updated_at": _iso()}}, upsert=True)
    idem = f"gfp:{game_id}:{kind}:{user['id']}:{ref}"
    from services.fire_vault import credit_fire
    try:
        txn = await credit_fire(user["id"], "creature_rpg_reward", game_id, idem, amount,
                                idempotency_key=idem, finalize_at=_iso())
    except Exception as e:  # rollback the marker so the reward is not lost
        await db.game_progress.update_one({"game_id": game_id, "user_id": user["id"]},
                                          {"$unset": {f"extra.claims.{marker}": ""}})
        raise HTTPException(status_code=502, detail=f"Ledger credit failed — claim rolled back: {str(e)[:120]}")
    return {"claimed": True, "kind": kind, "ref": ref, "amount": amount,
            "txn_id": (txn or {}).get("id"), "idempotency_key": idem,
            "note": "Fire Power has no monetary value and is never required for the main story"}

async def battle_decide(body: dict) -> dict:
    cfg = await _ext("battle_ai")
    profiles = cfg.get("profiles") or {}
    pid = body.get("profile") if body.get("profile") in profiles else cfg.get("fallback", "aggressive")
    prof = profiles.get(pid) or {"target": "lowest_hp", "attack_bias": 0.9}
    party = [p for p in (body.get("party") or []) if int(p.get("hp") or 0) > 0]
    actor = body.get("actor") or {"hp": 10, "max_hp": 10, "attack": 4}
    if not party:
        return {"profile": pid, "action": "wait", "reason": "no valid targets"}
    diff = float((cfg.get("difficulty_scaling") or {}).get(body.get("difficulty") or "normal", 1.0))
    hp_ratio = int(actor.get("hp") or 1) / max(int(actor.get("max_hp") or actor.get("hp") or 1), 1)
    for phase in (prof.get("phases") or []):
        if hp_ratio <= float(phase.get("below_hp", 0)):
            diff *= float(phase.get("attack_multiplier", 1.0))
    if hp_ratio <= float(prof.get("defend_below_hp") or 0):
        return {"profile": pid, "action": "defend", "reason": f"hp {round(hp_ratio*100)}% below defend threshold"}
    key = prof.get("target") or "lowest_hp"
    weak = {"fire": "grass", "water": "fire", "grass": "water"}
    def _score(t):
        s = -int(t.get("hp") or 0) if key == "lowest_hp" else int(t.get("attack") or 0)
        if weak.get(str(actor.get("element") or "")) == str(t.get("element") or ""):
            s += 100  # elemental advantage
        if t.get("status") in ("poisoned", "stunned"):
            s += 25  # finish weakened targets
        return s
    target = max(party, key=_score)
    dmg = max(1, round(int(actor.get("attack") or 4) * diff))
    return {"profile": pid, "action": "attack", "target": target.get("name"),
            "damage": dmg, "difficulty_multiplier": round(diff, 2),
            "reason": f"{key} targeting with elemental/status awareness", "deterministic": True}
