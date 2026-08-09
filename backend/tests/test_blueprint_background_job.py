import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException
from routers import game_blueprints as api


USER = {"id": "founder-1", "username": "stealth", "role": "founder"}

DOC = {
    "id": "blueprint-1",
    "name": "Test Blueprint",
    "selected_runtime": "top_down",
    "validation": {"status": "passed"},
}


def test_plan_returns_persistent_job_immediately(monkeypatch):
    monkeypatch.setattr(api, "require_founder", lambda current: None)
    monkeypatch.setattr(
        api,
        "rate_limit",
        AsyncMock(return_value={"allowed": True}),
    )
    submit = AsyncMock(return_value={"id": "job-1", "phase": "queued"})
    monkeypatch.setattr(api.job_engine, "submit", submit)

    result = asyncio.run(api.plan({
        "request": "Create exactly five top-down levels",
        "name": "Arcane Hearth",
        "complexity": 10,
        "ai_power": 10,
        "request_id": "request-1",
    }, USER))

    assert result["job_id"] == "job-1"
    assert result["phase"] == "queued"
    submit.assert_awaited_once()
    assert submit.await_args.args[0] == "orai_blueprint_plan"
    assert submit.await_args.kwargs["idem_key"] == "request-1"


def test_background_runner_saves_blueprint(monkeypatch):
    insert = AsyncMock()
    fake_db = SimpleNamespace(
        users=SimpleNamespace(find_one=AsyncMock(return_value=USER)),
        game_blueprints=SimpleNamespace(insert_one=insert),
    )
    monkeypatch.setattr(api, "db", fake_db)
    monkeypatch.setattr(
        api.gb,
        "plan_blueprint",
        AsyncMock(return_value=DOC),
    )
    monkeypatch.setattr(api, "audit", AsyncMock())
    monkeypatch.setattr(api.job_engine, "phase", AsyncMock())

    result = asyncio.run(api._run_blueprint_plan({
        "id": "job-1",
        "user_id": USER["id"],
        "payload": {"request": "Top-down game"},
    }))

    assert result["blueprint"]["id"] == "blueprint-1"
    insert.assert_awaited_once()


def test_compatibility_report_survives_background_job(monkeypatch):
    fake_db = SimpleNamespace(
        users=SimpleNamespace(find_one=AsyncMock(return_value=USER)),
    )
    monkeypatch.setattr(api, "db", fake_db)
    monkeypatch.setattr(
        api.gb,
        "plan_blueprint",
        AsyncMock(side_effect=HTTPException(
            status_code=422,
            detail={
                "error_code": "no_compatible_runtime",
                "message": "No compatible runtime",
            },
        )),
    )
    monkeypatch.setattr(api.job_engine, "phase", AsyncMock())

    result = asyncio.run(api._run_blueprint_plan({
        "id": "job-2",
        "user_id": USER["id"],
        "payload": {"request": "Unsupported game"},
    }))

    assert result["compatibility_error"]["error_code"] == "no_compatible_runtime"
