"""Validation Registry — grouped blueprint validation. Runs all
registered validators in parallel and groups results as
Supported / Partially Supported / Missing + Recommendations.
Never silently downgrades: every gap is reported."""
import asyncio

from services.game_platform.registry_core import Registry
from services.game_platform.runtime_registry import runtime_registry

VALIDATOR_SEED = {k: {"label": lbl} for k, lbl in [
    ("runtime", "Runtime compatibility"), ("mechanics", "Mechanics support"),
    ("assets", "Asset readiness"), ("economy", "Economy configuration"),
    ("save_system", "Save system"), ("multiplayer", "Multiplayer"),
    ("mobile", "Mobile support"), ("desktop", "Desktop support"),
    ("performance", "Performance budget"), ("security", "Security & sandboxing"),
]}
validation_registry = Registry("validators", VALIDATOR_SEED, description="Blueprint validators")


def _r(status, notes, rec=None):
    return {"status": status, "notes": notes, "recommendations": rec or []}


async def _v_runtime(bp):
    rt = bp.get("selected_runtime")
    if not rt:
        return _r("missing", "No runtime selected", ["Pick a compatible runtime family"])
    fam = bp.get("platform", {}).get("runtime_family")
    if fam:
        entry = await runtime_registry.get(fam)
        m = (entry or {}).get("definition", {}).get("maturity")
        if m == "partial":
            return _r("partial", f"{fam} approximated on {rt}",
                      (entry["definition"].get("substitutions") or [])[:3])
        if m == "foundation":
            return _r("missing", f"{fam} is foundation-only — build is rejected",
                      ["Choose a generatable family"])
    return _r("supported", f"Vetted engine runtime '{rt}' selected")


async def _v_mechanics(bp):
    ms = bp.get("mechanics_support") or {}
    if ms.get("unsupported"):
        return _r("partial", f"{len(ms['unsupported'])} mechanic(s) unsupported: "
                  + "; ".join(ms["unsupported"][:4]),
                  ["Revise the blueprint or switch runtime for these mechanics"])
    return _r("supported", f"{len(ms.get('supported') or [])} requested mechanic(s) supported")


async def _v_assets(bp):
    reqs = bp.get("asset_requirements") or []
    missing = [r for r in reqs if r.get("required") and r.get("generation_required")]
    if missing:
        return _r("partial", f"{len(missing)}/{len(reqs)} required asset(s) need generation or upload",
                  ["Resolve required assets (reuse, upload, generate or placeholder) before build"])
    return _r("supported", f"All {len(reqs)} asset requirement(s) resolvable from the library")


async def _v_economy(bp):
    hooks = (bp.get("blueprint", {}).get("systems", {}) or {}).get("fire_power_integrations") or []
    if hooks:
        return _r("supported", f"{len(hooks)} Fire Power hook(s) planned — ledger-backed, idempotent")
    return _r("supported", "No economy hooks requested (optional)")


async def _v_save(bp):
    sr = (bp.get("blueprint", {}).get("systems", {}) or {}).get("save_requirements")
    return _r("supported", "Progress saves via game_progress (score, stage, best)"
              + (f" — spec: {sr[:80]}" if sr else ""))


async def _v_multiplayer(bp):
    fam = bp.get("platform", {}).get("analysis", {})
    if fam.get("multiplayer"):
        return _r("missing", "Multiplayer requested — no realtime netcode in any vetted runtime",
                  ["Ship single-player first; MMO-ready foundation is registered for the future"])
    return _r("supported", "Single-player — fully supported")


async def _v_mobile(bp):
    devices = bp.get("blueprint", {}).get("identity", {}).get("target_devices") or []
    if "mobile" in devices:
        return _r("supported", "Touch controls + responsive canvas are engine defaults")
    return _r("supported", "Mobile not targeted (engine still supports it)")


async def _v_desktop(bp):
    return _r("supported", "Keyboard controls + remapping are engine defaults")


async def _v_performance(bp):
    c = int(bp.get("complexity") or 1)
    if c >= 8:
        return _r("partial", f"Complexity {c} — large spec; incremental build + caching recommended",
                  ["Use staged builds; assets stream from R2/CDN"])
    return _r("supported", f"Complexity {c} within the vetted engine performance budget")


async def _v_security(bp):
    return _r("supported", "Games run in sandboxed iframes (allow-scripts, separate origin, "
              "postMessage scores only); rewards are server-authoritative")


VALIDATORS = {"runtime": _v_runtime, "mechanics": _v_mechanics, "assets": _v_assets,
              "economy": _v_economy, "save_system": _v_save, "multiplayer": _v_multiplayer,
              "mobile": _v_mobile, "desktop": _v_desktop, "performance": _v_performance,
              "security": _v_security}


async def run_validation(bp: dict) -> dict:
    keys = list(VALIDATORS)
    results = await asyncio.gather(*(VALIDATORS[k](bp) for k in keys), return_exceptions=True)
    supported, partial, missing, recs = [], [], [], []
    detail = {}
    for k, res in zip(keys, results):
        if isinstance(res, Exception):
            res = _r("missing", f"validator error: {str(res)[:120]}",
                     ["Re-run validation; report if persistent"])
        detail[k] = res
        bucket = {"supported": supported, "partial": partial, "missing": missing}[res["status"]]
        bucket.append({"check": k, "notes": res["notes"]})
        recs.extend(res["recommendations"])
    return {"supported": supported, "partially_supported": partial, "missing": missing,
            "recommendations": recs[:12], "detail": detail,
            "overall": "blocked" if missing else ("valid_with_warnings" if partial else "valid")}
