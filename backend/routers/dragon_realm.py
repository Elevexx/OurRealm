"""Dragon Realm: The Fire Quest — API routes (all founder/eligible gated)."""
from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import dragon_realm as dr
from services import game_studio as gs

router = APIRouter(prefix="/api/dragon-realm", tags=["dragon-realm"])


async def _gate(current: dict) -> dict:
    cfg = await dr.get_config()
    if not dr.user_allowed(cfg, current):
        raise HTTPException(status_code=403, detail="Dragon Realm is Founder Only right now.")
    return cfg


@router.get("/state")
async def state(current: CurrentUser):
    cfg = await _gate(current)
    doc = await dr.get_save(current["id"])
    return {"game_id": dr.GAME_ID, "runtime_id": dr.RUNTIME_ID,
            "template_id": dr.TEMPLATE_ID, "renderer_id": dr.RENDERER_ID,
            "version": cfg["game_version"],
            "save": doc.get("save"), "save_version": doc.get("save_version") or 0,
            "trusted": doc.get("trusted"),
            "content": {"regions": dr.REGIONS, "region_order": dr.REGION_ORDER,
                        "bosses": dr.BOSSES, "quests": dr.QUESTS},
            "rewards_config": cfg["rewards"],
            "fire": await dr.wallet_summary(current)}


@router.post("/save")
async def save(body: dict, current: CurrentUser):
    await _gate(current)
    try:
        return {"ok": True, **(await dr.save_state(current, body.get("save") or {}))}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/event")
async def event(body: dict, current: CurrentUser):
    await _gate(current)
    try:
        t = await dr.record_event(current, body or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "trusted": t}


@router.post("/claim")
async def claim(body: dict, current: CurrentUser):
    await _gate(current)
    try:
        res = await dr.claim_reward(current, str(body.get("reward_id") or ""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Claim failed safely — reward kept: {str(e)[:120]}")
    return {"ok": True, **res, "fire": await dr.wallet_summary(current)}


@router.post("/claim-all")
async def claim_all(current: CurrentUser):
    await _gate(current)
    doc = await dr.get_save(current["id"])
    results, errors = [], []
    for rid, r in (doc["trusted"].get("rewards") or {}).items():
        if r.get("status") == "unclaimed":
            try:
                results.append(await dr.claim_reward(current, rid))
            except Exception as e:  # noqa: BLE001
                errors.append({"reward_id": rid, "error": str(e)[:120]})
    return {"ok": True, "claimed": results, "errors": errors,
            "fire": await dr.wallet_summary(current)}


@router.get("/admin/config")
async def admin_config(current: CurrentUser):
    require_founder(current)
    return await dr.get_config()


@router.put("/admin/config")
async def admin_config_put(body: dict, current: CurrentUser):
    require_founder(current)
    reason = str(body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required for Dragon Realm config changes")
    cfg = await dr.get_config()
    allowed = {"enabled", "access_mode", "eligible_user_ids", "eligible_usernames",
               "maintenance_message", "rewards"}
    changes = {k: v for k, v in body.items() if k in allowed}
    if "rewards" in changes:
        changes["rewards"] = {k: max(0, int(v)) for k, v in (changes["rewards"] or {}).items()
                              if k in dr.DEFAULT_CONFIG["rewards"]}
        changes["rewards"] = {**cfg["rewards"], **changes["rewards"]}
    if changes.get("access_mode") not in (None, *dr.ACCESS_MODES):
        raise HTTPException(status_code=400, detail="Invalid access mode")
    await db.dragon_realm_config.update_one({"id": "config"}, {"$set": {
        **changes, "updated_at": dr._iso(), "updated_by": current["id"]}}, upsert=True)
    await gs.audit(current, "dragon_realm_config_changed", dr.GAME_ID,
                   detail=f"{sorted(changes.keys())} reason={reason[:120]}")
    return await dr.get_config()


@router.post("/admin/reset-progress")
async def admin_reset(body: dict, current: CurrentUser):
    require_founder(current)
    uid = str(body.get("user_id") or "")
    reason = str(body.get("reason") or "").strip()
    if not uid or not reason:
        raise HTTPException(status_code=400, detail="user_id and reason are required")
    r = await db.dragon_realm_saves.delete_one({"user_id": uid, "game": dr.GAME_ID})
    await db.dragon_realm_resets.update_one(
        {"user_id": uid, "game": dr.GAME_ID}, {"$inc": {"count": 1}}, upsert=True)
    await gs.audit(current, "dragon_realm_progress_reset", dr.GAME_ID,
                   detail=f"user={uid} reason={reason[:120]}")
    return {"ok": True, "deleted": r.deleted_count}
