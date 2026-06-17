"""Phase 8 / iteration_17 — Atomic ticket counter, SUPPORT_PASSWORD, FAQ CRUD."""
from __future__ import annotations

import os
import time
import uuid
import requests
import pytest


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realm-deploy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _register(suffix: str | None = None) -> dict:
    suffix = suffix or uuid.uuid4().hex[:8]
    email = f"TEST_p8_{suffix}@example.com"
    payload = {
        "email": email,
        "password": "pass1234!",
        "name": f"P8 {suffix}",
        "username": f"p8u{suffix[:10]}",
        "accepted_terms": True,
        "accepted_privacy": True,
        "accepted_conditions": True,
        "age_confirmed_13": True,
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"no token in register response: {body}"
    return {"email": email, "username": payload["username"], "token": token}


def _login(email: str, password: str) -> str | None:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        return None
    return r.json().get("access_token") or r.json().get("token")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 1) SUPPORT_PASSWORD default login
# ---------------------------------------------------------------------------
class TestSupportPassword:
    def test_support_login_with_default_password(self):
        tok = _login("support", "Password1$")
        assert tok, "support login with default Password1$ failed"
        # Sanity: /api/auth/me returns the support user
        me = requests.get(f"{API}/auth/me", headers=_auth(tok), timeout=15)
        assert me.status_code == 200
        body = me.json()
        # the endpoint may return either {user:{...}} or the user directly
        user = body.get("user", body)
        assert (user.get("username") == "support") or (user.get("name", "").lower().startswith("support"))


# ---------------------------------------------------------------------------
# 2) Atomic ticket counter — strictly monotonic across users
# ---------------------------------------------------------------------------
class TestTicketCounter:
    def test_monotonic_ticket_numbers_across_fresh_users(self):
        numbers: list[int] = []
        for _ in range(5):
            u = _register()
            r = requests.post(f"{API}/tickets/ensure", json={"subject": "TEST_p8 counter"}, headers=_auth(u["token"]), timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("created") is True, f"expected new ticket per fresh user, got: {body}"
            t = body["ticket"]
            assert isinstance(t.get("ticket_number"), int)
            assert t["ticket_number"] >= 1001
            numbers.append(t["ticket_number"])

        # strictly increasing (no duplicates, no decreases)
        assert numbers == sorted(set(numbers)) and len(numbers) == 5, f"non-monotonic or duplicate numbers: {numbers}"
        for prev, nxt in zip(numbers, numbers[1:]):
            assert nxt > prev, f"non-monotonic: {numbers}"

    def test_idempotent_for_same_user(self):
        u = _register()
        r1 = requests.post(f"{API}/tickets/ensure", json={}, headers=_auth(u["token"]), timeout=20)
        assert r1.status_code == 200
        n1 = r1.json()["ticket"]["ticket_number"]
        assert r1.json()["created"] is True

        r2 = requests.post(f"{API}/tickets/ensure", json={}, headers=_auth(u["token"]), timeout=20)
        assert r2.status_code == 200
        body2 = r2.json()
        assert body2["created"] is False, "second ensure should NOT mint a new ticket"
        assert body2["ticket"]["ticket_number"] == n1


# ---------------------------------------------------------------------------
# 3) FAQ public + admin CRUD
# ---------------------------------------------------------------------------
class TestFAQ:
    @classmethod
    def setup_class(cls):
        cls.admin_tok = _login("stealth", "Password1$")
        assert cls.admin_tok, "stealth admin login failed"
        cls.user_tok = _login("testfriend1@example.com", "pass1234")
        assert cls.user_tok, "testfriend1 login failed"
        cls.created_ids: list[str] = []

    @classmethod
    def teardown_class(cls):
        # cleanup created FAQ entries
        for fid in cls.created_ids:
            try:
                requests.delete(f"{API}/admin/faq/{fid}", headers=_auth(cls.admin_tok), timeout=10)
            except Exception:
                pass

    def test_public_faq_no_auth(self):
        r = requests.get(f"{API}/faq", timeout=15)
        assert r.status_code == 200
        items = r.json().get("items")
        assert isinstance(items, list)
        # all returned items must be published
        for it in items:
            assert it.get("is_published") is True
        # ordering by order_index ascending
        oi = [int(x.get("order_index") or 0) for x in items]
        assert oi == sorted(oi), f"items not sorted by order_index: {oi}"

    def test_admin_create_requires_admin(self):
        # non-admin -> 403
        r = requests.post(f"{API}/admin/faq",
                          json={"question": "TEST_p8 q?", "answer": "TEST_p8 a"},
                          headers=_auth(self.user_tok), timeout=15)
        assert r.status_code == 403, f"expected 403 for non-admin, got {r.status_code}: {r.text}"

    def test_admin_create_and_auto_order_index(self):
        r = requests.post(f"{API}/admin/faq",
                          json={"question": "TEST_p8 first?", "answer": "TEST_p8 first answer"},
                          headers=_auth(self.admin_tok), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        item = body["item"]
        assert item["question"] == "TEST_p8 first?"
        assert item["answer"] == "TEST_p8 first answer"
        assert isinstance(item["order_index"], int)
        assert item["is_published"] is True
        self.__class__.created_ids.append(item["id"])

        # Second create — auto_order_index should be > previous
        r2 = requests.post(f"{API}/admin/faq",
                           json={"question": "TEST_p8 second?", "answer": "TEST_p8 second answer"},
                           headers=_auth(self.admin_tok), timeout=15)
        assert r2.status_code == 200
        item2 = r2.json()["item"]
        assert item2["order_index"] > item["order_index"]
        self.__class__.created_ids.append(item2["id"])

    def test_admin_patch_and_persistence(self):
        # create
        r = requests.post(f"{API}/admin/faq",
                          json={"question": "TEST_p8 patch?", "answer": "TEST_p8 orig"},
                          headers=_auth(self.admin_tok), timeout=15)
        assert r.status_code == 200
        fid = r.json()["item"]["id"]
        self.__class__.created_ids.append(fid)

        # update fields
        r2 = requests.patch(f"{API}/admin/faq/{fid}",
                            json={"question": "TEST_p8 patched?", "answer": "TEST_p8 new", "order_index": 555},
                            headers=_auth(self.admin_tok), timeout=15)
        assert r2.status_code == 200
        item = r2.json()["item"]
        assert item["question"] == "TEST_p8 patched?"
        assert item["answer"] == "TEST_p8 new"
        assert item["order_index"] == 555

        # GET to verify persistence (via admin list)
        r3 = requests.get(f"{API}/admin/faq", headers=_auth(self.admin_tok), timeout=15)
        assert r3.status_code == 200
        found = next((x for x in r3.json()["items"] if x["id"] == fid), None)
        assert found and found["question"] == "TEST_p8 patched?"

    def test_unpublish_hides_from_public_but_keeps_in_admin(self):
        r = requests.post(f"{API}/admin/faq",
                          json={"question": "TEST_p8 unpub?", "answer": "TEST_p8 ans"},
                          headers=_auth(self.admin_tok), timeout=15)
        assert r.status_code == 200
        fid = r.json()["item"]["id"]
        self.__class__.created_ids.append(fid)

        # confirm public sees it
        pub = requests.get(f"{API}/faq", timeout=15).json()["items"]
        assert any(x["id"] == fid for x in pub), "published item not visible publicly"

        # unpublish
        r2 = requests.patch(f"{API}/admin/faq/{fid}", json={"is_published": False},
                            headers=_auth(self.admin_tok), timeout=15)
        assert r2.status_code == 200
        assert r2.json()["item"]["is_published"] is False

        # public should no longer include it
        pub2 = requests.get(f"{API}/faq", timeout=15).json()["items"]
        assert not any(x["id"] == fid for x in pub2), "unpublished item still public"

        # admin should still include it
        adm = requests.get(f"{API}/admin/faq", headers=_auth(self.admin_tok), timeout=15).json()["items"]
        assert any(x["id"] == fid for x in adm), "unpublished item missing from admin list"

    def test_validation_length_caps(self):
        # question >200 chars
        big_q = "Q" * 201
        r = requests.post(f"{API}/admin/faq",
                          json={"question": big_q, "answer": "ok"},
                          headers=_auth(self.admin_tok), timeout=15)
        assert r.status_code in (400, 422), f"expected 400/422 for >200 question, got {r.status_code}"

        # answer >2000 chars
        big_a = "A" * 2001
        r2 = requests.post(f"{API}/admin/faq",
                           json={"question": "ok?", "answer": big_a},
                           headers=_auth(self.admin_tok), timeout=15)
        assert r2.status_code in (400, 422), f"expected 400/422 for >2000 answer, got {r2.status_code}"

    def test_admin_delete(self):
        r = requests.post(f"{API}/admin/faq",
                          json={"question": "TEST_p8 del?", "answer": "x"},
                          headers=_auth(self.admin_tok), timeout=15)
        assert r.status_code == 200
        fid = r.json()["item"]["id"]

        d = requests.delete(f"{API}/admin/faq/{fid}", headers=_auth(self.admin_tok), timeout=15)
        assert d.status_code == 200
        assert d.json().get("ok") is True

        # GET admin → should not include it
        adm = requests.get(f"{API}/admin/faq", headers=_auth(self.admin_tok), timeout=15).json()["items"]
        assert not any(x["id"] == fid for x in adm)

    def test_support_admin_can_crud(self):
        sup_tok = _login("support", "Password1$")
        assert sup_tok, "support login failed"
        r = requests.post(f"{API}/admin/faq",
                          json={"question": "TEST_p8 supcreate?", "answer": "support can create"},
                          headers=_auth(sup_tok), timeout=15)
        assert r.status_code == 200, r.text
        fid = r.json()["item"]["id"]
        self.__class__.created_ids.append(fid)
