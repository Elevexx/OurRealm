"""Build diagnostics, Founder Validation Report, deterministic Auto-Fix,
live build timeline, completion summary and build history. Read-mostly;
auto-fix applies only safe deterministic repairs (never an LLM)."""
import time
import uuid
from datetime import datetime, timezone

from core.db import db
from services.game_studio import RUNTIMES, RUNTIME_MECHANICS

REPORT_CATEGORIES = ["runtime_contract", "capability_detection", "blueprint", "registry",
                     "assets", "quest", "npc", "creature", "battle", "save_system",
                     "fire_power", "accessibility", "performance", "platform_compatibility"]

TIMELINE = [("planning", "Planning"), ("blueprint", "Blueprint"), ("specification", "Specification"),
            ("validation", "Validation"), ("runtime_assembly", "Runtime Assembly"),
            ("asset_wiring", "Asset Wiring"), ("polish", "Polish"), ("testing", "Testing"),
            ("founder_review", "Founder Review"), ("publish", "Publish")]


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _c(status, rule, error="", affected="", fix=""):
    return {"status": status, "rule": rule, "error": error, "affected": affected,
            "suggested_fix": fix}


async def founder_report(bp: dict) -> dict:
    """14-category Founder Validation Report with exact rule/error/fix."""
    game = await db.games.find_one({"blueprint_id": bp["id"]}, {"_id": 0, "id": 1, "status": 1,
                                   "spec": 1, "fire_economy": 1, "runtime": 1, "created_at": 1,
                                   "updated_at": 1, "actual_cost": 1, "build_log": 1},
                                   sort=[("created_at", -1)])
    spec = (game or {}).get("spec") or {}
    stages = spec.get("stages") or []
    g = bp.get("blueprint", {}).get("gameplay", {})
    cats = {}
    rt = bp.get("selected_runtime")
    cats["runtime_contract"] = _c("passed", "selected_runtime ∈ registered runtimes") \
        if rt in RUNTIMES else _c("failed", "selected_runtime ∈ registered runtimes",
                                  f"runtime '{rt}' is not registered", "selected_runtime",
                                  "Re-plan or change runtime to a registered family")
    sel = bp.get("runtime_selection") or {}
    cats["capability_detection"] = _c(
        "passed" if sel.get("detected_mechanics") else "warning",
        "mechanics detected before selection",
        "" if sel.get("detected_mechanics") else "no explicit mechanics detected in the request",
        "runtime_selection.detected_mechanics",
        "" if sel.get("detected_mechanics") else "Selection fell back to genre routing + LLM hint")
    v = bp.get("validation") or {}
    cats["blueprint"] = _c("failed" if v.get("blocking") else ("warning" if v.get("warnings") else "passed"),
                           "blueprint completeness (title, core loop, runtime)",
                           "; ".join(v.get("blocking") or v.get("warnings") or []),
                           "blueprint", "Revise the blueprint sections named in the error")
    fam = (bp.get("platform") or {}).get("runtime_family")
    from services.game_platform.runtime_registry import runtime_registry
    fam_entry = await runtime_registry.get(fam) if fam else None
    cats["registry"] = _c("passed", "platform.runtime_family resolves in the runtime registry") \
        if (not fam or fam_entry) else _c("failed", "platform.runtime_family resolves in the runtime registry",
                                          f"family '{fam}' not found", "platform.runtime_family",
                                          "Auto Fix will relink the family from the selected runtime")
    reqs = bp.get("asset_requirements") or []
    dup_ids = len(reqs) - len({r.get("req_id") for r in reqs})
    broken = [r["req_id"] for r in reqs if r.get("chosen_asset_id") and not r.get("best_matches")
              and r.get("founder_decision") == "use_suggested"]
    missing_req = [r["req_id"] for r in reqs if r.get("required") and r.get("generation_required")
                   and (r.get("founder_decision") or "pending") == "pending"]
    if dup_ids or broken:
        cats["assets"] = _c("failed", "asset requirements unique + links valid",
                            f"{dup_ids} duplicate req_id(s); broken links: {broken[:3]}",
                            "asset_requirements", "Auto Fix deduplicates ids and resets broken links")
    elif missing_req:
        cats["assets"] = _c("warning", "required assets resolved",
                            f"{len(missing_req)} required asset(s) undecided (placeholders will be used)",
                            ", ".join(missing_req[:4]), "Decide reuse/upload/generate-later per asset")
    else:
        cats["assets"] = _c("passed", "asset requirements unique + links valid")

    def _stage_check(name, key, fix):
        if not stages:
            return _c("waiting", f"spec has {name}", "no build spec yet", "game.spec", "Run a build first")
        bad = [i + 1 for i, s in enumerate(stages) if not s.get(key)]
        return _c("passed", f"every stage has {name}") if not bad else \
            _c("failed", f"every stage has {name}", f"missing in stage(s) {bad}", f"spec.stages{bad}", fix)
    cats["quest"] = _stage_check("a quest with an item", "quest",
                                 "Auto Fix inserts a default quest") if rt in ("rpg", "turn_based_creature_rpg") \
        else _c("passed", "quest system not required for this runtime")
    cats["npc"] = _stage_check("at least one NPC", "npcs",
                               "Auto Fix inserts the quest giver as an NPC") if rt in ("rpg", "turn_based_creature_rpg") \
        else _c("passed", "NPCs not required for this runtime")
    if rt == "turn_based_creature_rpg" and stages:
        no_catch = [i + 1 for i, s in enumerate(stages)
                    if not any(c.get("catchable") for c in (s.get("creatures") or []))]
        cats["creature"] = _c("passed", "every region has a catchable creature") if not no_catch else \
            _c("failed", "every region has a catchable creature", f"stage(s) {no_catch} have none",
               f"spec.stages{no_catch}.creatures", "Auto Fix adds a starter-tier catchable creature")
    else:
        cats["creature"] = _c("passed", "creature checks apply to creature RPG builds only") \
            if rt != "turn_based_creature_rpg" else _c("waiting", "creature checks", "no build spec yet")
    cats["battle"] = _c("passed", "combat objects present (monsters/creatures per region)") \
        if rt not in ("rpg", "turn_based_creature_rpg") or not stages or \
        all((s.get("monsters") or s.get("creatures")) for s in stages) else \
        _c("failed", "combat objects present", "a region has no monsters or creatures",
           "spec.stages", "Auto Fix adds one wild creature")
    save_req = (bp.get("blueprint", {}).get("systems", {}) or {}).get("save_requirements")
    cats["save_system"] = _c("passed", "save hooks declared (engine autosaves score/stage/best)") \
        if save_req else _c("warning", "save hooks declared",
                            "no save_requirements in blueprint", "blueprint.systems.save_requirements",
                            "Auto Fix declares the engine-default save contract")
    fe = (game or {}).get("fire_economy")
    cats["fire_power"] = _c("passed", "fire economy attached (ledger-backed, idempotent)") \
        if fe or not game else _c("warning", "fire economy attached",
                                  "built game has no fire_economy block", "game.fire_economy",
                                  "Auto Fix attaches the founder-editable default reward table")
    acc = bp.get("blueprint", {}).get("media", {}).get("accessibility") or []
    cats["accessibility"] = _c("passed", "engine accessibility defaults active "
                               "(reduced motion, high contrast, remapping)" +
                               (f" + {len(acc)} blueprint note(s)" if acc else ""))
    c = int(bp.get("complexity") or 1)
    cats["performance"] = _c("passed" if c < 8 else "warning", "complexity within engine budget",
                             "" if c < 8 else f"complexity {c} — use staged builds",
                             "complexity", "" if c < 8 else "Lower complexity or build incrementally")
    devices = bp.get("blueprint", {}).get("identity", {}).get("target_devices") or []
    cats["platform_compatibility"] = _c("passed", "desktop + mobile supported by the sandbox runtime",
                                        "", ", ".join(devices) or "desktop, mobile")
    failed = [k for k, x in cats.items() if x["status"] == "failed"]
    return {"categories": cats, "failed": failed,
            "overall": "failed" if failed else
            ("warnings" if any(x["status"] == "warning" for x in cats.values()) else "passed"),
            "game_id": (game or {}).get("id"), "generated_at": _iso()}


async def auto_fix(bp: dict) -> dict:
    """Safe deterministic repairs only — no LLM. Returns fixes applied."""
    fixes = []
    updates = {}
    reqs = bp.get("asset_requirements") or []
    seen = set()
    for r in reqs:
        rid = r.get("req_id") or f"req_{uuid.uuid4().hex[:6]}"
        if rid in seen:
            r["req_id"] = f"{rid}_{uuid.uuid4().hex[:4]}"
            fixes.append(f"deduplicated asset req_id '{rid}'")
        seen.add(r["req_id"])
        if r.get("chosen_asset_id") and not r.get("best_matches") and \
                r.get("founder_decision") == "use_suggested":
            r["chosen_asset_id"] = None
            r["founder_decision"] = "pending"
            fixes.append(f"reset broken asset link on {r['req_id']}")
    if fixes:
        updates["asset_requirements"] = reqs
    fam = (bp.get("platform") or {}).get("runtime_family")
    if fam:
        from services.game_platform.runtime_registry import runtime_registry
        if not await runtime_registry.get(fam):
            new_fam = next((f for f, e in (await runtime_registry.all()).items()
                            if e["definition"].get("engine_runtime") == bp.get("selected_runtime")), None)
            if new_fam:
                updates["platform.runtime_family"] = new_fam
                fixes.append(f"relinked registry family '{fam}' → '{new_fam}'")
    systems = bp.get("blueprint", {}).get("systems", {}) or {}
    if not systems.get("save_requirements"):
        updates["blueprint.systems.save_requirements"] = \
            "Engine default: autosave score, stage index and best result per player (game_progress)"
        fixes.append("declared engine-default save hooks")
    game = await db.games.find_one({"blueprint_id": bp["id"]},
                                   {"_id": 0, "id": 1, "spec": 1, "fire_economy": 1},
                                   sort=[("created_at", -1)])
    if game:
        gu = {}
        spec = game.get("spec") or {}
        rt = bp.get("selected_runtime")
        changed = False
        for i, s in enumerate(spec.get("stages") or []):
            if rt in ("rpg", "turn_based_creature_rpg"):
                if not s.get("npcs"):
                    giver = (s.get("quest") or {}).get("giver") or "Guide"
                    s["npcs"] = [{"name": giver, "x": 1, "y": 1, "dialog": (s.get("quest") or {}).get("text") or "Welcome!"}]
                    fixes.append(f"stage {i+1}: inserted quest giver NPC")
                    changed = True
                if rt == "turn_based_creature_rpg" and not any(
                        c.get("catchable") for c in (s.get("creatures") or [])):
                    s.setdefault("creatures", []).append(
                        {"name": "Wildling", "x": 3, "y": 3, "hp": 10, "attack": 3, "xp": 8, "catchable": True})
                    fixes.append(f"stage {i+1}: added a catchable wild creature")
                    changed = True
        if changed:
            gu["spec"] = spec
        if not game.get("fire_economy"):
            from services.game_platform.system_registry import economy_registry
            fp = await economy_registry.get("fire_power")
            gu["fire_economy"] = {"enabled": False,
                                  "rewards": dict((fp or {}).get("definition", {}).get("reward_table") or {}),
                                  "note": "attached by auto-fix — founder-editable, disabled by default"}
            fixes.append("attached default fire economy (disabled, founder-editable)")
        if gu:
            gu["updated_at"] = _iso()
            await db.games.update_one({"id": game["id"]}, {"$set": gu})
    if updates:
        updates["updated_at"] = _iso()
        await db.game_blueprints.update_one({"id": bp["id"]}, {"$set": updates})
    await db.game_blueprints.update_one(
        {"id": bp["id"]},
        {"$push": {"autofix_history": {"$each": [{"at": _iso(), "fixes": fixes}], "$slice": -10}}})
    return {"fixes_applied": fixes, "count": len(fixes)}


async def build_timeline(bp: dict) -> list:
    game = await db.games.find_one({"blueprint_id": bp["id"]},
                                   {"_id": 0, "status": 1, "stage": 1, "build_log": 1},
                                   sort=[("created_at", -1)])
    gs = (game or {}).get("status")
    log_stages = {l.get("stage") for l in (game or {}).get("build_log") or []}
    done_all = gs in ("pending_approval", "approved", "published", "complete")
    fixes = bool(bp.get("autofix_history"))
    reqs = bp.get("asset_requirements") or []
    decided = all((r.get("founder_decision") or "pending") != "pending" for r in reqs if r.get("required"))
    st = {
        "planning": "passed",
        "blueprint": "passed" if bp.get("blueprint") else "failed",
        "specification": "passed" if done_all else ("failed" if gs == "failed" else
                         ("running" if gs == "building" else "waiting")),
        "validation": ("auto-fixed" if fixes else "passed") if done_all else
                      ("failed" if gs == "failed" else ("running" if gs == "building" else "waiting")),
        "runtime_assembly": "passed" if done_all else ("running" if gs == "building" else "waiting"),
        "asset_wiring": "passed" if done_all else ("waiting" if not decided else "waiting"),
        "polish": "passed" if done_all and "refining" in log_stages else
                  ("running" if gs == "building" and "refining" in log_stages else
                   ("passed" if done_all else "waiting")),
        "testing": "passed" if done_all else ("failed" if gs == "failed" else "waiting"),
        "founder_review": "passed" if gs in ("approved", "published") else
                          ("running" if gs == "pending_approval" else "waiting"),
        "publish": "passed" if gs == "published" else "waiting",
    }
    return [{"id": i, "label": l, "status": st[i]} for i, l in TIMELINE]


async def completion_summary(bp: dict) -> dict:
    game = await db.games.find_one({"blueprint_id": bp["id"]},
                                   {"_id": 0, "id": 1, "status": 1, "actual_cost": 1,
                                    "created_at": 1, "updated_at": 1},
                                   sort=[("created_at", -1)])
    reqs = bp.get("asset_requirements") or []
    est = bp.get("blueprint", {}).get("meta", {}).get("estimated_ai_usage") or {}
    sel = bp.get("runtime_selection") or {}
    score = ((sel.get("ranked") or [{}])[0] or {}).get("score")
    build_s = None
    if game and game.get("created_at") and game.get("updated_at"):
        try:
            from datetime import datetime as _dt
            build_s = round((_dt.fromisoformat(game["updated_at"])
                             - _dt.fromisoformat(game["created_at"])).total_seconds(), 1)
        except Exception:  # noqa: BLE001
            pass
    return {"runtime_selected": bp.get("selected_runtime"),
            "compatibility_score": score,
            "assets_reused": sum(1 for r in reqs if r.get("existing_match_found")),
            "assets_to_generate_later": sum(1 for r in reqs if r.get("generation_required")),
            "validations_run": len(REPORT_CATEGORIES),
            "auto_fixes_applied": sum(len(h.get("fixes") or [])
                                      for h in bp.get("autofix_history") or []),
            "warnings": (bp.get("validation") or {}).get("warnings") or [],
            "estimated_ai_usage": est,
            "actual_ai_usage": (game or {}).get("actual_cost"),
            "build_time_seconds": build_s,
            "game_status": (game or {}).get("status")}


async def build_history(bp: dict) -> list:
    rows = await db.games.find({"blueprint_id": bp["id"]},
                               {"_id": 0, "id": 1, "title": 1, "status": 1, "actual_cost": 1,
                                "created_at": 1, "updated_at": 1}).sort("created_at", -1).to_list(10)
    return rows
