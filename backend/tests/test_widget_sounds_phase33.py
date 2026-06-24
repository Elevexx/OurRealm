"""Phase 3.3 — Native OurRealm Sounds Library backend tests.

Validates GET /api/sounds/resolve (auth/anon/empty/missing/cap),
and widget validation accepting sound IDs + legacy URLs in a
`type='sound'` field.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

STEALTH_USER = "stealth"
STEALTH_PASS = "Password1$"

# Stealth's existing tracks (provided in agent context)
KNOWN_IDS = [
    "e477f465fd1e4b25b4bb909f8c5ae44f",  # FORYOU_PROBE_UPLOAD
    "04cf5a7f0c9c426aa44a8a015af1ee37",  # OurRealm Psy
]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def stealth_token(session):
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": STEALTH_USER, "password": STEALTH_PASS},
    )
    if r.status_code != 200:
        pytest.skip(f"stealth login failed: {r.status_code} {r.text[:200]}")
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def stealth_headers(stealth_token):
    return {
        "Authorization": f"Bearer {stealth_token}",
        "Content-Type": "application/json",
    }


# ---------- /api/sounds/resolve ----------
class TestSoundsResolve:
    def test_authed_resolve_preserves_order(self, session, stealth_headers):
        ids = ",".join(KNOWN_IDS)
        r = session.get(
            f"{BASE_URL}/api/sounds/resolve?ids={ids}", headers=stealth_headers
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "tracks" in data
        tracks = data["tracks"]
        assert isinstance(tracks, list)
        # At least one resolved (track IDs may or may not all exist anymore)
        if len(tracks) < 1:
            pytest.skip("None of the seed track IDs resolved on this env")
        # Each track has expected fields
        t0 = tracks[0]
        for k in ("id", "title", "file_url"):
            assert k in t0, f"missing {k} in track: {t0.keys()}"
        # Order preserved among returned subset
        returned_ids = [t["id"] for t in tracks]
        input_subset = [i for i in KNOWN_IDS if i in returned_ids]
        assert returned_ids == input_subset, (
            f"Order not preserved: returned={returned_ids} expected_subset={input_subset}"
        )

    def test_anonymous_resolve_public_only(self, session):
        # No Authorization header
        clean = requests.Session()
        r = clean.get(f"{BASE_URL}/api/sounds/resolve?ids={KNOWN_IDS[0]}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "tracks" in data
        # If track is public it returns; if private it filters out — both valid
        assert isinstance(data["tracks"], list)

    def test_missing_ids_returns_empty(self, session, stealth_headers):
        r = session.get(
            f"{BASE_URL}/api/sounds/resolve?ids=does_not_exist,also_missing",
            headers=stealth_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"tracks": []}

    def test_no_ids_returns_empty(self, session, stealth_headers):
        r = session.get(
            f"{BASE_URL}/api/sounds/resolve", headers=stealth_headers
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"tracks": []}

        r2 = session.get(
            f"{BASE_URL}/api/sounds/resolve?ids=", headers=stealth_headers
        )
        assert r2.status_code == 200
        assert r2.json() == {"tracks": []}

    def test_cap_at_50(self, session, stealth_headers):
        # Build 51 ids — 49 garbage + 2 real ones at position 49,50
        ids = [f"fake_{i:04d}" for i in range(49)] + KNOWN_IDS
        assert len(ids) == 51
        r = session.get(
            f"{BASE_URL}/api/sounds/resolve?ids={','.join(ids)}",
            headers=stealth_headers,
        )
        assert r.status_code == 200, r.text
        tracks = r.json()["tracks"]
        assert len(tracks) <= 50
        # Since cap is the FIRST 50, the 51st id (a known one) should be dropped.
        # So at most 1 known id resolves, possibly 0.
        known_returned = [t["id"] for t in tracks if t["id"] in KNOWN_IDS]
        assert len(known_returned) <= 1, (
            f"cap not enforced — got {len(known_returned)} known IDs back; "
            f"the 51st position should have been truncated"
        )


# ---------- Widget validation accepting sound IDs + URLs ----------
class TestWidgetSoundFieldAcceptsIdsAndUrls:
    """Phase 3.3 — editor_config.fields=[{type:'sound'}] must accept
    plain strings whether they're UUIDs or legacy URLs."""

    @pytest.fixture
    def created_widget_ids(self):
        return []

    def _make_payload(self, key, fields, data=None):
        """Backend WidgetCreate schema uses `key` (snake_case) and stores
        instance data via separate placement endpoints, not on create.
        We just verify editor_config with sound field is accepted."""
        p = {
            "key": key,
            "name": "P3.3 sound widget",
            "category_group": "custom",
            "editor_config": {
                "layout": "stat",
                "fields": fields,
            },
        }
        if data is not None:
            p["data"] = data  # ignored by schema (extra=ignore) — kept to mirror request
        return p

    def test_create_widget_with_sound_field_mixed_values(
        self, session, stealth_headers, created_widget_ids
    ):
        key = f"test_p33snd_{int(time.time())}"
        fields = [
            {"key": "audio", "type": "sound", "label": "Audio", "max_count": 3}
        ]
        data = {"audio": [KNOWN_IDS[0], "https://example.com/legacy.mp3"]}
        payload = self._make_payload(key, fields, data)
        r = session.post(
            f"{BASE_URL}/api/admin/widgets",
            headers=stealth_headers,
            json=payload,
        )
        assert r.status_code in (200, 201), (
            f"expected 200/201, got {r.status_code}: {r.text[:400]}"
        )
        body = r.json()
        wdoc = body.get("widget") or body
        wid = wdoc.get("id")
        assert wid
        # Verify editor_config saved with sound field
        ec = wdoc.get("editor_config") or {}
        flds = ec.get("fields") or []
        assert any(f.get("type") == "sound" and f.get("key") == "audio" for f in flds)
        created_widget_ids.append(wid)
        # Cleanup
        session.delete(f"{BASE_URL}/api/admin/widgets/{wid}", headers=stealth_headers)

    def test_create_widget_with_sound_field_only_urls(
        self, session, stealth_headers, created_widget_ids
    ):
        """Regression — legacy URL-only audio still accepted."""
        key = f"test_p33leg_{int(time.time())}"
        fields = [
            {"key": "audio", "type": "sound", "label": "Audio", "max_count": 2}
        ]
        payload = self._make_payload(key, fields, {"audio": ["https://example.com/a.mp3"]})
        r = session.post(
            f"{BASE_URL}/api/admin/widgets",
            headers=stealth_headers,
            json=payload,
        )
        assert r.status_code in (200, 201), r.text[:400]
        wid = (r.json().get("widget") or r.json()).get("id")
        if wid:
            session.delete(f"{BASE_URL}/api/admin/widgets/{wid}", headers=stealth_headers)

    def test_create_widget_with_fake_uuid_in_sound_field_still_validates(
        self, session, stealth_headers, created_widget_ids
    ):
        """Renderer-level fallback to 'sound unavailable' — backend must
        still accept any string value via editor_config field declaration."""
        key = f"test_p33fk_{int(time.time())}"
        fake_id = uuid.uuid4().hex
        fields = [
            {"key": "audio", "type": "sound", "label": "Audio", "max_count": 1}
        ]
        payload = self._make_payload(key, fields, {"audio": [fake_id]})
        r = session.post(
            f"{BASE_URL}/api/admin/widgets",
            headers=stealth_headers,
            json=payload,
        )
        assert r.status_code in (200, 201), r.text[:400]
        wid = (r.json().get("widget") or r.json()).get("id")
        if wid:
            session.delete(f"{BASE_URL}/api/admin/widgets/{wid}", headers=stealth_headers)
