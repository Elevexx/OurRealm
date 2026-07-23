"""Profile endpoints (/api/profile/*)."""
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db
from core.deps import CurrentUser, OptionalUser
from core.security import hash_password, verify_password
from core.geo import is_valid_zip, resolve_zip
from core.account_lifecycle import (
    mark_self_delete, mark_restore,
    should_hide_from_public, pending_deletion_meta,
)
from core.widget_types import (
    ALLOWED_WIDGET_TYPES, VIDEOS_MAX, MUSIC_SOUNDS_MAX, PODCASTS_SOUNDS_MAX,
    PHOTOS_MAX, notes_limit_for, blog_limit_for,
)
from services.widget_hydration import (
    valid_widget_types, hydrate_registry_widgets,
)
from models.schemas import (
    ProfileUpdate, UsernameChangePayload, PasswordChangePayload, serialize_user,
)

router = APIRouter(prefix="/api/profile", tags=["profile"])

USERNAME_COOLDOWN_DAYS = 7


@router.get("/me")
async def get_my_profile(current: CurrentUser):
    out = serialize_user(current)
    # Hydrate registry widgets so the owner's profile edit page renders
    # the same way a saved-then-refreshed visit would.
    out["widgets"] = await hydrate_registry_widgets(
        current.get("widgets") or [], viewer=current,
    )
    return {"user": out}


@router.patch("/me")
async def update_profile(update: ProfileUpdate, current: CurrentUser):
    # `exclude_unset=True` so callers can explicitly send a field as
    # `null` to clear it (e.g. {"avatar_url": null} for "Remove Photo").
    # `exclude_none=True` would have hidden that signal.
    set_doc = update.model_dump(exclude_unset=True)
    # Validate visibility value
    if "profile_visibility" in set_doc and set_doc["profile_visibility"] not in (
        "public", "friends", "private",
    ):
        raise HTTPException(status_code=400, detail="Invalid visibility")
    # Inner Realm — storage cap 24 (largest selectable size). Members
    # beyond the user's chosen display size stay stored but hidden.
    if "inner_8" in set_doc:
        if len(set_doc["inner_8"]) > 24:
            raise HTTPException(
                status_code=400,
                detail="Remove a friend from your Inner Realm to add a new one",
            )
        # Make sure each entry is actually a friend
        friend_ids = set(current.get("friends") or [])
        for uid in set_doc["inner_8"]:
            if uid not in friend_ids:
                raise HTTPException(status_code=400, detail="Inner Realm entry is not a friend")
    if "inner_realm_size" in set_doc and set_doc["inner_realm_size"] not in (4, 8, 12, 24):
        raise HTTPException(status_code=400, detail="Inner Realm size must be 4, 8, 12 or 24")
    # Phase-2 — ZIP code validation + coords resolution. The 5-digit
    # prefix is geocoded server-side via pgeocode; lat/lng is stored in
    # private fields used by the radius-filter helpers. Pass an empty
    # string to clear the ZIP and its derived coords.
    if "zip_code" in set_doc:
        raw = (set_doc.pop("zip_code") or "").strip()
        if raw == "":
            set_doc["zip_code"] = None
            set_doc["zip_lat"] = None
            set_doc["zip_lng"] = None
        else:
            if not is_valid_zip(raw):
                raise HTTPException(status_code=400, detail="Please enter a valid 5-digit US ZIP code.")
            coords = resolve_zip(raw)
            if coords is None:
                raise HTTPException(status_code=400, detail="Could not locate that ZIP code. Try a different one.")
            set_doc["zip_code"] = raw[:10]
            set_doc["zip_lat"] = coords[0]
            set_doc["zip_lng"] = coords[1]
    if set_doc:
        # Widget validation (Feb 24, 2026 spec):
        #   • drop any widget whose type isn't in the allow-list
        #   • cap notes/blog text length per role (stealth bypasses)
        #   • cap music_sound_ids / podcast_sound_ids at 10
        #   • cap videos array (uploaded + pinned combined) at 4
        # Validation happens BEFORE the customized flag flip so
        # rejected payloads don't accidentally mark the account dirty.
        if "widgets" in set_doc:
            # Save-time allow-list = hardcoded types ∪ live registry keys.
            # Registry widgets (e.g. ``stealth_ai_a1b``) round-trip
            # through the API as ``type == widget.key``.
            allowed = await valid_widget_types()
            cleaned = []
            for w in (set_doc["widgets"] or []):
                if not isinstance(w, dict):
                    continue
                t = w.get("type")
                if t not in allowed:
                    continue
                if t == "notes":
                    limit = notes_limit_for(current)
                    text = w.get("text") or ""
                    if limit is not None and len(text) > limit:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Notes too long (max {limit} characters)",
                        )
                if t == "blog":
                    limit = blog_limit_for(current)
                    text = w.get("text") or ""
                    if limit is not None and len(text) > limit:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Blog too long (max {limit} characters)",
                        )
                if t == "music":
                    ids = w.get("sound_ids") or []
                    if not isinstance(ids, list):
                        ids = []
                    if len(ids) > MUSIC_SOUNDS_MAX:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Music widget supports max {MUSIC_SOUNDS_MAX} sounds",
                        )
                    w["sound_ids"] = ids[:MUSIC_SOUNDS_MAX]
                if t == "podcasts":
                    ids = w.get("sound_ids") or []
                    if not isinstance(ids, list):
                        ids = []
                    if len(ids) > PODCASTS_SOUNDS_MAX:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Podcasts widget supports max {PODCASTS_SOUNDS_MAX} sounds",
                        )
                    w["sound_ids"] = ids[:PODCASTS_SOUNDS_MAX]
                if t == "videos":
                    # `items` is the user-selected mix of uploaded
                    # (kind='upload') and pinned (kind='post') video
                    # entries. The actual upload bytes are persisted by
                    # /api/profile/me/videos/upload — this field just
                    # records what to show + in what order.
                    items = w.get("items") or []
                    if not isinstance(items, list):
                        items = []
                    if len(items) > VIDEOS_MAX:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Videos widget supports max {VIDEOS_MAX} videos",
                        )
                    w["items"] = items[:VIDEOS_MAX]
                if t == "photos":
                    # Photos `items` mirror the videos shape — each is
                    # either `{kind:'upload', url, thumbnail_url?}` from
                    # /api/images/upload or `{kind:'post', post_id, url}`
                    # pinned from an existing image post. Cap is 12 so
                    # the grid stays responsive on phones.
                    items = w.get("items") or []
                    if not isinstance(items, list):
                        items = []
                    if len(items) > PHOTOS_MAX:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Photos widget supports max {PHOTOS_MAX} photos",
                        )
                    w["items"] = items[:PHOTOS_MAX]
                # Strip hydrated registry fields before persistence —
                # we always re-hydrate on read so newly-launched widget
                # config updates take effect immediately.
                if t not in ALLOWED_WIDGET_TYPES:
                    w = {
                        k: v for k, v in w.items()
                        if k not in ("editor_config", "registry_type", "name", "icon", "description")
                    }
                cleaned.append(w)
            set_doc["widgets"] = cleaned

        # Phase Feb-2026: any time the owner saves a `widgets` array
        # from the editor we mark the profile as customized so future
        # default-layout migrations stop touching it. Skip @stealth —
        # the founder layout is preserved verbatim regardless.
        if "widgets" in set_doc:
            uname = (current.get("username") or "").lower()
            if uname != "stealth":
                set_doc["profile_widgets_customized"] = True
        await db.users.update_one({"id": current["id"]}, {"$set": set_doc})
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    out = serialize_user(user)
    out["widgets"] = await hydrate_registry_widgets(
        user.get("widgets") or [], viewer=user,
    )
    return {"user": out}


@router.patch("/username")
async def change_username(payload: UsernameChangePayload, current: CurrentUser):
    new_un = payload.username.lower().strip()
    if new_un == (current.get("username") or "").lower():
        return {"ok": True, "user": serialize_user(current)}
    # Phase B — @support is a protected system account; refuse rename.
    if current.get("is_protected") or (current.get("username") or "").lower() == "support":
        raise HTTPException(status_code=403, detail="This account is protected and cannot be renamed.")
    # Cooldown
    last = current.get("username_changed_at")
    if last:
        try:
            last_dt = datetime.fromisoformat(last)
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            elapsed = datetime.now(timezone.utc) - last_dt
            if elapsed < timedelta(days=USERNAME_COOLDOWN_DAYS):
                days_left = USERNAME_COOLDOWN_DAYS - elapsed.days
                raise HTTPException(
                    status_code=429,
                    detail=f"You can change your username again in {days_left} day(s).",
                )
        except HTTPException:
            raise
        except Exception:
            pass
    # Availability
    if await db.users.find_one({"username": new_un}):
        raise HTTPException(status_code=400, detail="Username already taken")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"username": new_un, "username_changed_at": now_iso}},
    )
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {"ok": True, "user": serialize_user(user)}


@router.post("/change-password")
async def change_password(payload: PasswordChangePayload, current: CurrentUser):
    if not verify_password(payload.current_password, current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {
            "password_hash": hash_password(payload.new_password),
            # Marks the account so the founder-seed migration won't overwrite
            # the password back to the temporary value on the next boot.
            "password_set_by_user": True,
        }},
    )
    return {"ok": True}


@router.post("/by-ids")
async def get_profiles_by_ids(payload: dict):
    """Resolve a list of user_ids → minimal public profile cards.

    Used by the Supabase-powered messenger to display sender info
    (username, name, avatar) for message rows. Accepts at most 200 ids.
    """
    ids = payload.get("ids") or []
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids must be an array")
    ids = [str(x) for x in ids if isinstance(x, str)][:200]
    if not ids:
        return {"users": []}
    out = []
    async for u in db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "avatar_url": 1,
         "is_founder": 1, "is_verified": 1, "is_vip": 1},
    ):
        out.append({
            "id": u.get("id"),
            "username": u.get("username"),
            "name": u.get("name") or u.get("username") or "",
            "avatar_url": u.get("avatar_url"),
            "is_founder": bool(u.get("is_founder")),
            "is_verified": bool(u.get("is_verified")),
            "is_vip": bool(u.get("is_vip")),
        })
    return {"users": out}


@router.get("/by-username/{username}")
async def get_public_profile_by_username(username: str, viewer: OptionalUser):
    user = await db.users.find_one(
        {"username": username.lower()}, {"_id": 0, "password_hash": 0}
    )
    if not user:
        raise HTTPException(status_code=404, detail="Profile not found")
    # Deleted-pending-restore accounts are hidden from every public
    # surface — same as disabled. Renders "User Not Found" client-side.
    if should_hide_from_public(user):
        raise HTTPException(status_code=404, detail="Profile not found")
    out = serialize_user(user)
    # Hydrate registry widgets (Phase 3.5+). Replaces the strict
    # ALLOWED_WIDGET_TYPES filter so launched custom widgets render on
    # public profiles. Registry widgets whose access_groups exclude the
    # viewer are silently dropped inside the hydrator.
    out["widgets"] = await hydrate_registry_widgets(
        user.get("widgets") or [], viewer=viewer,
    )
    out["social"] = user.get("social", {})
    # ── PRIVACY: ZIP code never leaves the owner's session. ──
    # The serializer adds it for /auth/me; we strip here for the public
    # by-username endpoint that anyone can hit.
    out.pop("zip_code", None)
    return {"user": out}


# ────────────────────────────────────────────────────────────────────
# Account deletion / restore (30-day soft-delete lifecycle)
# ────────────────────────────────────────────────────────────────────
class SelfDeletePayload(BaseModel):
    # Acknowledgement string sent from the warning modal. Client sends
    # "DELETE" but anything truthy is accepted server-side — the real
    # protection is the auth gate (you can only delete YOUR account).
    confirm:  Optional[str] = Field(default=None, max_length=20)
    reason:   Optional[str] = Field(default=None, max_length=400)


@router.post("/self-delete")
async def self_delete(payload: SelfDeletePayload, current: CurrentUser):
    """User-initiated soft delete. Account enters
    `deleted_pending_restore` for 30 days; user may sign back in to
    restore. Founder + system accounts cannot self-delete via this
    endpoint (defence-in-depth — UI also hides the button)."""
    uname = (current.get("username") or "").lower()
    if current.get("is_protected") or uname in {"stealth", "support"}:
        raise HTTPException(status_code=403, detail="System accounts cannot self-delete")
    refreshed = await mark_self_delete({**current, "deletion_reason": payload.reason})
    return {
        "ok": True,
        "status": refreshed.get("account_status"),
        "purge_after": refreshed.get("purge_after"),
    }


@router.post("/self-restore")
async def self_restore(current: CurrentUser):
    """User chooses 'Restore Account' on the post-login restore prompt."""
    refreshed = await mark_restore(current, actor=current)
    return {
        "ok":   True,
        "user": serialize_user(refreshed),
    }


@router.get("/deletion-status")
async def deletion_status(current: CurrentUser):
    """Lets the client poll for restore-prompt state. Returns minimal
    metadata when pending-deletion, `null` otherwise."""
    return {"pending_deletion": pending_deletion_meta(current)}
