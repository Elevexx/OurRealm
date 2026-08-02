"""Provider-agnostic LLM router — AI Power levels 1-10 map to REAL model
routing, refinement passes and token budgets via the Emergent universal key
(emergentintegrations). Lower power = fast/cheap models, higher = strongest
models + deeper review. Falls back to OpenAI gpt-5.4 if a provider fails."""
import logging
import os
import uuid

from dotenv import load_dotenv

load_dotenv()
log = logging.getLogger("ourrealm.llm.router")

# level: (provider, model, passes, max_tokens, est_cost_per_pass, label)
AI_POWER_TIERS = {
    1: ("openai", "gpt-5-nano", 1, 3000, 0.01, "Fast & light"),
    2: ("openai", "gpt-5.4-mini", 1, 4000, 0.02, "Efficient"),
    3: ("openai", "gpt-5.4-mini", 2, 5000, 0.02, "Improved planning"),
    4: ("openai", "gpt-5.4-mini", 2, 6000, 0.03, "Planning + review"),
    5: ("openai", "gpt-5.4", 2, 6000, 0.05, "Strong reasoning"),
    6: ("openai", "gpt-5.4", 3, 7000, 0.05, "Deep QA"),
    7: ("anthropic", "claude-sonnet-4-6", 3, 8000, 0.08, "Advanced design"),
    8: ("anthropic", "claude-sonnet-4-6", 3, 9000, 0.08, "Rich iterations"),
    9: ("anthropic", "claude-sonnet-5", 4, 10000, 0.12, "Highest intelligence"),
    10: ("anthropic", "claude-sonnet-5", 4, 12000, 0.15, "Maximum depth"),
}


def tier(power: int) -> dict:
    p = min(max(int(power or 5), 1), 10)
    provider, model, passes, max_tokens, cost, label = AI_POWER_TIERS[p]
    return {"power": p, "provider": provider, "model": model, "passes": passes,
            "max_tokens": max_tokens, "est_cost_per_pass": cost, "label": label,
            "est_cost": round(cost * passes, 2)}


async def call_llm(system: str, user: str, *, power: int = 5, json_mode: bool = False,
                   max_tokens: int = None) -> str:
    """One-shot completion routed by AI Power. Background-job friendly."""
    t = tier(power)
    try:
        return await _call(t["provider"], t["model"], system, user,
                           max_tokens or t["max_tokens"], json_mode)
    except Exception as e:  # noqa: BLE001
        log.warning("llm %s/%s failed (%s) — falling back to openai/gpt-5.4", t["provider"], t["model"], e)
        return await _call("openai", "gpt-5.4", system, user, max_tokens or t["max_tokens"], json_mode)


async def _call(provider, model, system, user, max_tokens, json_mode):
    if provider == "openai":
        from services.chat_conversations import call_openai_chat
        res = await call_openai_chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            model=model, max_tokens=max_tokens, json_mode=json_mode)
        return res.get("content") or ""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY missing")
    sys_msg = system + ("\nReply ONLY with valid JSON, no prose, no code fences." if json_mode else "")
    chat = LlmChat(api_key=key, session_id=uuid.uuid4().hex,
                   system_message=sys_msg).with_model(provider, model)
    resp = await chat.send_message(UserMessage(text=user))
    out = str(resp or "").strip()
    if json_mode and out.startswith("```"):
        out = out.strip("`").lstrip("json").strip()
    return out
