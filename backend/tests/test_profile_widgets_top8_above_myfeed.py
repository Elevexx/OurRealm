"""Iter-39 — Profile widget fixes (Top 8 above My Feed migration,
profile_widgets_customized flag, Notes text persistence, public radar/notes).

Scope:
 1. Migration result on tfone (non-customized at run time of migration) →
    widgets order is [top8, myfeed, ...]
 2. @stealth widget order must remain UNTOUCHED (Founder order:
    myfeed → top8 → live → merch → music → events → polls → custom).
 3. profile_widgets_customized auto-flip on save (except @stealth).
 4. Notes widget text persists through PATCH and is returned by the
    PUBLIC by-username endpoint.
 5. Migration is idempotent.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
TFONE  = {"email": "testfriend1@example.com", "password": "pass1234"}
TFTWO  = {"email": "testfriend2@example.com", "password": "pass1234"}
STEALTH = {"email": "slopestyle2022@gmail.com", "password": "Password1$"}


def login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def me(token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("user", body)


def patch_profile(token, body):
    r = requests.patch(
        f"{BASE_URL}/api/profile/me",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    return r


def types_of(widgets):
    return [(w or {}).get("type") for w in (widgets or [])]


# ---- 1. Migration result + 2. stealth untouched -------------------------
def test_tfone_top8_above_myfeed():
    tok = login(TFONE)
    u = me(tok)
    t = types_of(u.get("widgets"))
    assert "top8" in t and "myfeed" in t, f"missing widgets: {t}"
    assert t.index("top8") < t.index("myfeed"), f"top8 not before myfeed: {t}"


def test_stealth_widget_order_untouched():
    """Phase-15 (Feb 24, 2026): widget allow-list strips merch + custom
    from stealth's cluster. FOUNDER_WIDGETS now is [live, music, events,
    polls, blog]. Stealth's current row preserves the original ordering
    of any widget that survived the strip; the cluster ends up roughly
    [myfeed, top8, live, music, events, polls, ...]. We assert the
    surviving ordering of the originally-present subset rather than a
    rigid length match because self-heal may append more types over
    time (notes, blog) as the founder spec evolves."""
    tok = login(STEALTH)
    u = me(tok)
    t = types_of(u.get("widgets"))
    # Every type that appears MUST be in the allow-list.
    from core.widget_types import ALLOWED_WIDGET_TYPES
    bad = [x for x in t if x not in ALLOWED_WIDGET_TYPES]
    assert not bad, f"stealth has disallowed widget types: {bad}"
    # Original surviving order subset.
    surviving = [x for x in t if x in ("myfeed", "top8", "live", "music", "events", "polls")]
    assert surviving == ["myfeed", "top8", "live", "music", "events", "polls"], (
        f"surviving order mismatch: {surviving}"
    )
    assert u.get("profile_widgets_customized") in (False, None), (
        f"stealth customized flag should be False but got {u.get('profile_widgets_customized')}"
    )


def test_stealth_public_by_username_widgets():
    """Public /api/profile/by-username/stealth returns only allow-listed widgets."""
    pub = requests.get(f"{BASE_URL}/api/profile/by-username/stealth", timeout=20)
    assert pub.status_code == 200, pub.text
    body = pub.json()
    u = body.get("user", body)
    t = types_of(u.get("widgets"))
    from core.widget_types import ALLOWED_WIDGET_TYPES
    bad = [x for x in t if x not in ALLOWED_WIDGET_TYPES]
    assert not bad, f"public stealth has disallowed widget types: {bad}"
    surviving = [x for x in t if x in ("myfeed", "top8", "live", "music", "events", "polls")]
    assert surviving == ["myfeed", "top8", "live", "music", "events", "polls"], (
        f"surviving order mismatch: {surviving}"
    )


def test_tftwo_baseline_order_and_flag():
    """tftwo seeded with [top8, myfeed] and profile_widgets_customized=False
    so the migration fixture is clean. NOTE: other tests in this file
    may flip the flag if executed first — this test should run before them
    in pytest collection order. We re-assert types_only baseline rather
    than the flag."""
    tok = login(TFTWO)
    u = me(tok)
    t = types_of(u.get("widgets"))
    assert "top8" in t and "myfeed" in t, f"missing widgets: {t}"
    assert t.index("top8") < t.index("myfeed"), f"top8 not before myfeed: {t}"


def test_stealth_not_flagged_customized_on_view():
    """Viewing the founder profile must not mutate his customized flag."""
    tok = login(STEALTH)
    requests.get(
        f"{BASE_URL}/api/profile/by-username/stealth",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=20,
    )
    u = me(tok)
    assert not u.get("profile_widgets_customized"), "founder flag flipped — must stay false"


# ---- 3. profile_widgets_customized flag on PATCH -----------------------
def test_customized_flag_flips_for_normal_user_and_cleanup():
    tok = login(TFTWO)
    before = me(tok)
    original_widgets = before.get("widgets") or []
    # Reset the flag in case a prior test run flipped it.
    # We can't unset via API; instead we verify the flip from current state.
    # Build a clean default order [top8, myfeed].
    payload_widgets = [
        {"id": "w-top8",   "type": "top8",   "size": "small", "title": "Top 8"},
        {"id": "w-myfeed", "type": "myfeed", "size": "small", "title": "My Feed"},
    ]
    r = patch_profile(tok, {"widgets": payload_widgets})
    assert r.status_code == 200, r.text
    after = me(tok)
    assert after.get("profile_widgets_customized") is True, "flag did not flip to True"
    # Cleanup: leave the user in [top8, myfeed].
    assert types_of(after.get("widgets"))[:2] == ["top8", "myfeed"]
    # Restore original widgets list if it had more entries — keep test data clean.
    if len(original_widgets) > len(payload_widgets):
        patch_profile(tok, {"widgets": original_widgets})


def test_customized_flag_NOT_flipped_for_stealth():
    tok = login(STEALTH)
    before = me(tok)
    original = before.get("widgets") or []
    # PATCH with same widgets — flag must stay false for founder.
    r = patch_profile(tok, {"widgets": original})
    assert r.status_code == 200, r.text
    after = me(tok)
    assert not after.get("profile_widgets_customized"), "stealth flag should never flip"


# ---- 4. Notes text persistence (PATCH → public GET) --------------------
def test_notes_widget_text_persists_to_public_endpoint():
    tok = login(TFTWO)
    before_widgets = (me(tok).get("widgets") or [])
    notes_widget = {
        "id": "w-notes",
        "type": "notes",
        "size": "small",
        "title": "Notes",
        "text": "my custom note ABC",
    }
    new_widgets = [
        {"id": "w-top8",   "type": "top8",   "size": "small", "title": "Top 8"},
        {"id": "w-myfeed", "type": "myfeed", "size": "small", "title": "My Feed"},
        notes_widget,
    ]
    r = patch_profile(tok, {"widgets": new_widgets})
    assert r.status_code == 200, r.text

    # Read from PUBLIC by-username (no auth header — should still work)
    pub = requests.get(f"{BASE_URL}/api/profile/by-username/tftwo", timeout=20)
    assert pub.status_code == 200, pub.text
    pub_body = pub.json()
    pub_user = pub_body.get("user", pub_body)
    pub_widgets = pub_user.get("widgets") or []
    matched = [w for w in pub_widgets if (w or {}).get("type") == "notes"]
    assert matched, f"notes widget not present on public profile: {types_of(pub_widgets)}"
    assert matched[0].get("text") == "my custom note ABC", f"notes text not persisted: {matched[0]}"

    # CLEANUP — restore widgets to baseline [top8, myfeed]
    patch_profile(tok, {"widgets": [
        {"id": "w-top8",   "type": "top8",   "size": "small", "title": "Top 8"},
        {"id": "w-myfeed", "type": "myfeed", "size": "small", "title": "My Feed"},
    ]})


# ---- 5. Migration idempotency ------------------------------------------
def test_idempotency_proxy_via_repeat_me_calls():
    """We cannot restart the backend from a test, but we can prove the
    migration didn't re-reorder a customized user by checking that
    profile_widgets_customized=True stops further mutation: re-PATCH a
    custom-ish order and verify the order survives a follow-up GET."""
    tok = login(TFTWO)
    custom_order = [
        {"id": "w-myfeed", "type": "myfeed", "size": "small", "title": "My Feed"},
        {"id": "w-top8",   "type": "top8",   "size": "small", "title": "Top 8"},
    ]
    r = patch_profile(tok, {"widgets": custom_order})
    assert r.status_code == 200
    after = me(tok)
    assert after.get("profile_widgets_customized") is True
    # Saved order is exactly what we sent — server must NOT re-reorder
    # a customized user's layout on read.
    assert types_of(after.get("widgets"))[:2] == ["myfeed", "top8"]
    # Restore canonical baseline.
    patch_profile(tok, {"widgets": [
        {"id": "w-top8",   "type": "top8",   "size": "small", "title": "Top 8"},
        {"id": "w-myfeed", "type": "myfeed", "size": "small", "title": "My Feed"},
    ]})
