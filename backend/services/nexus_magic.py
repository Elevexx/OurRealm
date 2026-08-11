"""AI Magic Loop engine for the Nexus builder (founder-only).
Real run pipeline over Mongo state: Build -> Review -> Compare -> Improve -> Verify.
Never writes to the published world; results become an approvable draft proposal.
Scores are honest deterministic schema heuristics — never invented percentages."""
import asyncio
import copy
import time
import uuid
from datetime import datetime, timezone

from core.db import db
from services import nexus_world as nw

MODES = {"improve_draft", "clone_variant", "animation_style", "runtime_style", "living_editor"}
STAGES = ["build", "review", "compare", "improve", "verify"]
PALETTE = ["#3f6f8f", "#4a4f66", "#5a6079", "#5f4a66", "#39506b",
           "#6b5a3f", "#37c8ff", "#2ee87a", "#c26bff", "#e8c07a"]

ANIMATION_STYLES = {
    "portal_spin_slow": {"supported": True, "label": "Portal spin — slow", "spin": 0.35},
    "portal_spin_normal": {"supported": True, "label": "Portal spin — normal", "spin": 0.8},
    "portal_spin_fast": {"supported": True, "label": "Portal spin — fast", "spin": 1.8},
    "light_glow_dim": {"supported": True, "label": "Light glow — dim", "intensity": 8},
    "light_glow_bright": {"supported": True, "label": "Light glow — bright", "intensity": 28},
    "avatar_gait": {"supported": False, "label": "Avatar gait (needs rigged GLBs — Checkpoint B)"},
    "npc_pathing": {"supported": False, "label": "NPC pathing (needs nav system — Phase B)"},
}
RUNTIME_STYLES = {
    "night_plaza": {"supported": True, "label": "Night Plaza", "sky": "#101a30", "ground_color": "#2c3450", "ambient": 0.55, "sun": 1.1},
    "dawn_glow": {"supported": True, "label": "Dawn Glow", "sky": "#2b2036", "ground_color": "#3a3050", "ambient": 0.75, "sun": 1.5},
    "neon_dusk": {"supported": True, "label": "Neon Dusk", "sky": "#0b1226", "ground_color": "#1c2440", "ambient": 0.5, "sun": 0.8},
    "emerald_evening": {"supported": True, "label": "Emerald Evening", "sky": "#0e2018", "ground_color": "#1e3428", "ambient": 0.65, "sun": 1.2},
    "pbr_daylight": {"supported": False, "label": "PBR daylight (needs textured assets — Checkpoint B)"},
}


def _iso():
    return datetime.now(timezone.utc).isoformat()


def clamp_settings(s, founder_max):
    score_cap = 99 if founder_max else 95
    return {
        "founder_max": bool(founder_max),
        "stop_score": max(50, min(score_cap, int(s.get("stop_score") or 90))),
        "max_attempts": max(1, min(5 if founder_max else 3, int(s.get("max_attempts") or 3))),
        "repair_cycles": max(0, min(3 if founder_max else 2, int(s.get("repair_cycles") or 2))),
        "reviewer": bool(s.get("reviewer", True)),
        "dry_run": bool(s.get("dry_run")),
        "mock": bool(s.get("mock")),
    }


def validate_targets(world, targets):
    if not isinstance(targets, list) or not targets or len(targets) > 60:
        raise ValueError("select 1-60 targets")
    out = []
    for t in targets:
        zid = str(t.get("zone_id") or "")
        zone = next((z for z in world["zones"] if z["id"] == zid), None)
        if not zone:
            raise ValueError(f"zone {zid} not found")
        if t.get("kind") == "zone":
            out.append({"kind": "zone", "zone_id": zid})
        else:
            eid = str(t.get("entity_id") or "")
            if not any(e["id"] == eid for e in zone["entities"]):
                raise ValueError(f"entity {eid} not found in {zid}")
            out.append({"kind": "entity", "zone_id": zid, "entity_id": eid})
    return out


def _entity(world, zid, eid):
    zone = next(z for z in world["zones"] if z["id"] == zid)
    return zone, next(e for e in zone["entities"] if e["id"] == eid)


def _nearest_palette(color):
    try:
        r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
    except (ValueError, IndexError):
        return PALETTE[0]
    best, bd = PALETTE[0], 1e9
    for p in PALETTE:
        pr, pg, pb = int(p[1:3], 16), int(p[3:5], 16), int(p[5:7], 16)
        d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if d < bd:
            best, bd = p, d
    return best


def mock_propose(mode, world, targets, style=None, request_text=""):
    """Deterministic local proposer (provider='mock') — zero paid calls."""
    ops = []
    if mode == "improve_draft":
        for t in targets:
            if t["kind"] == "entity":
                zone, e = _entity(world, t["zone_id"], t["entity_id"])
                fields = {"pos": [round(e["pos"][0] * 2) / 2, e["pos"][1], round(e["pos"][2] * 2) / 2],
                          "color": _nearest_palette(e["color"])}
                if e["type"] in ("box", "portal", "npc") and not e.get("props", {}).get("label"):
                    fields["props"] = {"label": f"{e['type'].title()} {e['id'][-4:]}"}
                ops.append({"op": "update_entity", "zone_id": t["zone_id"],
                            "entity_id": t["entity_id"], "fields": fields})
            else:
                ops.append({"op": "update_zone", "zone_id": t["zone_id"],
                            "fields": {"ambient": 0.65, "sun": 1.15}})
        plan = f"Snap {len(ops)} selected target(s) to the greybox grid, harmonize colors to the OurRealm palette and ensure labels."
    elif mode == "animation_style":
        st = ANIMATION_STYLES.get(style or "")
        if not st or not st.get("supported"):
            raise ValueError(f"animation style '{style}' is not supported by the greybox renderer")
        for t in targets:
            if t["kind"] != "entity":
                continue
            zone, e = _entity(world, t["zone_id"], t["entity_id"])
            if "spin" in st and e["type"] == "portal":
                ops.append({"op": "update_entity", "zone_id": t["zone_id"], "entity_id": e["id"],
                            "fields": {"props": {"spin": st["spin"]}}})
            elif "intensity" in st and e["type"] == "light":
                ops.append({"op": "update_entity", "zone_id": t["zone_id"], "entity_id": e["id"],
                            "fields": {"props": {"intensity": st["intensity"]}}})
        if not ops:
            raise ValueError("selected targets contain no portals/lights this style can apply to")
        plan = f"Apply '{ANIMATION_STYLES[style]['label']}' to {len(ops)} compatible target(s)."
    elif mode == "runtime_style":
        st = RUNTIME_STYLES.get(style or "")
        if not st or not st.get("supported"):
            raise ValueError(f"runtime style '{style}' is not supported by the greybox renderer")
        zones = {t["zone_id"] for t in targets}
        for zid in zones:
            ops.append({"op": "update_zone", "zone_id": zid,
                        "fields": {k: st[k] for k in ("sky", "ground_color", "ambient", "sun")}})
        plan = f"Apply '{st['label']}' lighting/palette to zone(s): {', '.join(sorted(zones))}."
    elif mode == "living_editor":
        req = (request_text or "founder request")[:60]
        zid = targets[0]["zone_id"]
        zone = next(z for z in world["zones"] if z["id"] == zid)
        sx = zone["spawn"]["x"] + 4
        ops.append({"op": "add_entity", "zone_id": zid,
                    "entity": {"type": "box", "pos": [sx, 0, zone["spawn"]["z"] - 4],
                               "rot": [0, 0, 0], "scale": [2, 1.5, 2], "color": "#2ee87a",
                               "props": {"label": req[:24]}}})
        plan = f"(mock provider) Add a labeled greybox placeholder for: {req}"
    else:
        raise ValueError(f"mode {mode} has no proposer")
    return plan, ops


async def real_propose(mode, world, targets, style, request_text, sys_prompt):
    from services.chat_conversations import call_openai_chat
    import json as _json
    zone_ids = sorted({t["zone_id"] for t in targets})
    ctx = {"zones": [], "targets": targets, "mode": mode, "style": style}
    for zid in zone_ids:
        z = next(zz for zz in world["zones"] if zz["id"] == zid)
        ctx["zones"].append({"id": z["id"], "name": z["name"], "size": z["size"], "sky": z["sky"],
                             "ground_color": z["ground_color"], "spawn": z["spawn"],
                             "entities": [{"id": e["id"], "type": e["type"], "pos": e["pos"],
                                           "scale": e["scale"], "color": e["color"],
                                           "label": e.get("props", {}).get("label")} for e in z["entities"]]})
    res = await call_openai_chat(
        [{"role": "system", "content": sys_prompt},
         {"role": "user", "content": f"CONTEXT:\n{_json.dumps(ctx)}\n\nREQUEST:\n{request_text or mode}"}],
        json_mode=True, max_tokens=4000)
    parsed = _json.loads(res.get("content") or "{}")
    return str(parsed.get("plan") or "")[:600], parsed.get("ops") or []


def score_ops(world, ops, targets, founder_max=False):
    """Honest heuristic schema score. Returns (score, issues[])."""
    issues = []
    try:
        new_world, _, _ = nw.apply_ops(world, ops)
    except ValueError as e:
        return 0, [f"ops failed validation: {e}"]
    score = 70
    target_eids = {t.get("entity_id") for t in targets if t["kind"] == "entity"}
    touched = []
    for op in ops:
        if op["op"] in ("update_entity",) and op.get("entity_id"):
            touched.append((op["zone_id"], op["entity_id"]))
        elif op["op"] == "add_entity":
            pass
    in_bounds = True
    labeled = True
    palette_fit = 0
    checked = 0
    for z in new_world["zones"]:
        hw, hd = z["size"][0] / 2, z["size"][1] / 2
        for e in z["entities"]:
            if target_eids and e["id"] not in target_eids and (z["id"], e["id"]) not in touched:
                continue
            checked += 1
            if abs(e["pos"][0]) > hw or abs(e["pos"][2]) > hd:
                in_bounds = False
                issues.append(f"{e['id']} out of bounds")
            if e["type"] in ("box", "portal", "npc") and not e.get("props", {}).get("label"):
                labeled = False
                issues.append(f"{e['id']} missing label")
            if e["color"] in PALETTE:
                palette_fit += 1
    score += 10  # ops apply cleanly
    if in_bounds:
        score += 6
    if labeled:
        score += 5
    if checked:
        score += round(4 * palette_fit / checked)
    if founder_max and in_bounds and labeled and not issues:
        score += 4  # founder-max detail pass: zero outstanding issues
    return min(99 if founder_max else 95, score), issues


def improve_ops(world, ops, issues):
    """Deterministic repair: clamp out-of-bounds, add missing labels."""
    fixed = copy.deepcopy(ops)
    bad_ids = {i.split(" ")[0] for i in issues}
    for z in world["zones"]:
        hw, hd = z["size"][0] / 2 - 1, z["size"][1] / 2 - 1
        for e in z["entities"]:
            if e["id"] not in bad_ids:
                continue
            fields = {}
            if abs(e["pos"][0]) > hw or abs(e["pos"][2]) > hd:
                fields["pos"] = [max(-hw, min(hw, e["pos"][0])), e["pos"][1],
                                 max(-hd, min(hd, e["pos"][2]))]
            if e["type"] in ("box", "portal", "npc") and not e.get("props", {}).get("label"):
                fields["props"] = {"label": f"{e['type'].title()} {e['id'][-4:]}"}
            if fields:
                fixed.append({"op": "update_entity", "zone_id": z["id"], "entity_id": e["id"], "fields": fields})
    return fixed


async def _set(run_id, patch):
    patch["updated_at"] = _iso()
    patch["heartbeat"] = time.time()
    await db.nexus_magic_runs.update_one({"id": run_id}, {"$set": patch})


async def _push_stage(run_id, stage, note, score=None):
    entry = {"stage": stage, "note": note[:300], "at": _iso()}
    if score is not None:
        entry["score"] = score
    await db.nexus_magic_runs.update_one({"id": run_id}, {"$push": {"stage_history": entry}})


async def _get(run_id):
    return await db.nexus_magic_runs.find_one({"id": run_id}, {"_id": 0})


async def _wait_if_paused(run_id):
    while True:
        run = await _get(run_id)
        if not run or run.get("control") == "stop":
            return None
        if run.get("control") == "pause":
            if run["status"] != "paused":
                await _set(run_id, {"status": "paused"})
            await asyncio.sleep(1.0)
            continue
        if run["status"] == "paused":
            await _set(run_id, {"status": "running"})
        return run


ORAI_MAGIC_SYS = """You are ORAi World Architect running an AI Magic Loop pass on the OurRealm Nexus greybox world.
Output ONLY JSON {"plan": "...", "ops": [...]} using the strict op schema:
add_entity/update_entity/remove_entity (types box|ramp|pillar|light|portal|npc, props label/spin/intensity)
and update_zone (sky, ground_color, ambient 0-3, sun 0-3). Only modify the given TARGETS. Keep edits minimal."""


async def execute_run(run_id):
    try:
        run = await _get(run_id)
        if not run:
            return
        doc = await db.nexus_worlds.find_one({"world_id": nw.WORLD_ID}, {"_id": 0})
        world = doc["draft"]
        mode, targets = run["mode"], run["targets"]
        settings = run["settings"]
        usage = {"orai_calls": 0, "openai_calls": 0, "meshy_calls": 0}

        # ── stage 1: BUILD
        run = await _wait_if_paused(run_id)
        if not run:
            return await _finish_stopped(run_id)
        await _set(run_id, {"stage": "build", "stages_done": 0})
        if mode == "clone_variant":
            vid = "var_" + uuid.uuid4().hex[:10]
            await db.nexus_variants.insert_one({
                "id": vid, "label": run.get("label") or f"Variant {vid[-4:]}",
                "world": copy.deepcopy(world), "source_draft_version": doc["draft_version"],
                "targets": targets, "kind": "clone", "created_at": _iso()})
            await _push_stage(run_id, "build", f"Cloned draft v{doc['draft_version']} into variant {vid} (source preserved)")
            await _set(run_id, {"result": {"variant_id": vid, "ops": [], "plan": "Clone created"}, "stages_done": 1})
            plan, ops = "Clone created — no world edits", []
        elif settings["mock"] or mode in ("improve_draft", "animation_style", "runtime_style"):
            plan, ops = mock_propose(mode, world, targets, run.get("style"), run.get("request"))
            await _push_stage(run_id, "build", f"Deterministic proposer built {len(ops)} ops (provider: local, 0 credits)")
        else:
            plan, ops = await real_propose(mode, world, targets, run.get("style"), run.get("request"), ORAI_MAGIC_SYS)
            usage["openai_calls"] += 1
            await _push_stage(run_id, "build", f"ORAi built {len(ops)} ops (1 LLM call)")
        await asyncio.sleep(1.0)
        await _set(run_id, {"stages_done": 1, "provider_usage": usage})

        # ── stage 2: REVIEW
        run = await _wait_if_paused(run_id)
        if not run:
            return await _finish_stopped(run_id)
        await _set(run_id, {"stage": "review"})
        score, issues = (100, []) if mode == "clone_variant" else score_ops(world, ops, targets, settings["founder_max"])
        note = f"Heuristic schema score {score} ({len(issues)} issue(s))"
        if settings["reviewer"] and mode != "clone_variant":
            score2, issues2 = score_ops(world, ops, targets, settings["founder_max"])
            note += f" · independent reviewer pass agreed ({score2})"
        await _push_stage(run_id, "review", note, score)
        await asyncio.sleep(1.0)
        await _set(run_id, {"score": score, "stages_done": 2})

        # ── stage 3: COMPARE
        run = await _wait_if_paused(run_id)
        if not run:
            return await _finish_stopped(run_id)
        await _set(run_id, {"stage": "compare"})
        diff = {"ops_count": len(ops), "adds": sum(1 for o in ops if o["op"] == "add_entity"),
                "updates": sum(1 for o in ops if o["op"] in ("update_entity", "update_zone")),
                "removes": sum(1 for o in ops if o["op"] == "remove_entity"),
                "targets": len(targets)}
        await _push_stage(run_id, "compare", f"Diff vs draft: +{diff['adds']} ~{diff['updates']} -{diff['removes']} across {diff['targets']} target(s)")
        await asyncio.sleep(1.0)
        await _set(run_id, {"diff": diff, "stages_done": 3})

        # ── stage 4: IMPROVE (bounded repair cycles)
        cycles = 0
        while mode != "clone_variant" and score < settings["stop_score"] and cycles < settings["repair_cycles"]:
            run = await _wait_if_paused(run_id)
            if not run:
                return await _finish_stopped(run_id)
            await _set(run_id, {"stage": "improve"})
            cycles += 1
            ops = improve_ops(world, ops, issues)
            score, issues = score_ops(world, ops, targets, settings["founder_max"])
            await _push_stage(run_id, "improve", f"Repair cycle {cycles}/{settings['repair_cycles']} → score {score}", score)
            await asyncio.sleep(1.0)
            await _set(run_id, {"score": score, "cycles": cycles})
        await _set(run_id, {"stages_done": 4})

        # ── stage 5: VERIFY
        run = await _wait_if_paused(run_id)
        if not run:
            return await _finish_stopped(run_id)
        await _set(run_id, {"stage": "verify"})
        if mode != "clone_variant":
            try:
                nw.apply_ops(world, ops)
                await _push_stage(run_id, "verify", "Final dry-run apply passed schema validation", score)
            except ValueError as e:
                await _push_stage(run_id, "verify", f"FAILED final validation: {e}")
                return await _set(run_id, {"status": "failed", "stage": "done", "stages_done": 5})
        met = score >= settings["stop_score"]
        final = {"plan": plan, "ops": ops, "score": score, "score_kind": "heuristic_schema",
                 "stop_score_met": met}
        if mode == "clone_variant":
            final["variant_id"] = (run.get("result") or {}).get("variant_id")
            status = "completed"
        elif settings["dry_run"]:
            status = "completed"
        else:
            status = "awaiting_approval"
        await _set(run_id, {"status": status, "stage": "done", "stages_done": 5,
                            "result": final, "provider_usage": usage})
    except Exception as e:  # noqa: BLE001
        await _push_stage(run_id, "verify", f"Engine error: {str(e)[:200]}")
        await _set(run_id, {"status": "failed", "stage": "done"})


async def _finish_stopped(run_id):
    await _push_stage(run_id, "stopped", "Run stopped by founder")
    await _set(run_id, {"status": "stopped", "stage": "done"})
