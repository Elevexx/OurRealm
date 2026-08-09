import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import resources as route
from services import game_access_ctl, resource_visuals


GAME = {
    "id": "er-test-game",
    "version": 3,
    "resource_manifest": ["fire", "coins", "gems", "stars"],
    "spec": {"stages": [{"pickups": [
        {"id": "coin-a", "kind": "coin", "amount": 2},
        {"id": "gem-a", "kind": "gem", "amount": 1},
    ]}]},
}
USER = {"id": "er-user", "usrname": "er-user"}


class Games:
    async def find_one(self, query, projection=None):
        return GAME if query.get("id") == GAME["id"] else None

def install(monkeypatch, *, rewards=True):
    monkeypatch.setattr(route, "db", SimpleNamespace(games=Games()))
    monkeypatch.setattr(game_access_ctl, "evaluate", AsyncMock(return_value={
        "allowed": True, "view_only": False, "reason": "ok", "message": "ok",
    }))
    monkeypatch.setattr(resource_visuals, "placements_for_surface", AsyncMock(return_value=[
        {"key": "coins", "ops": {"allow_game_rewards": rewards}},
        {"key": "gems", "ops": {"allow_game_rewards": rewards}},
        {"key": "stars", "ops": {"allow_game_rewards": rewards}},
    ]))
    grant = AsyncMock(return_value={"replayed": False})
    monkeypatch.setattr(route.rs, "grant", grant)
    monkeypatch.setattr(route.rs, "balances", AsyncMock(return_value=[
        {"key": "coins", "balance": 12}, {"key": "gems", "balance": 4},
    ]))
    return grant

def claim(body):
    return asyncio.run(route.claim_game_pickup(body, USER))

def test_valid_claim_and_replay_key_are_server_deterministic(monkeypatch):
    grant = install(monkeypatch)
    body = {"game_id": GAME["id"], "stage": 1, "pickup_index": 0, "resource_key": "coins"}
    first = claim(body)
    second = claim(body)
    assert first["ok"] is True and second["ok"] is True
    assert grant.await_count == 2
    assert grant.await_args_list[0].kwargs["idem_key"] == grant.await_args_list[1].kwargs["idem_key"]
    assert grant.await_args_list[0].args[2] == 2

def test_browser_cannot_change_saved_pickup_resource(monkeypatch):
    install(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        claim({"game_id": GAME["id"], "stage": 1, "pickup_index": 0, "resource_key": "gems"})
    assert exc.value.status_code == 400

def test_disabled_game_reward_placement_is_blocked(monkeypatch):
    install(monkeypatch, rewards=False)
    with pytest.raises(HTTPException) as exc:
        claim({"game_id": GAME["id"], "stage": 1, "pickup_index": 0, "resource_key": "coins"})
    assert exc.value.status_code == 403

def test_fire_power_cannot_use_native_resource_route(monkeypatch):
    install(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        claim({"game_id": GAME["id"], "stage": 1, "pickup_index": 0, "resource_key": "fire"})
    assert exc.value.status_code == 400
