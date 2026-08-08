"""Engagement Resources API — user balances + founder Resource Manager."""
from fastapi import APIRouter, HTTPException

from core.db import db
from core.deps import CurrentUser
from core.permissions import require_founder
from services import resources as rs

router = APIRouter(prefix="/api/resources", tags=["resources"])
admin = APIRouter(prefix="/api/admin/resources", tags=["resources-admin"])


def _iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


@router.get("/registry")
async def public_registry(current: CurrentUser):
    return {"resources": await rs.registry()}


@router.get("/me")
async def my_balances(current: CurrentUser):
    return {"balances": await rs.balances(current["id"]),
            "activity": await rs.recent_activity(current["id"])}


# ─── Founder Resource Manager ────────────────────────────────────────────

SAFE_EDIT_FIELDS = ("name", "description", "icon", "color", "enabled", "public",
                    "per_user_cap", "global_cap", "daily_limit", "cooldown_s")


@admin.get("")
async def admin_list(current: CurrentUser):
    require_founder(current)
    rows = await db.resource_registry.find({}, {"_id": 0}).sort("key", 1).to_list(200)
    return {"resources": rows}


@admin.post("")
async def admin_add(body: dict, current: CurrentUser):
    require_founder(current)
    key = str(body.get("key") or "").strip().lower().replace(" ", "_")[:30]
    name = str(body.get("name") or "").strip()[:60]
    if not key or not name:
        raise HTTPException(status_code=400, detail="key and name are required")
    if await db.resource_registry.find_one({"key": key}):
        raise HTTPException(status_code=409, detail="Resource key already exists")
    doc = {"key": key, "name": name, "description": str(body.get("description") or "")[:300],
           "icon": str(body.get("icon") or "✦")[:8], "color": str(body.get("color") or "#2EE6FF")[:16],
           "adapter": None, "enabled": bool(body.get("enabled", True)),
           "public": bool(body.get("public", False)), "archived": False, "frozen": False,
           "precision": "integer", "global_cap": body.get("global_cap"),
           "per_user_cap": body.get("per_user_cap"), "daily_limit": body.get("daily_limit"),
           "cooldown_s": int(body.get("cooldown_s") or 0),
           "allowed_sources": list(rs.SOURCE_TYPES), "version": 1,
           "created_at": _iso(), "updated_at": _iso(),
           "audit": [{"by": current["username"], "at": _iso(), "action": "created"}]}
    await db.resource_registry.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"resource": doc}


@admin.patch("/{key}")
async def admin_edit(key: str, body: dict, current: CurrentUser):
    require_founder(current)
    res = await db.resource_registry.find_one({"key": key}, {"_id": 0})
    if not res:
        raise HTTPException(status_code=404, detail="Resource not found")
    upd = {k: body[k] for k in SAFE_EDIT_FIELDS if k in body}
    if "archived" in body:
        upd["archived"] = bool(body["archived"])  # never hard-delete
    if "frozen" in body:
        upd["frozen"] = bool(body["frozen"])
    if not upd:
        raise HTTPException(status_code=400, detail="No editable fields provided")
    upd["updated_at"] = _iso()
    await db.resource_registry.update_one({"key": key}, {
        "$set": upd, "$inc": {"version": 1},
        "$push": {"audit": {"$each": [{"by": current["username"], "at": _iso(),
                                       "action": "edited", "fields": list(upd.keys())}],
                            "$slice": -50}}})
    return {"resource": await db.resource_registry.find_one({"key": key}, {"_id": 0})}


@admin.post("/{key}/adjust")
async def admin_adjust(key: str, body: dict, current: CurrentUser):
    require_founder(current)
    username = str(body.get("username") or "").strip()
    amount = int(body.get("amount") or 0)
    reason = str(body.get("reason") or "").strip()
    if not username or not amount or not reason:
        raise HTTPException(status_code=400, detail="username, amount and reason are required")
    u = await db.users.find_one({"username": username}, {"id": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        out = await rs.grant(u["id"], key, amount, source_type="admin_adjustment",
                             reason=reason, actor=current["username"],
                             idem_key=body.get("request_id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return out


@admin.post("/transactions/{tx_id}/reverse")
async def admin_reverse(tx_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    try:
        return await rs.reverse(tx_id, current["username"], str(body.get("reason") or ""))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@admin.get("/ledger")
async def admin_ledger(current: CurrentUser, username: str = "", resource: str = "",
                       game_id: str = "", limit: int = 50):
    require_founder(current)
    q = {}
    if username:
        u = await db.users.find_one({"username": username}, {"id": 1})
        q["user_id"] = u["id"] if u else "__none__"
    if resource:
        q["resource_key"] = resource
    if game_id:
        q["game_id"] = game_id
    rows = await db.resource_ledger.find(q, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 200))
    ids = {r["user_id"] for r in rows}
    names = {u["id"]: u["username"] async for u in
             db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "username": 1})}
    for r in rows:
        r["username"] = names.get(r["user_id"])
    return {"transactions": rows}


@admin.get("/balances/{username}")
async def admin_user_balances(username: str, current: CurrentUser):
    require_founder(current)
    u = await db.users.find_one({"username": username}, {"id": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {"balances": await rs.balances(u["id"])}
