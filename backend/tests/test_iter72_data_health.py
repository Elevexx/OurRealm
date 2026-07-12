"""Iteration 72 — OurRealm Data Health & Audit + signup hardening + video pipeline.

Covers all /api/admin/data-health/* endpoints and adjacent guarantees from the
review request. All destructive tests use dry-run only; the ONE narrow real
delete is executed elsewhere (in a manual step below) not in this suite.
"""
from __future__ import annotations

import io
import os
import time
import uuid
import struct
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")

FOUNDER = {"email": "stealth", "password": "Password1$"}
MEMBER = {"email": "auditcheckreal", "password": "Password1$"}


# ── Fixtures ────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def founder_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=FOUNDER, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def member_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=MEMBER, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# ── 1. auth/login ───────────────────────────────────────────────────
class TestAuthLogin:
    def test_founder_login_returns_access_token(self, founder_token):
        assert isinstance(founder_token, str) and len(founder_token) > 40


# ── 2. identity + role gate ─────────────────────────────────────────
class TestIdentity:
    def test_founder_identity(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/data-health/identity",
                         headers=hdr(founder_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("env_label") == "preview"
        assert d.get("db_name")
        assert d.get("founder_present") is True
        assert isinstance(d.get("collection_counts"), dict)
        assert isinstance(d.get("real_member_count"), int)

    def test_member_identity_forbidden(self, member_token):
        r = requests.get(f"{BASE_URL}/api/admin/data-health/identity",
                         headers=hdr(member_token), timeout=15)
        assert r.status_code == 403, r.text


# ── 3. synthetic scan classification ────────────────────────────────
class TestSyntheticScan:
    @pytest.fixture(scope="class")
    def scan(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/data-health/synthetic-scan",
                         headers=hdr(founder_token), timeout=60,
                         params={"include_counts": "false"})
        assert r.status_code == 200, r.text
        return r.json()

    def test_totals_structure(self, scan):
        totals = scan["totals"]
        for k in ("real", "likely_synthetic", "confirmed_synthetic", "system_required"):
            assert k in totals
        assert all(r["classification"] in totals for r in scan["rows"])

    def test_stealth_and_support_system_required(self, scan):
        by_username = {r["username"]: r for r in scan["rows"] if r.get("username")}
        assert by_username["stealth"]["classification"] == "system_required"
        # Support may not exist in every DB - only assert if present
        if "support" in by_username:
            assert by_username["support"]["classification"] == "system_required"

    def test_example_com_confirmed_synthetic(self, scan):
        rows = [r for r in scan["rows"]
                if (r.get("email") or "").endswith("@example.com")]
        # Preview DB is expected to have several — but if none, skip
        if not rows:
            pytest.skip("No @example.com users in DB")
        for r in rows:
            assert r["classification"] == "confirmed_synthetic", (
                f"{r.get('username')} email={r.get('email')} classified {r['classification']}")

    def test_test_ourrealm_app_likely_never_confirmed(self, scan):
        rows = [r for r in scan["rows"]
                if (r.get("email") or "").startswith("test_")
                and "@ourrealm.app" in (r.get("email") or "")]
        if not rows:
            pytest.skip("No test_*@ourrealm.app users")
        for r in rows:
            assert r["classification"] in ("likely_synthetic", "real"), r
            assert r["classification"] != "confirmed_synthetic"


# ── 4. Review flip ──────────────────────────────────────────────────
class TestReview:
    def _pick_likely(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/data-health/synthetic-scan",
                         headers=hdr(founder_token), timeout=60,
                         params={"include_counts": "false"})
        for row in r.json()["rows"]:
            if row["classification"] == "likely_synthetic":
                return row["user_id"]
        return None

    def test_review_flip_to_real_and_clear(self, founder_token):
        uid = self._pick_likely(founder_token)
        if not uid:
            pytest.skip("No likely_synthetic user to test review flip")
        # Flip -> real
        r = requests.post(f"{BASE_URL}/api/admin/data-health/review",
                          headers=hdr(founder_token),
                          json={"user_id": uid, "decision": "real"}, timeout=15)
        assert r.status_code == 200, r.text
        # Verify on next scan
        r2 = requests.get(f"{BASE_URL}/api/admin/data-health/synthetic-scan",
                          headers=hdr(founder_token), timeout=60,
                          params={"include_counts": "false"})
        row = next((x for x in r2.json()["rows"] if x["user_id"] == uid), None)
        assert row and row["classification"] == "real"
        # Clear
        r3 = requests.post(f"{BASE_URL}/api/admin/data-health/review",
                           headers=hdr(founder_token),
                           json={"user_id": uid, "decision": "clear"}, timeout=15)
        assert r3.status_code == 200
        r4 = requests.get(f"{BASE_URL}/api/admin/data-health/synthetic-scan",
                          headers=hdr(founder_token), timeout=60,
                          params={"include_counts": "false"})
        row2 = next((x for x in r4.json()["rows"] if x["user_id"] == uid), None)
        assert row2 and row2["classification"] == "likely_synthetic"


# ── 5. Cleanup dry-run ──────────────────────────────────────────────
class TestCleanupDryRun:
    def _pick_confirmed(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/data-health/synthetic-scan",
                         headers=hdr(founder_token), timeout=60,
                         params={"include_counts": "false"})
        for row in r.json()["rows"]:
            if row["classification"] == "confirmed_synthetic":
                return row["user_id"]
        return None

    def _pick_real_or_system(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/data-health/synthetic-scan",
                         headers=hdr(founder_token), timeout=60,
                         params={"include_counts": "false"})
        real = system = None
        for row in r.json()["rows"]:
            if row["classification"] == "real" and not real:
                real = row["user_id"]
            if row["classification"] == "system_required" and not system:
                system = row["user_id"]
        return real, system

    def test_dry_run_confirmed_returns_plan(self, founder_token):
        uid = self._pick_confirmed(founder_token)
        if not uid:
            pytest.skip("No confirmed_synthetic user")
        r = requests.post(f"{BASE_URL}/api/admin/data-health/cleanup/dry-run",
                          headers=hdr(founder_token),
                          json={"user_ids": [uid]}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["plans"] and d["plans"][0]["user_id"] == uid
        assert "proposed_totals_by_collection" in d
        assert d["proposed_totals_by_collection"].get("users") == 1

    def test_dry_run_real_rejected(self, founder_token):
        real, system = self._pick_real_or_system(founder_token)
        target = real or system
        if not target:
            pytest.skip("No real/system user")
        r = requests.post(f"{BASE_URL}/api/admin/data-health/cleanup/dry-run",
                          headers=hdr(founder_token),
                          json={"user_ids": [target]}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert any(x["user_id"] == target for x in d["rejected"]), d


# ── 6. Cleanup execute — confirm-phrase guard only ──────────────────
class TestCleanupConfirmPhrase:
    def test_wrong_phrase_400(self, founder_token):
        r = requests.post(f"{BASE_URL}/api/admin/data-health/cleanup/execute",
                          headers=hdr(founder_token),
                          json={"user_ids": [], "confirm": "OOPS"}, timeout=15)
        assert r.status_code == 400
        assert "DELETE CONFIRMED SYNTHETIC DATA" in r.text


# ── 7. Media audit + repair ─────────────────────────────────────────
class TestMedia:
    def test_media_audit(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/data-health/media-audit",
                         headers=hdr(founder_token), timeout=60,
                         params={"limit": 200})
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("rows"), list)
        assert isinstance(d.get("summary"), dict)

    def test_media_repair_dry_run(self, founder_token):
        r = requests.post(f"{BASE_URL}/api/admin/data-health/media-repair",
                          headers=hdr(founder_token),
                          json={"dry_run": True}, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dry_run"] is True
        assert "repaired" in d and "skipped" in d
        assert isinstance(d["repaired"], list)


# ── 8. Signup health ────────────────────────────────────────────────
class TestSignupHealth:
    def test_signup_health(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/data-health/signup-health",
                         headers=hdr(founder_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("by_category"), dict)
        assert "recent" in d
        # No raw emails; only email_domain + hash
        for row in d["recent"][:20]:
            assert "email" not in row or row.get("email") in (None, "")
            # Presence of email_domain or email_hash indicates redaction
            keys = set(row.keys())
            assert "email_domain" in keys or "email_hash" in keys or not row


# ── 9. Backfill eligibility ─────────────────────────────────────────
class TestBackfill:
    def test_backfill(self, founder_token):
        r = requests.post(f"{BASE_URL}/api/admin/data-health/backfill-eligibility",
                          headers=hdr(founder_token), timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert isinstance(d.get("stamped"), dict)
        assert isinstance(d.get("real_member_count"), int)


# ── 10. Register hardening ──────────────────────────────────────────
class TestRegisterHardening:
    _TOS = {
        "accepted_terms": True,
        "accepted_privacy": True,
        "accepted_conditions": True,
        "age_confirmed_13": True,
    }

    def test_invalid_email_422(self):
        r = requests.post(f"{BASE_URL}/api/auth/register", timeout=15, json={
            "email": "not-an-email", "username": f"tst{uuid.uuid4().hex[:6]}",
            "password": "Password1$", "name": "Nope", **self._TOS,
        })
        assert r.status_code == 422, r.text
        body = r.json()
        # Should contain friendly message string
        assert "valid email" in str(body).lower(), body

    def test_duplicate_email_400(self):
        r = requests.post(f"{BASE_URL}/api/auth/register", timeout=15, json={
            "email": "slopestyle2022@gmail.com",
            "username": f"tst{uuid.uuid4().hex[:6]}",
            "password": "Password1$", "name": "Dup", **self._TOS,
        })
        assert r.status_code in (400, 409), r.text
        assert "already registered" in r.text.lower() or "already" in r.text.lower()

    def test_duplicate_username_400(self):
        r = requests.post(f"{BASE_URL}/api/auth/register", timeout=15, json={
            "email": f"unique_{uuid.uuid4().hex[:8]}@gmail.com",
            "username": "stealth",
            "password": "Password1$", "name": "DupU", **self._TOS,
        })
        assert r.status_code in (400, 409), r.text
        assert "unavailable" in r.text.lower() or "taken" in r.text.lower() or "already" in r.text.lower()

    def test_valid_signup_analytics_eligible(self, founder_token):
        uname = f"aud72{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/auth/register", timeout=20, json={
            "email": f"{uname}@gmail.com", "username": uname,
            "password": "Password1$", "name": "Aud Iter72", **self._TOS,
        })
        assert r.status_code in (200, 201), r.text
        # Verify via scan
        time.sleep(0.5)
        r2 = requests.get(f"{BASE_URL}/api/admin/data-health/synthetic-scan",
                          headers=hdr(founder_token), timeout=60,
                          params={"include_counts": "false"})
        row = next((x for x in r2.json()["rows"] if x.get("username") == uname), None)
        assert row is not None
        assert row["classification"] == "real"


# ── 11. Admin analytics (real filter) ───────────────────────────────
class TestAdminAnalyticsRealFilter:
    def test_admin_analytics_lower_than_users(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/analytics",
                         headers=hdr(founder_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # find some "total members" key
        candidates = [d.get("total_members"), d.get("real_member_count"),
                      d.get("totals", {}).get("real_members"),
                      d.get("totals", {}).get("total_members"),
                      d.get("users", {}).get("total")]
        total = next((c for c in candidates if isinstance(c, int)), None)
        assert total is not None, f"cannot find total members key: {d}"
        # compare with raw users count from identity
        i = requests.get(f"{BASE_URL}/api/admin/data-health/identity",
                         headers=hdr(founder_token), timeout=15).json()
        raw_users = i["collection_counts"].get("users") or 0
        assert total <= raw_users
        assert total < raw_users, f"analytics total {total} should be strictly less than raw users {raw_users}"


# ── 12. Video pipeline ──────────────────────────────────────────────
def _min_mp4_bytes() -> bytes:
    """Return a minimally-sized 'MP4' with proper ftyp box.

    Not a fully valid stream but the endpoint should accept + store bytes,
    and range reads should still work against the stored blob.
    """
    ftyp = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    mdat_size = 2048
    mdat = struct.pack(">I", mdat_size + 8) + b"mdat" + b"\x00" * mdat_size
    return ftyp + mdat


class TestVideoPipeline:
    def test_upload_and_range(self, founder_token):
        content = _min_mp4_bytes()
        files = {"file": ("tiny.mp4", content, "video/mp4")}
        r = requests.post(f"{BASE_URL}/api/videos/upload",
                          headers=hdr(founder_token),
                          files=files, timeout=60)
        # some backends return 200 or 201
        assert r.status_code in (200, 201), r.text
        d = r.json()
        url = d.get("url") or d.get("video_url") or (d.get("video") or {}).get("url")
        assert url, f"no url in {d}"
        assert url.startswith("/api/media/videos/"), url
        # Range request (follow redirects to R2)
        r2 = requests.get(f"{BASE_URL}{url}",
                          headers={"Range": "bytes=0-1023"},
                          allow_redirects=True, timeout=30)
        assert r2.status_code == 206, f"status={r2.status_code} headers={dict(r2.headers)}"
        ct = r2.headers.get("Content-Type", "")
        assert "video/mp4" in ct or "mp4" in ct, ct
