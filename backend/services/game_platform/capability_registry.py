"""AI Capability Registry — provider-neutral generation with graceful
degradation. Selects the best CONNECTED provider per capability and
reports honest degradation when none is available."""
import os

from services.game_platform.registry_core import Registry

CAPABILITY_SEED = {
    "text": {"label": "Text generation",
             "providers": [{"id": "openai_direct", "env": "OPENAI_API_KEY", "priority": 1},
                           {"id": "emergent_universal", "env": "EMERGENT_LLM_KEY", "priority": 2}]},
    "image": {"label": "Image generation",
              "providers": [{"id": "openai_gpt_image", "env": "OPENAI_API_KEY", "priority": 1},
                            {"id": "emergent_universal", "env": "EMERGENT_LLM_KEY", "priority": 2}]},
    "video": {"label": "Video generation",
              "providers": [{"id": "openai_sora", "env": "OPENAI_API_KEY", "priority": 1}],
              "degrade_to": "manual upload / external URL / placeholder"},
    "audio": {"label": "Audio / SFX",
              "providers": [{"id": "openai_tts", "env": "OPENAI_API_KEY", "priority": 1}],
              "degrade_to": "reuse Sounds library"},
    "music": {"label": "Music", "providers": [],
              "degrade_to": "reuse Sounds library — no music provider connected"},
    "voice": {"label": "Voice / narration",
              "providers": [{"id": "openai_tts", "env": "OPENAI_API_KEY", "priority": 1}],
              "degrade_to": "text captions"},
    "threed": {"label": "3D models", "providers": [],
               "degrade_to": "2.5D sprite presentation — no 3D provider connected"},
}
capability_registry = Registry("ai_capabilities", CAPABILITY_SEED,
                               description="Generation capabilities → connected providers")


def _key_ok(env: str) -> bool:
    v = (os.environ.get(env) or "").strip()
    return bool(v) and v.isascii()


async def select_provider(capability: str) -> dict:
    entry = await capability_registry.get(capability)
    if not entry:
        return {"capability": capability, "provider": None, "degraded": True,
                "reason": "unknown capability"}
    d = entry["definition"]
    for p in sorted(d.get("providers") or [], key=lambda x: x.get("priority", 9)):
        if _key_ok(p["env"]):
            return {"capability": capability, "provider": p["id"], "degraded": False,
                    "reason": "connected + key valid"}
    return {"capability": capability, "provider": None, "degraded": True,
            "reason": d.get("degrade_to") or "no provider connected"}


async def capability_status() -> list:
    out = []
    for cap in (await capability_registry.all()):
        out.append(await select_provider(cap))
    return out
