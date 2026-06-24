"""Profile poll widget — visitor voting endpoint.

The poll *content* (question, options) lives inside the user's
`widgets` array (stored on `users.widgets[i]` where `type=="polls"`).
That part is owned by the profile owner and edited via the standard
`PATCH /api/profile/me` flow.

Visitor votes are stored in a separate per-vote collection so that:
  • one vote per (widget, user) is naturally enforced by the unique index
  • the owner's widgets payload stays compact regardless of vote count
  • aggregations are fast and don't bloat the user document.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser

router = APIRouter(prefix="/api/profile-poll", tags=["profile-poll"])


class VotePayload(BaseModel):
    option_id: str = Field(min_length=1, max_length=80)


async def _find_widget(owner_username: str, widget_id: str) -> tuple[dict, dict]:
    user = await db.users.find_one(
        {"username": owner_username.lower()},
        {"_id": 0, "id": 1, "username": 1, "widgets": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Profile not found")
    widget = next(
        (w for w in (user.get("widgets") or [])
         if isinstance(w, dict) and w.get("id") == widget_id
         and w.get("type") == "polls"),
        None,
    )
    if not widget:
        raise HTTPException(status_code=404, detail="Poll widget not found")
    return user, widget


@router.get("/{owner_username}/{widget_id}")
async def get_poll_state(owner_username: str, widget_id: str):
    """Return per-option tallies + the caller's existing pick if any.
    Public — anyone can read; no auth needed."""
    _, widget = await _find_widget(owner_username, widget_id)
    options = widget.get("options") or []
    counts = {opt.get("id"): 0 for opt in options if opt.get("id")}
    async for v in db.profile_poll_votes.find(
        {"widget_id": widget_id}, {"_id": 0, "option_id": 1},
    ):
        if v.get("option_id") in counts:
            counts[v["option_id"]] += 1
    total = sum(counts.values())
    return {
        "widget_id": widget_id,
        "question": widget.get("question") or "",
        "options": [
            {
                "id": opt.get("id"),
                "text": opt.get("text"),
                "votes": counts.get(opt.get("id"), 0),
            }
            for opt in options
        ],
        "total_votes": total,
    }


@router.post("/{owner_username}/{widget_id}/vote")
async def cast_vote(
    owner_username: str,
    widget_id: str,
    payload: VotePayload,
    current: CurrentUser,
):
    """Authenticated viewer casts (or changes) a vote on a poll widget.
    One vote per (widget_id, user_id) is enforced via upsert + unique
    index. Re-voting on the same option is a no-op."""
    _, widget = await _find_widget(owner_username, widget_id)
    valid_ids = {opt.get("id") for opt in (widget.get("options") or [])}
    if payload.option_id not in valid_ids:
        raise HTTPException(status_code=400, detail="Invalid option")
    await db.profile_poll_votes.update_one(
        {"widget_id": widget_id, "user_id": current["id"]},
        {"$set": {
            "widget_id": widget_id,
            "user_id": current["id"],
            "option_id": payload.option_id,
            "voted_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    # Re-fetch the aggregate so the client can update the UI in one round-trip.
    return await get_poll_state(owner_username, widget_id)


async def ensure_indexes():
    """Called once at startup so duplicate votes are impossible at the DB layer."""
    await db.profile_poll_votes.create_index(
        [("widget_id", 1), ("user_id", 1)], unique=True
    )
