"""Tests for the Realm Pulse founder analytics + heartbeat endpoints.

Covers:
- POST /api/analytics/heartbeat (auth gate + idempotency)
- GET  /api/admin/realm-pulse/overview (founder gate + payload schema)
- GET  /api/admin/realm-pulse/investor-snapshot
- POST /api/admin/realm-pulse/refresh-snapshot
- GET  /api/admin/realm-pulse/export?format=csv|pdf|xlsx
- Non-founder 403
- Regression: storage status, interest-cards, copyright queue
"""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

FOUNDER = {"email": "stealth", "password": "Password1$"}
USER = {"email": "tfone", "password": "pass1234"}


# ---------------- helpers ----------------
def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def founder_token():
    return _login(FOUNDER)


@pytest.fixture(scope="module")
def user_token():
    return _login(USER)


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# =====================================================================
# Heartbeat
# =====================================================================
class TestHeartbeat:
    def test_heartbeat_unauthenticated_rejected(self):
        r = requests.post(f"{BASE_URL}/api/analytics/heartbeat", json={"kind": "feed_view"})
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_heartbeat_authed_user_ok(self, user_token):
        r = requests.post(
            f"{BASE_URL}/api/analytics/heartbeat",
            headers=_h(user_token),
            json={"kind": "feed_view"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", body["day"])
        # today's UTC date
        assert body["day"] == datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def test_heartbeat_idempotent_same_day(self, user_token):
        r1 = requests.post(f"{BASE_URL}/api/analytics/heartbeat",
                           headers=_h(user_token), json={"kind": "feed_view"})
        r2 = requests.post(f"{BASE_URL}/api/analytics/heartbeat",
                           headers=_h(user_token), json={"kind": "feed_view"})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["day"] == r2.json()["day"]


# =====================================================================
# Overview
# =====================================================================
class TestOverview:
    def test_founder_overview_full_schema(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/overview?window=7d",
            headers=_h(founder_token),
        )
        assert r.status_code == 200, r.text
        p = r.json()
        # top-level
        for k in ["dau", "wau", "mau", "dau_mau_ratio_pct",
                  "retention", "engagement", "growth", "community", "top_insights"]:
            assert k in p, f"missing top key {k}"
        # retention
        for k in ["d1", "d7", "d30", "cohort_size"]:
            assert k in p["retention"], f"retention.{k} missing"
        # engagement
        for k in ["avg_posts_per_user", "avg_messages_per_user", "avg_sounds_per_user",
                  "avg_comments_per_user", "avg_actions_per_user", "avg_sessions_per_day"]:
            assert k in p["engagement"], f"engagement.{k} missing"
        # growth
        for k in ["new_users", "prev_period_new_users", "user_growth_rate_pct",
                  "referral_invites_sent", "referral_invites_accepted",
                  "invite_acceptance_pct", "viral_coefficient"]:
            assert k in p["growth"], f"growth.{k} missing"
        # community
        for k in ["posts_created", "messages_sent", "sounds_uploaded",
                  "comments_created", "groups_created", "total_content"]:
            assert k in p["community"], f"community.{k} missing"
        # top_insights
        for k in ["fastest_growing_interest", "most_selected_interest",
                  "top_creator_post_count", "highest_engagement_day"]:
            assert k in p["top_insights"], f"top_insights.{k} missing"

    def test_non_founder_overview_403(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/overview?window=7d",
            headers=_h(user_token),
        )
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"
        body = r.json()
        # FastAPI error envelope
        detail = body.get("detail") or body.get("message") or ""
        assert "Founder" in str(detail) or "founder" in str(detail).lower()


# =====================================================================
# Investor snapshot
# =====================================================================
class TestInvestorSnapshot:
    VALID_STATUS = {"Early traction", "Strong engagement", "High growth", "Needs attention"}

    def test_founder_investor_snapshot(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/investor-snapshot?window=30d",
            headers=_h(founder_token),
        )
        assert r.status_code == 200, r.text
        p = r.json()
        for k in ["dau", "wau", "mau", "dau_mau_ratio_pct",
                  "user_growth_rate_pct", "d30_retention_pct", "status"]:
            assert k in p, f"missing {k}"
        assert p["status"] in self.VALID_STATUS, f"unexpected status {p['status']}"

    def test_non_founder_investor_snapshot_403(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/investor-snapshot?window=30d",
            headers=_h(user_token),
        )
        assert r.status_code == 403


# =====================================================================
# Refresh snapshot
# =====================================================================
class TestRefreshSnapshot:
    def test_founder_refresh_snapshot(self, founder_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/realm-pulse/refresh-snapshot?window=7d",
            headers=_h(founder_token),
        )
        assert r.status_code == 200, r.text
        p = r.json()
        assert p.get("ok") is True
        assert p.get("window") == "7d"
        assert "generated_at" in p

    def test_non_founder_refresh_snapshot_403(self, user_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/realm-pulse/refresh-snapshot?window=7d",
            headers=_h(user_token),
        )
        assert r.status_code == 403


# =====================================================================
# Exports
# =====================================================================
class TestExports:
    def test_export_csv(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/export?format=csv&window=7d",
            headers=_h(founder_token),
        )
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        first_line = r.text.splitlines()[0].strip()
        assert first_line == "metric,value", f"csv first line was: {first_line!r}"

    def test_export_pdf(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/export?format=pdf&window=7d",
            headers=_h(founder_token),
        )
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        assert r.content[:5] == b"%PDF-", f"missing %PDF- magic bytes: {r.content[:8]}"

    def test_export_xlsx(self, founder_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/export?format=xlsx&window=7d",
            headers=_h(founder_token),
        )
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "openxmlformats-officedocument.spreadsheetml.sheet" in ct, ct
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        # xlsx == zip → starts with PK
        assert r.content[:2] == b"PK", f"xlsx not a zip: {r.content[:4]}"
        assert len(r.content) > 0

    def test_export_non_founder_403(self, user_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/realm-pulse/export?format=csv&window=7d",
            headers=_h(user_token),
        )
        assert r.status_code == 403


# =====================================================================
# Regression — pre-existing founder endpoints
# =====================================================================
class TestRegression:
    def test_storage_status(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/storage/status",
                         headers=_h(founder_token))
        assert r.status_code == 200, r.text

    def test_interest_cards_public(self):
        r = requests.get(f"{BASE_URL}/api/hashtags/interest-cards")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), (list, dict))

    def test_interest_cards_analytics_founder(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/hashtags/interest-cards/analytics",
                         headers=_h(founder_token))
        assert r.status_code == 200, r.text

    def test_copyright_queue_founder(self, founder_token):
        r = requests.get(f"{BASE_URL}/api/admin/moderation/copyright/queue",
                         headers=_h(founder_token))
        assert r.status_code == 200, r.text
