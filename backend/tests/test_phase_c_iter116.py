"""Phase C iter116 - RPG/Racing/Farming/City Builder runtimes + Universal Editor quick actions.

Tests backend: /api/games hub, meta PATCH, reroll-audio, export/import, version duplicate, auth guard.
STRICT: no approve, no regen-cover, no new estimates, do not touch 11 published showcase covers.
"""
import os
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
GID = "e23dde5033b341a69a8b8c45d7dc2223"  # Emberbound Chronicles (RPG)


@pytest.fixture(scope="module")
def founder():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "stealth", "password": "Password1$"})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ─── Public hub ─────────────────────────────────────────────
def test_public_games_returns_11_published(founder):
    r = founder.get(f"{BASE}/api/games")
    assert r.status_code == 200
    data = r.json()
    items = data if isinstance(data, list) else (data.get("games") or data.get("items") or [])
    print(f"total items={len(items)}")
    # Endpoint filters status=published server side; validation game must NOT appear
    ids = [g.get("id") for g in items]
    assert GID not in ids, "Validation game leaked into public hub"
    assert len(items) == 11, f"expected 11 published games, got {len(items)}"


# ─── Auth guard on new admin endpoints ─────────────────────
def test_unauth_admin_endpoints_401():
    anon = requests.Session()
    endpoints = [
        ("PATCH", f"/api/admin/games/{GID}/meta", {"title": "x"}),
        ("POST", f"/api/admin/games/{GID}/reroll-audio", {"kind": "music"}),
        ("GET", f"/api/admin/games/{GID}/export", None),
        ("POST", f"/api/admin/games/import", {"export": {}}),
        ("POST", f"/api/admin/games/{GID}/versions/0/duplicate", {}),
    ]
    for method, path, body in endpoints:
        r = anon.request(method, f"{BASE}{path}", json=body)
        assert r.status_code in (401, 403), f"{method} {path} expected 401/403 got {r.status_code}"


# ─── Meta PATCH ────────────────────────────────────────────
def test_meta_patch_and_version_bump(founder):
    r0 = founder.get(f"{BASE}/api/admin/games/{GID}")
    assert r0.status_code == 200
    g0 = r0.json().get("game") or r0.json()
    v0 = int(g0.get("version") or 1)
    versions0 = len(g0.get("versions") or [])
    original_title = g0.get("title")
    print(f"before: version={v0} versions_len={versions0} title={original_title}")

    payload = {"title": "Emberbound Chronicles", "description": "updated desc for test",
               "genre": "Creature RPG", "labels": ["founder_validation", "phase_b"], "complexity": 2}
    r = founder.patch(f"{BASE}/api/admin/games/{GID}/meta", json=payload)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert body.get("ok") is True
    v1 = int(body.get("version"))
    assert v1 == v0 + 1

    r2 = founder.get(f"{BASE}/api/admin/games/{GID}")
    g1 = r2.json().get("game") or r2.json()
    assert g1.get("description") == "updated desc for test"
    assert g1.get("genre") == "Creature RPG"
    assert "founder_validation" in (g1.get("labels") or [])
    assert int(g1.get("complexity")) == 2
    assert len(g1.get("versions") or []) == versions0 + 1

    # Restore title done above (title already "Emberbound Chronicles")
    print(f"after: version={g1.get('version')} versions_len={len(g1.get('versions') or [])}")


# ─── Reroll audio (music + sfx) ────────────────────────────
def test_reroll_audio_music_and_sfx(founder):
    r0 = founder.get(f"{BASE}/api/admin/games/{GID}")
    g0 = r0.json().get("game") or r0.json()
    v0 = int(g0.get("version") or 1)

    r1 = founder.post(f"{BASE}/api/admin/games/{GID}/reroll-audio", json={"kind": "music"})
    assert r1.status_code == 200, r1.text[:200]
    b1 = r1.json()
    assert b1.get("ok") and b1.get("kind") == "music" and b1.get("variant")

    r2 = founder.post(f"{BASE}/api/admin/games/{GID}/reroll-audio", json={"kind": "sfx"})
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2.get("ok") and b2.get("kind") == "sfx"

    r3 = founder.get(f"{BASE}/api/admin/games/{GID}")
    g1 = r3.json().get("game") or r3.json()
    assert int(g1.get("version")) == v0 + 2
    spec = g1.get("spec") or {}
    assert spec.get("audio_variant_music") == b1["variant"]
    assert spec.get("audio_variant_sfx") == b2["variant"]

    # Bad kind → 400
    rb = founder.post(f"{BASE}/api/admin/games/{GID}/reroll-audio", json={"kind": "voice"})
    assert rb.status_code == 400


# ─── Export → Import → Delete cleanup ──────────────────────
def test_export_import_and_cleanup(founder):
    r = founder.get(f"{BASE}/api/admin/games/{GID}/export")
    assert r.status_code == 200
    body = r.json()
    assert body.get("format") == "ourrealm-game-v1"
    exp = body.get("export")
    assert isinstance(exp, dict) and exp.get("title") and exp.get("spec")

    r2 = founder.post(f"{BASE}/api/admin/games/import", json={"export": exp})
    assert r2.status_code == 200, r2.text[:300]
    body2 = r2.json()
    new_id = body2.get("game_id")
    assert new_id and new_id != GID
    assert body2.get("title") == exp["title"]

    # Verify new copy is approved
    r3 = founder.get(f"{BASE}/api/admin/games/{new_id}")
    g_new = r3.json().get("game") or r3.json()
    assert g_new.get("status") == "approved"
    assert g_new.get("title") == exp["title"]

    # Cleanup: delete imported copy via action endpoint
    rd = founder.post(f"{BASE}/api/admin/games/{new_id}/action", json={"action": "delete"})
    assert rd.status_code in (200, 204), f"delete cleanup failed: {rd.status_code} {rd.text[:200]}"


# ─── Version duplicate ─────────────────────────────────────
def test_duplicate_version(founder):
    r0 = founder.get(f"{BASE}/api/admin/games/{GID}")
    g0 = r0.json().get("game") or r0.json()
    v0 = int(g0.get("version") or 1)
    versions = g0.get("versions") or []
    assert len(versions) > 0, "need at least one snapshot; earlier tests should have created one"

    r = founder.post(f"{BASE}/api/admin/games/{GID}/versions/0/duplicate", json={})
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert body.get("ok") and int(body.get("version")) == v0 + 1
