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


@router.get("/exchange/options")
async def exchange_options(current: CurrentUser):
    from services import economy
    rule = await economy.active_exchange_rule()
    regs = await db.resource_registry.find(
        {"archived": {"$ne": True}, "enabled": True, "frozen": {"$ne": True},
         "$or": [{"exchange_source": True}, {"exchange_dest": True}]},
        {"_id": 0, "key": 1, "name": 1, "icon": 1, "color": 1, "fire_equiv": 1,
         "exchange_source": 1, "exchange_dest": 1}).to_list(50)
    return {"resources": regs, "pairs": (rule or {}).get("pairs") or [],
            "fee_pct": (rule or {}).get("fee_pct") or 0,
            "frozen": bool((rule or {}).get("frozen")),
            "disclaimer": "Engagement resources have no monetary value."}


@router.post("/exchange/quote")
async def exchange_make_quote(body: dict, current: CurrentUser):
    from services import economy
    try:
        q = await economy.exchange_quote(current, str(body.get("from") or ""),
                                         str(body.get("to") or ""), int(body.get("amount") or 0))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"quote": q}


@router.post("/exchange/execute")
async def exchange_run(body: dict, current: CurrentUser):
    from services import economy
    try:
        rec = await economy.exchange_execute(current, str(body.get("quote_id") or ""),
                                             body.get("request_id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"exchange": rec}


@router.get("/placements/{surface}")
async def surface_placements(surface: str, current: CurrentUser):
    from services import resource_visuals as rv
    try:
        return {"surface": surface,
                "resources": await rv.placements_for_surface(surface, current["id"])}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ─── Founder Resource Manager ────────────────────────────────────────────

SAFE_EDIT_FIELDS = ("name", "description", "icon", "color", "enabled", "public",
                    "per_user_cap", "global_cap", "daily_limit", "cooldown_s",
                    "fire_equiv", "build_eligible", "exchange_source", "exchange_dest",
                    "status", "enable_everywhere", "accessibility_label")


# ─── Phase 1.6 — Visual Studio ────────────────────────────────────────────

from services import job_engine as _je  # noqa: E402


@_je.register("resource_visual_gen")
async def _run_visual_gen(job: dict) -> dict:
    from services import resource_visuals as rv
    p = job["payload"]
    await _je.phase(job["id"], "generating", 25, "Creating master artwork")
    cost = 0.0
    if p.get("mock"):
        from PIL import Image
        import io as _io
        img = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        px = img.load()
        for x in range(256, 768):
            for y in range(256, 768):
                px[x, y] = (46, 230, 255, 255)
        buf = _io.BytesIO()
        img.save(buf, format="PNG")
        master = buf.getvalue()
        model = "mock-provider"
    else:
        from services.orai_images import generate_orai_image
        master, model = await generate_orai_image(p["prompt"])
        cost = 0.04
    await _je.phase(job["id"], "assembling", 60, "Deriving icon sizes")
    doc = await rv.create_version(p["resource_key"], master, source="generated",
                                  created_by=job.get("username") or job["user_id"],
                                  prompt=p["prompt"], provider_cost=cost,
                                  accessibility_label=p.get("label") or p["resource_key"])
    await _je.phase(job["id"], "saving", 90)
    return {"visual_id": doc["id"], "version": doc["version"], "model": model,
            "images": doc["images"], "cost": cost}


VISUAL_PROMPT = ("Game engagement resource icon: {prompt}. Single centered token/emblem, "
                 "premium stylized game-UI art, transparent background, NO text or letters, "
                 "bold clear silhouette readable at 32 pixels.")


@admin.post("/{key}/visuals/generate")
async def visuals_generate(key: str, body: dict, current: CurrentUser):
    require_founder(current)
    from services import orai_policies as op
    pol = await op.check_policy("resource_image_generation", current, is_founder=True)
    if not pol["allowed"]:
        raise HTTPException(status_code=403, detail=f"ORAi policy: {pol['reason']}")
    res = await db.resource_registry.find_one({"key": key}, {"_id": 0, "name": 1})
    if not res:
        raise HTTPException(status_code=404, detail="Resource not found")
    prompt = VISUAL_PROMPT.format(prompt=str(body.get("prompt") or res["name"]).strip()[:300])
    if body.get("dry_run", True) and not body.get("confirm"):
        return {"final_prompt": prompt, "provider": "Gemini image (gpt-image fallback)",
                "estimated_cost": 0.04, "note": "One master generation — all sizes derived free. Confirm to start."}
    job = await _je.submit("resource_visual_gen", current,
                           {"resource_key": key, "prompt": prompt,
                            "label": str(body.get("label") or res["name"])[:120],
                            "mock": bool(body.get("mock"))},
                           idem_key=body.get("request_id"))
    return {"job_id": job["id"]}


@admin.post("/{key}/visuals/upload")
async def visuals_upload(key: str, body: dict, current: CurrentUser):
    require_founder(current)
    from services import resource_visuals as rv
    import base64
    if not await db.resource_registry.find_one({"key": key}, {"key": 1}):
        raise HTTPException(status_code=404, detail="Resource not found")
    try:
        raw = base64.b64decode(str(body.get("image_b64") or "").split(",")[-1])
        doc = await rv.create_version(key, raw, source="uploaded", created_by=current["username"],
                                      accessibility_label=str(body.get("label") or key)[:120])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid image: {str(e)[:120]}")
    return {"visual": doc}


@admin.post("/{key}/visuals/reuse")
async def visuals_reuse(key: str, body: dict, current: CurrentUser):
    require_founder(current)
    from services import resource_visuals as rv
    import httpx
    url = str(body.get("url") or "")
    if not url:
        raise HTTPException(status_code=400, detail="Asset URL required")
    try:
        async with httpx.AsyncClient(timeout=20) as cl:
            r = await cl.get(url if url.startswith("http") else f"http://localhost:8001{url}")
            r.raise_for_status()
        doc = await rv.create_version(key, r.content, source="reused", created_by=current["username"],
                                      asset_ref=url, accessibility_label=str(body.get("label") or key)[:120])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not reuse asset: {str(e)[:120]}")
    return {"visual": doc}


@admin.get("/{key}/visuals")
async def visuals_list(key: str, current: CurrentUser):
    require_founder(current)
    rows = await db.resource_visuals.find({"resource_key": key}, {"_id": 0}) \
        .sort("version", -1).to_list(30)
    return {"visuals": rows}


@admin.post("/{key}/visuals/{visual_id}/activate")
async def visuals_activate(key: str, visual_id: str, current: CurrentUser):
    require_founder(current)
    from services import resource_visuals as rv
    try:
        vis = await rv.activate(key, visual_id, current["username"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"activated": vis["version"]}


# ─── Phase 1.6 — Placements, burn-into, surfaces ─────────────────────────

@admin.get("/placement-matrix")
async def placement_matrix(current: CurrentUser):
    require_founder(current)
    from services import resource_visuals as rv
    surfaces = await rv.all_surfaces()
    rows = []
    async for r in db.resource_registry.find({"archived": {"$ne": True}}, {"_id": 0}):
        cells = {}
        for sk, s in surfaces.items():
            eff = rv.effective_placement(r, sk, s)
            explicit = (r.get("placements") or {}).get(sk, {}).get("mode")
            cells[sk] = {"mode": explicit or eff["mode"],
                         "effective": eff["mode"], "ops": eff["ops"]}
        rows.append({"key": r["key"], "name": r["name"], "icon": r.get("icon"),
                     "visual": r.get("active_visual"), "status": r.get("status", "published"),
                     "enable_everywhere": bool(r.get("enable_everywhere")), "cells": cells})
    return {"surfaces": {k: {"label": v["label"], "builtin": v.get("builtin", False)}
                         for k, v in surfaces.items()}, "resources": rows}


@admin.post("/{key}/placements")
async def set_placement(key: str, body: dict, current: CurrentUser):
    require_founder(current)
    from services import resource_visuals as rv
    surface = str(body.get("surface") or "")
    mode = str(body.get("mode") or "disabled")
    if surface not in await rv.all_surfaces() or mode not in rv.MODES:
        raise HTTPException(status_code=400, detail="Unknown surface or mode")
    overrides = {k: bool(v) for k, v in (body.get("overrides") or {}).items() if k in rv.OP_KEYS}
    await db.resource_registry.update_one({"key": key}, {
        "$set": {f"placements.{surface}": {"mode": mode, "overrides": overrides},
                 "updated_at": _iso()},
        "$inc": {"version": 1},
        "$push": {"audit": {"$each": [{"by": current["username"], "at": _iso(),
                                       "action": "placement", "surface": surface, "mode": mode}],
                            "$slice": -50}}})
    return {"ok": True}


@admin.post("/{key}/enable-everywhere")
async def enable_everywhere(key: str, body: dict, current: CurrentUser):
    require_founder(current)
    on = bool(body.get("enabled"))
    r = await db.resource_registry.update_one({"key": key}, {
        "$set": {"enable_everywhere": on, "updated_at": _iso()}, "$inc": {"version": 1},
        "$push": {"audit": {"$each": [{"by": current["username"], "at": _iso(),
                                       "action": f"enable_everywhere={on}"}], "$slice": -50}}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Resource not found")
    return {"ok": True, "enable_everywhere": on}


@admin.post("/surfaces/register")
async def register_surface(body: dict, current: CurrentUser):
    """Future-surface adapter contract — declares capabilities, auto-discovers resources."""
    require_founder(current)
    from services import resource_visuals as rv
    if not body.get("key") or not body.get("label"):
        raise HTTPException(status_code=400, detail="key and label required")
    return await rv.register_adapter(str(body["key"]), str(body["label"]),
                                     body.get("caps") or {}, current["username"])


@admin.post("/{key}/burn-into")
async def burn_into(key: str, body: dict, current: CurrentUser):
    """'Allow this resource to burn into…' — one direction per explicit approval."""
    require_founder(current)
    from services import economy
    dst = str(body.get("dst") or "")
    if not await db.resource_registry.find_one({"key": dst, "archived": {"$ne": True}}):
        raise HTTPException(status_code=404, detail="Destination resource not found")
    if dst == key:
        raise HTTPException(status_code=400, detail="Source and destination must differ")
    rule = await economy.active_exchange_rule()
    pairs = [list(p) for p in (rule.get("pairs") or [])]
    pcs = dict(rule.get("pair_configs") or {})
    cfg_fields = ("enabled", "src_amount", "dst_amount", "min_amount", "max_amount",
                  "daily_limit", "cooldown_s", "fee_pct", "rounding", "start", "end",
                  "audience", "frozen")
    cfg = {k: body[k] for k in cfg_fields if k in body}
    cfg.setdefault("enabled", True)
    if body.get("remove"):
        pairs = [p for p in pairs if p != [key, dst]]
        pcs.pop(f"{key}>{dst}", None)
    else:
        if [key, dst] not in pairs:
            pairs.append([key, dst])
        pcs[f"{key}>{dst}"] = cfg
    regs = {r["key"]: r async for r in db.resource_registry.find({}, {"_id": 0})}
    warnings = economy.check_arbitrage({"pairs": pairs, "pair_configs": pcs}, regs)
    if body.get("preview"):
        sa, da = int(cfg.get("src_amount") or 1), int(cfg.get("dst_amount") or 0)
        preview = f"Burn {sa} {key} → receive {da} {dst}" if da else "fire-equivalence basis"
        return {"preview": preview, "warnings": warnings,
                "before": rule.get("pair_configs", {}).get(f"{key}>{dst}"), "after": cfg}
    if warnings and not body.get("confirm_arbitrage"):
        raise HTTPException(status_code=409, detail="Arbitrage risk: " + "; ".join(warnings))
    doc = {"pairs": pairs, "pair_configs": pcs,
           "min_amount": rule.get("min_amount", 1), "max_amount": rule.get("max_amount", 100000),
           "daily_limit": rule.get("daily_limit"), "cooldown_s": rule.get("cooldown_s", 0),
           "fee_pct": rule.get("fee_pct", 0), "rounding": rule.get("rounding", "floor_destination"),
           "frozen": rule.get("frozen", False), "enabled": True,
           "version": int(rule["version"]) + 1, "created_at": _iso(),
           "created_by": current["username"]}
    await db.gm_exchange_rules.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"rule": doc, "warnings": warnings}


@admin.get("")
async def admin_list(current: CurrentUser):
    require_founder(current)
    rows = await db.resource_registry.find({}, {"_id": 0}).sort("key", 1).to_list(200)
    return {"resources": rows}


@admin.post("")
async def admin_add(body: dict, current: CurrentUser):
    require_founder(current)
    _guard_resource_config(body)
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
    _guard_resource_config(body)
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


# ─── Cross-game resource gates (V1) + founder safeguards ─────────────────

from services import resource_gates as rg  # noqa: E402

PROHIBITED_RESOURCE_FLAGS = frozenset([
    "transferable", "tradeable", "trading", "marketplace", "cash_value", "cash_out",
    "redeemable", "monetary_value", "purchasable", "random_reward", "loot_box",
    "gambling", "prize_pool", "allow_negative"])


def _guard_resource_config(body: dict):
    bad = sorted(PROHIBITED_RESOURCE_FLAGS & set(body.keys()))
    if bad:
        raise HTTPException(status_code=400,
                            detail=f"Blocked by resource safety rules: {', '.join(bad)} — engagement "
                                   "resources are closed-loop and can never enable transfers, "
                                   "real-money value, external redemption or random prize burns.")
    for cap in ("per_user_cap", "global_cap", "daily_limit", "cooldown_s", "fire_equiv"):
        if cap in body and body[cap] is not None and float(body[cap]) < 0:
            raise HTTPException(status_code=400, detail=f"{cap} cannot be negative")


@admin.post("/gates/{game_id}")
async def admin_set_gate(game_id: str, body: dict, current: CurrentUser):
    require_founder(current)
    _guard_resource_config(body)
    try:
        return {"gate": await rg.set_gate(game_id, body, current["username"])}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)[:300])


@admin.get("/gates")
async def admin_list_gates(current: CurrentUser):
    require_founder(current)
    rows = await db.gm_resource_gates.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"gates": rows}


@router.get("/gates/{game_id}")
async def gate_status(game_id: str, current: CurrentUser):
    return await rg.status(game_id, current["id"] if current else None)


@router.post("/gates/{game_id}/unlock")
async def gate_unlock(game_id: str, body: dict, current: CurrentUser):
    try:
        return await rg.unlock(game_id, current, body.get("request_id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)[:300])
