"""Tests for the new 'xl' widget size + back-compat with legacy 'wide'/'tall'."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
REALM_ID = "dj"


@pytest.fixture(scope="module")
def founder_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "stealth", "password": "Password1$"},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth_headers(founder_token):
    return {"Authorization": f"Bearer {founder_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def existing_widget_id(auth_headers):
    """Pick the first available widget on /realms/dj (avoid creating noise)."""
    r = requests.get(
        f"{BASE_URL}/api/communities/realm/{REALM_ID}/widgets",
        headers=auth_headers,
        timeout=15,
    )
    assert r.status_code == 200
    widgets = r.json().get("widgets", [])
    assert widgets, "DJ realm should have at least one seed widget"
    return widgets[0]["id"], widgets[0].get("size", "medium")


def _patch_size(auth_headers, wid, size):
    return requests.patch(
        f"{BASE_URL}/api/communities/realm/{REALM_ID}/widgets/{wid}",
        headers=auth_headers,
        json={"size": size},
        timeout=15,
    )


class TestWidgetSizeValidation:
    def test_xl_accepted(self, auth_headers, existing_widget_id):
        wid, original = existing_widget_id
        try:
            r = _patch_size(auth_headers, wid, "xl")
            assert r.status_code == 200, f"xl size rejected: {r.status_code} {r.text}"
            # Verify persistence
            g = requests.get(
                f"{BASE_URL}/api/communities/realm/{REALM_ID}/widgets",
                headers=auth_headers,
                timeout=15,
            )
            assert g.status_code == 200
            saved = next((w for w in g.json()["widgets"] if w["id"] == wid), None)
            assert saved and saved["size"] == "xl"
        finally:
            _patch_size(auth_headers, wid, original)

    def test_invalid_size_rejected(self, auth_headers, existing_widget_id):
        wid, _ = existing_widget_id
        r = _patch_size(auth_headers, wid, "banana")
        assert r.status_code == 400, f"Expected 400 for banana, got {r.status_code} {r.text}"

    def test_legacy_wide_still_accepted(self, auth_headers, existing_widget_id):
        wid, original = existing_widget_id
        try:
            r = _patch_size(auth_headers, wid, "wide")
            assert r.status_code == 200, f"Legacy 'wide' rejected: {r.text}"
        finally:
            _patch_size(auth_headers, wid, original)

    def test_legacy_tall_still_accepted(self, auth_headers, existing_widget_id):
        wid, original = existing_widget_id
        try:
            r = _patch_size(auth_headers, wid, "tall")
            assert r.status_code == 200, f"Legacy 'tall' rejected: {r.text}"
        finally:
            _patch_size(auth_headers, wid, original)

    def test_all_modern_sizes(self, auth_headers, existing_widget_id):
        wid, original = existing_widget_id
        try:
            for sz in ("small", "medium", "large", "xl"):
                r = _patch_size(auth_headers, wid, sz)
                assert r.status_code == 200, f"size '{sz}' rejected: {r.text}"
        finally:
            _patch_size(auth_headers, wid, original)
