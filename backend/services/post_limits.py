"""Centralized text-content character limits for posts (thoughts).

Mirrors the frontend helper at `frontend/src/lib/postLimits.js` so the
UI and API can never disagree.

Rules:
    founder (@stealth)  →  2,000
    VIP (is_vip flag)    →    500
    default              →    300

Applies to TEXT content only. Media-only posts skip the limit.
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

POST_LIMITS = {"founder": 2000, "vip": 500, "default": 300}


def character_limit_for(user: Optional[dict]) -> int:
    if not user:
        return POST_LIMITS["default"]
    if (user.get("username") or "").lower() == "stealth" or user.get("is_founder"):
        return POST_LIMITS["founder"]
    if user.get("is_vip"):
        return POST_LIMITS["vip"]
    return POST_LIMITS["default"]


def enforce_post_content_limit(user: dict, content: str) -> None:
    """Raise HTTP 400 if the user exceeded their content character cap."""
    if not content:
        return
    cap = character_limit_for(user)
    if len(content) > cap:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Post is too long — your limit is {cap} characters "
                f"({len(content) - cap} over)."
            ),
        )
