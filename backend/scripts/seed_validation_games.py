"""Insert the three founder-only runtime-validation games (no LLM cost). Idempotent."""
import asyncio, os, sys, uuid
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from core.db import db  # noqa: E402
from services.game_studio import TEMPLATE_IDS, WIN_LOSS, RUNTIME_LABELS, RUNTIME_MECHANICS, plan_identity, validate_spec  # noqa: E402


def iso():
    return datetime.now(timezone.utc).isoformat()


def mk(rt, title, desc, request, spec_stages, extra_spec=None):
    spec = {"runtime": rt, "title": title, "description": desc,
            "player_representation": {"card_battle": "card_commander", "tower_defense": "tower_commander"}.get(rt, "puzzle_cursor"),
            "theme": {"bg": "#0b1220", "accent": "#2EE6FF", "text": "#EAF2FF"},
            "visual_theme": {"palette": {"bg": {"card_battle": "#140a1e", "tower_defense": "#0a1a12", "match3": "#1a0a14"}[rt],
                                          "glow": {"card_battle": "#B14BF4", "tower_defense": "#10E670", "match3": "#FF5A8A"}[rt],
                                          "accent": "#F4A73B", "hazard": "#FF3D5A"}},
            "scoring": {"points_per_correct": 10, "pass_pct": 60}, "lives": 1, "combo": False,
            "stages": spec_stages, **(extra_spec or {})}
    ident = plan_identity(rt, "", spec["player_representation"])
    win, loss = WIN_LOSS[rt]
    plan = {"title": title, "concept": desc, "runtime": rt, "runtime_label": RUNTIME_LABELS[rt],
            "template_id": TEMPLATE_IDS[rt], "win_condition": win, "loss_condition": loss,
            "mechanics": RUNTIME_MECHANICS[rt], "unsupported_mechanics": [], "substitutions": [],
            "fallback_used": False, "fallback_reason": None,
            "classification": {"detected_genre": RUNTIME_LABELS[rt], "confidence": 1.0, "method": "keyword_router",
                               "runtime_id": rt, "template_id": TEMPLATE_IDS[rt], "fallback_used": False, "fallback_reason": None},
            "identity": ident, "gameplay_summary": desc, "stages": len(spec_stages)}
    errs = validate_spec(spec, 1)
    return {"id": uuid.uuid4().hex, "title": title, "description": desc, "runtime": rt, "genre": RUNTIME_LABELS[rt],
            "request": request, "spec": spec, "plan": plan, "status": "approved", "showcase": False,
            "labels": ["founder_validation", "phase_b"], "complexity": 1, "ai_power": 1,
            "est_cost": 0.0, "actual_cost": 0.0, "estimate_id": None, "cover_url": None,
            "options": {}, "course_context": None, "build_log": [{"at": iso(), "msg": "handcrafted validation build (no provider cost)"}],
            "test_results": {"passed": not errs, "errors": errs}, "stage": "done",
            "plays": 0, "saves": 0, "review": None, "fire_economy": {"enabled": False},
            "created_by": "system", "created_by_username": "orai-validation",
            "created_at": iso(), "updated_at": iso(), "controls": None}


CARD = mk("card_battle", "Realm Legends: Card Clash",
          "Turn-based card duel — spend mana on attacks, guards and tricks to defeat the Void Baron.",
          "founder validation: card battler",
          [{"title": "Duel with the Void Baron",
            "enemy": {"name": "Void Baron", "hp": 32, "attack_min": 3, "attack_max": 7, "intent_telegraph": True},
            "player_hp": 30, "energy_per_turn": 3, "hand_size": 4,
            "deck": [
                {"name": "Strike", "type": "attack", "cost": 1, "value": 5, "desc": "Deal 5 damage"},
                {"name": "Strike", "type": "attack", "cost": 1, "value": 5, "desc": "Deal 5 damage"},
                {"name": "Heavy Blow", "type": "attack", "cost": 2, "value": 9, "desc": "Deal 9 damage"},
                {"name": "Fireball", "type": "attack", "cost": 3, "value": 14, "desc": "Deal 14 damage"},
                {"name": "Guard", "type": "defense", "cost": 1, "value": 5, "desc": "Block 5 damage"},
                {"name": "Guard", "type": "defense", "cost": 1, "value": 5, "desc": "Block 5 damage"},
                {"name": "Iron Wall", "type": "defense", "cost": 2, "value": 9, "desc": "Block 9 damage"},
                {"name": "Focus", "type": "special", "cost": 1, "value": 2, "desc": "+2 mana next turn"},
                {"name": "Quick Draw", "type": "special", "cost": 2, "value": 1, "desc": "+1 mana next turn"},
                {"name": "Strike", "type": "attack", "cost": 1, "value": 5, "desc": "Deal 5 damage"}]}])

TD = mk("tower_defense", "Realm Defense",
        "Place arrow and cannon towers to stop the goblin raid before it reaches your keep.",
        "founder validation: tower defense",
        [{"title": "Goblin Raid — Meadow Pass", "base_hp": 10, "start_resources": 110,
          "towers": [{"name": "Arrow", "cost": 40, "damage": 3, "range": 95, "fire_ms": 550},
                     {"name": "Cannon", "cost": 70, "damage": 9, "range": 75, "fire_ms": 1300}],
          "waves": [{"enemies": [{"type": "grunt", "count": 6, "hp": 9, "speed": 38, "bounty": 9}]},
                    {"enemies": [{"type": "fast", "count": 5, "hp": 7, "speed": 68, "bounty": 10},
                                  {"type": "grunt", "count": 4, "hp": 12, "speed": 40, "bounty": 9}]},
                    {"enemies": [{"type": "tank", "count": 3, "hp": 34, "speed": 24, "bounty": 20},
                                  {"type": "fast", "count": 4, "hp": 8, "speed": 72, "bounty": 10}]}]}])

M3 = mk("match3", "Crystal Fusion",
        "Swap crystals to forge matches, chain cascades and hit the score goal before moves run out.",
        "founder validation: match 3 puzzle",
        [{"title": "Fusion Chamber I", "grid_w": 7, "grid_h": 8, "colors": 5, "moves": 22,
          "objective": {"type": "score", "target": 650}}])


async def main():
    for doc in (CARD, TD, M3):
        existing = await db.games.find_one({"title": doc["title"], "labels": "founder_validation"}, {"_id": 1, "id": 1})
        if existing:
            print(f"SKIP (exists): {doc['title']} id={existing.get('id')}")
            continue
        if not doc["test_results"]["passed"]:
            print(f"VALIDATION FAILED for {doc['title']}: {doc['test_results']['errors']}")
            continue
        await db.games.insert_one(dict(doc))
        print(f"INSERTED: {doc['title']} · runtime={doc['runtime']} · template={doc['plan']['template_id']} · id={doc['id']}")

asyncio.run(main())
