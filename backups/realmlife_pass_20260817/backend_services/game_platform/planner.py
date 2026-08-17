"""Multi-stage Planning Engine — understand → detect genres/mechanics/
multiplayer/economy → capability runtime + renderer recommendation →
reusable assets + library search → cost estimate → blueprint →
compatibility validation → unsupported report → recommendations →
blocker check. Additive: produces the SAME blueprint doc contract as
game_blueprints.plan_blueprint plus a `platform` section + `planning_stages`."""
import json
import logging
import time

from services.chat_conversations import call_openai_chat
from services.llm_router import tier
from services import game_blueprints as gb
from services.game_platform.runtime_registry import recommend_capability_runtime, renderer_registry
from services.game_platform.validation_registry import run_validation
from services.game_platform.capability_registry import capability_status

log = logging.getLogger("ourrealm.game_platform.planner")

ANALYZE_SYSTEM = """You are ORAi's game request analyst. Reply ONLY valid JSON:
{"summary":"1 sentence understanding of the request",
 "genres":["primary genre first — e.g. platformer, tower defense, visual novel"],
 "mechanics":["explicit gameplay mechanics requested"],
 "multiplayer": true|false,
 "economy":["currencies/rewards mentioned: fire power, coins, xp, resources, none"],
 "systems":["game systems implied: quests, inventory, dialogue, crafting, bosses, ..."],
 "asset_themes":["visual/audio themes for asset reuse search"]}
No prose outside JSON."""


def _stage(stages, name, summary, data=None, status="done", t0=None):
    stages.append({"stage": name, "status": status, "summary": str(summary)[:300],
                   "data": data, "ms": int((time.monotonic() - t0) * 1000) if t0 else None})


async def plan_project(body: dict, current: dict) -> dict:
    """Full multi-stage plan. Returns the blueprint doc (insertable into
    game_blueprints) with additive platform data. Planning only — no
    media, no build."""
    stages = []
    request_text = str(body.get("request") or "")[:2000]
    power = min(max(int(body.get("ai_power") or 10), 1), 10)

    # 1-5: understand + detections (one cheap LLM call, deterministic split)
    t0 = time.monotonic()
    t = tier(min(power, 3))
    analysis = {}
    try:
        res = await call_openai_chat(
            [{"role": "system", "content": ANALYZE_SYSTEM},
             {"role": "user", "content": request_text}],
            model=t["model"], max_tokens=1200, json_mode=True)
        analysis = json.loads(res.get("content") or "{}")
    except Exception as e:  # noqa: BLE001
        log.warning("planner analysis failed: %s", e)
    analysis = {"summary": str(analysis.get("summary") or "")[:300],
                "genres": [str(g)[:60] for g in (analysis.get("genres") or [])][:5],
                "mechanics": [str(m)[:80] for m in (analysis.get("mechanics") or [])][:15],
                "multiplayer": bool(analysis.get("multiplayer")),
                "economy": [str(e)[:40] for e in (analysis.get("economy") or [])][:6],
                "systems": [str(s)[:40] for s in (analysis.get("systems") or [])][:12],
                "asset_themes": [str(a)[:60] for a in (analysis.get("asset_themes") or [])][:8]}
    _stage(stages, "understand_request", analysis["summary"] or "request parsed", t0=t0)
    _stage(stages, "detect_genres", ", ".join(analysis["genres"]) or "none detected",
           {"genres": analysis["genres"]})
    _stage(stages, "detect_mechanics", f"{len(analysis['mechanics'])} mechanic(s)",
           {"mechanics": analysis["mechanics"]})
    _stage(stages, "detect_multiplayer",
           "multiplayer requested" if analysis["multiplayer"] else "single-player",
           {"multiplayer": analysis["multiplayer"]})
    _stage(stages, "detect_economy", ", ".join(analysis["economy"]) or "none",
           {"economy": analysis["economy"]})

    # 6: capability-driven runtime recommendation (registry, reject bad fits)
    t0 = time.monotonic()
    cap_rec = await recommend_capability_runtime(request_text, analysis)
    rec = cap_rec["recommended"]
    _stage(stages, "recommend_runtime",
           f"{rec['label']} ({rec['maturity']}, engine {rec['engine_runtime']})" if rec
           else "NO compatible buildable runtime — rejected instead of forcing a fit",
           cap_rec, status="done" if rec else "blocked", t0=t0)

    # 7: renderer recommendation
    renderer = (rec or {}).get("renderer") or "canvas_2d"
    rend = await renderer_registry.get(renderer)
    _stage(stages, "recommend_renderer",
           f"{(rend or {}).get('definition', {}).get('label', renderer)}",
           {"renderer": renderer})

    if not rec:
        return {"blocked": True, "planning_stages": stages, "analysis": analysis,
                "capability_recommendation": cap_rec,
                "recommendations": cap_rec["recommendations"]}

    # 8-11: blueprint production via the existing vetted pipeline
    # (includes reusable-asset derivation, library search, cost estimate)
    t0 = time.monotonic()
    if rec["engine_runtime"]:
        body = {**body, "runtime_hint": rec["engine_runtime"]}
    doc = await gb.plan_blueprint(body, current)
    # Only realign to the family engine when it is compatible with the
    # detected mechanics AND does not score worse than the deterministic
    # mechanics pick — the capability-matrix pick is authoritative.
    rt_sel = doc.get("runtime_selection") or {}
    ranked = {r.get("runtime"): r.get("score", 0) for r in (rt_sel.get("ranked") or [])}
    engine_ok = (not rt_sel.get("detected_mechanics")
                 or (rec["engine_runtime"] in (rt_sel.get("compatible_runtimes") or [])
                     and ranked.get(rec["engine_runtime"], 0)
                     >= ranked.get(doc.get("selected_runtime"), 0)))
    if rec["engine_runtime"] and doc.get("selected_runtime") != rec["engine_runtime"] and engine_ok:
        doc = gb.change_runtime(doc, rec["engine_runtime"])
        doc["asset_requirements"], _ = await gb.match_requirements(
            current["id"], doc["asset_requirements"])
    reqs = doc.get("asset_requirements") or []
    reused = sum(1 for r in reqs if r.get("existing_match_found"))
    _stage(stages, "detect_reusable_assets",
           f"{len(reqs)} requirement(s); themes: {', '.join(analysis['asset_themes'][:4]) or 'n/a'}")
    _stage(stages, "search_library", f"{reused}/{len(reqs)} matched in the asset library",
           {"matched": reused, "total": len(reqs)})
    est = doc["blueprint"]["meta"].get("estimated_ai_usage") or {}
    _stage(stages, "estimate_cost",
           f"planning ~${est.get('planning')} · deferred assets ~${est.get('assets_if_generated_later')}",
           est)
    _stage(stages, "produce_blueprint", f"blueprint '{doc.get('name')}' v{doc.get('version')}", t0=t0)

    # 12-14: grouped compatibility validation + reports
    t0 = time.monotonic()
    doc["platform"] = {"runtime_family": rec["family_id"], "renderer": renderer,
                       "analysis": analysis, "capability_recommendation": cap_rec}
    grouped = await run_validation(doc)
    _stage(stages, "validate_compatibility", f"overall: {grouped['overall']}",
           {"supported": len(grouped["supported"]),
            "partial": len(grouped["partially_supported"]),
            "missing": len(grouped["missing"])}, t0=t0)
    unsupported = (doc.get("mechanics_support") or {}).get("unsupported") or []
    _stage(stages, "report_unsupported",
           ("; ".join(unsupported[:5])) if unsupported else "all requested mechanics supported",
           {"unsupported": unsupported})
    recs = list(dict.fromkeys(cap_rec["recommendations"] + grouped["recommendations"]))
    _stage(stages, "recommendations", f"{len(recs)} recommendation(s)", {"recommendations": recs})
    blockers = grouped["missing"]
    _stage(stages, "blocker_check",
           "true blocker(s) present" if blockers else "no blockers — ready for founder review",
           {"blockers": blockers}, status="blocked" if blockers else "done")

    doc["platform"]["grouped_validation"] = grouped
    doc["planning_stages"] = stages
    doc["platform"]["providers"] = await capability_status()
    return doc
