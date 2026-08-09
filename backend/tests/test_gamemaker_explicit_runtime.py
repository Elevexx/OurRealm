import asyncio
import json
from unittest.mock import AsyncMock

from services import game_studio as gs

LIVE_RUNTIMES = (
    "action_rpg_2_5d",
    "turn_based_creature_rpg",
    "platformer",
    "top_down",
    "card_battle",
    "tower_defense",
    "match3",
    "racing",
)


class _FakeEstimates:
    async def insert_one(self, document):
        return None


class _FakeDB:
    game_estimates = _FakeEstimates()


async def _fake_llm(*args, **kwargs):
    # Deliberately return the wrong runtime. The user's explicit selection must win.
    return json.dumps({
        "title": "Runtime Selection Test",
        "concept": "A deliberately quiz-shaped mock plan",
        "runtime": "quiz_adventure",
        "features": [],
        "mechanics": [],
        "stages": 1,
        "substitutions": [],
    })


def test_explicit_gamemaker_runtime_is_authoritative(monkeypatch):
    monkeypatch.setattr(gs, "call_llm", _fake_llm)
    monkeypatch.setattr(gs, "audit", AsyncMock())
    monkeypatch.setattr(gs, "showcase_similarity_for", AsyncMock(return_value=[]))
    monkeypatch.setattr(gs, "db", _FakeDB())

    async def check_all():
        user = {"id": "runtime-test-user", "username": "runtime-test-user"}
        for runtime_id in LIVE_RUNTIMES:
            estimate = await gs.create_estimate({
                "request": "Create a simple quiz game",
                "complexity": 1,
                "ai_power": 1,
                "runtime": runtime_id,
                "supported_controls": "both",
            }, user)
            plan = estimate["plan"]
            classification = plan["classification"]
            assert plan["runtime"] == runtime_id
            assert classification["runtime_id"] == runtime_id
            assert classification["method"] == "explicit_selection"
            assert classification["fallback_used"] is False
            assert classification["fallback_reason"] is None

    asyncio.run(check_all())
