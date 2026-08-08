"""ORAi Public Access & Rules — founder policy management + rules chat."""
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import orai_policies as op

router = APIRouter(prefix="/api/admin/orai-access", tags=["orai-access"])


def _iso():
    return datetime.now(timezone.utc).isoformat()


@router.get("/policies")
async def list_policies(current: CurrentUser):
    require_founder(current)
    rows = await db.orai_policies.find({}, {"_id": 0}).sort("capability", 1).to_list(100)
    return {"policies": rows, "access_levels": list(op.ACCESS_LEVELS)}


@router.patch("/policies/{capability}")
async def edit_policy(capability: str, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        return {"policy": await op.update_policy(capability, body, current["username"],
                                                 note=str(body.get("_note") or ""))}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/policies/{capability}/versions")
async def policy_versions(capability: str, current: CurrentUser):
    require_founder(current)
    rows = await db.orai_policy_versions.find({"capability": capability}, {"_id": 0}) \
        .sort("version", -1).to_list(50)
    return {"versions": rows}


@router.post("/policies/{capability}/rollback")
async def policy_rollback(capability: str, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        return {"policy": await op.rollback_policy(capability, int(body.get("version") or 0),
                                                   current["username"])}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/audit")
async def policy_audit(current: CurrentUser, limit: int = 50):
    require_founder(current)
    rows = await db.orai_policy_audit.find({}, {"_id": 0}).sort("at", -1).to_list(min(limit, 200))
    return {"audit": rows}


# ─── Founder rules chat: NL → structured proposal → explicit apply ────────

RULES_SYSTEM = """You convert a founder's natural-language rule request into a strict JSON policy proposal for OurRealm's ORAi access control. Output ONLY JSON:
{"changes": [{"capability": "<one of: %s>", "set": {<only these fields: enabled(bool), access(one of founder|beta|signed_in|public), min_power(1-10), max_power(1-10), default_power(1-10), daily_limit(int|null), monthly_limit(int|null), prompt_max(int), media_allowed(bool), auto_publish(bool), require_approval(bool), emergency_disabled(bool)>}}],
 "summary": "<one sentence describing the effect>",
 "unsupported": ["<any part of the request that maps to NO existing capability — never invent capabilities>"]}
Never include providers, secrets, code, or database commands.""" % ", ".join(op.CAPABILITIES)


@router.post("/rules-chat")
async def rules_chat(body: dict, current: CurrentUser):
    """Step 1-6: propose only. NEVER applies automatically."""
    require_founder(current)
    msg = str(body.get("message") or "").strip()[:800]
    if not msg:
        raise HTTPException(status_code=400, detail="Describe the rule you want")
    from services.llm_router import call_llm
    try:
        raw = await call_llm(RULES_SYSTEM, msg, power=4, json_mode=True)
        prop = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"ORAi could not parse the rule: {str(e)[:120]}")
    changes, diffs, errors = [], [], list(prop.get("unsupported") or [])
    for ch in (prop.get("changes") or [])[:10]:
        cap = ch.get("capability")
        if cap not in op.CAPABILITIES:
            errors.append(f"Unknown capability: {cap}")
            continue
        setf = {k: v for k, v in (ch.get("set") or {}).items() if k in op.EDITABLE}
        if setf.get("access") and setf["access"] not in op.ACCESS_LEVELS:
            errors.append(f"Invalid access level for {cap}")
            continue
        before = await op.get_policy(cap)
        diffs.append({"capability": cap, "label": op.CAPABILITIES[cap],
                      "before": {k: before.get(k) for k in setf},
                      "after": setf,
                      "audience": setf.get("access", before.get("access"))})
        changes.append({"capability": cap, "set": setf})
    if not changes:
        raise HTTPException(status_code=422, detail="No valid policy changes found. " +
                            ("; ".join(errors) if errors else "Try rephrasing."))
    doc = {"id": uuid.uuid4().hex, "message": msg, "summary": str(prop.get("summary") or "")[:300],
           "changes": changes, "diffs": diffs, "warnings": errors, "status": "proposed",
           "by": current["username"], "created_at": _iso()}
    await db.orai_policy_proposals.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"proposal": doc}


@router.post("/rules-chat/{proposal_id}/apply")
async def rules_apply(proposal_id: str, current: CurrentUser):
    """Step 7-12: explicit founder confirmation → new immutable versions + audit."""
    require_founder(current)
    prop = await db.orai_policy_proposals.find_one({"id": proposal_id, "status": "proposed"}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Proposal not found or already handled")
    applied = []
    for ch in prop["changes"]:
        p = await op.update_policy(ch["capability"], ch["set"], current["username"],
                                   note=f"rules-chat {proposal_id}")
        applied.append({"capability": ch["capability"], "version": p["version"]})
    await db.orai_policy_proposals.update_one({"id": proposal_id}, {"$set": {
        "status": "applied", "applied_at": _iso(), "applied_by": current["username"]}})
    return {"applied": applied}


@router.post("/rules-chat/{proposal_id}/cancel")
async def rules_cancel(proposal_id: str, current: CurrentUser):
    require_founder(current)
    await db.orai_policy_proposals.update_one({"id": proposal_id, "status": "proposed"},
                                              {"$set": {"status": "cancelled"}})
    return {"ok": True}
