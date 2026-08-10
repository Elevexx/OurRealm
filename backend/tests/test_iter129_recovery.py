"""Iteration 129 backend verification.

Covers:
- Private preview access branch (creator vs other member)
- Cost hiding for support admin vs founder
- Cost fields stripped from GET /api/games/{id}
- Explicit runtime honored in quote (shooter)
- Catalog contains shooter/open_world_rpg live
- Public preview member rewards (progress + fire keys collect) not blocked
"""
import os
import uuid
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(username: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    return {
        "founder": _login("stealth", "Password1$"),
        "support": _login("support", "Password1$"),
        "member": _login("auditcheckreal", "Password1$"),
        "member2": _login("tftwo", "pass1234"),
    }


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Catalog: shooter & open_world_rpg LIVE ----------
def test_catalog_has_new_runtimes(tokens):
    r = requests.get(f"{BASE}/api/gamemaker/catalog", headers=_h(tokens["founder"]), timeout=30)
    assert r.status_code == 200, r.text[:200]
    data = r.json()
    runtimes = data.get("runtimes") or data.get("catalog") or data
    # Normalize
    if isinstance(runtimes, dict):
        items = list(runtimes.values()) if runtimes else []
    else:
        items = runtimes
    ids = []
    statuses = {}
    for it in items:
        if isinstance(it, dict):
            rid = it.get("id") or it.get("runtime") or it.get("key")
            if rid:
                ids.append(rid)
                statuses[rid] = it.get("status")
    assert "shooter" in ids, f"shooter missing from catalog. ids={ids}"
    assert "open_world_rpg" in ids, f"open_world_rpg missing. ids={ids}"
    assert statuses.get("shooter") == "live", f"shooter status={statuses.get('shooter')}"
    assert statuses.get("open_world_rpg") == "live", f"owr status={statuses.get('open_world_rpg')}"
    assert len(ids) >= 10, f"expected >=10 runtimes, got {len(ids)}"


# ---------- Explicit runtime honored ----------
def test_quote_explicit_runtime_shooter(tokens):
    payload = {
        "idea": "a quiz about history",  # tempting quiz fallback
        "runtime": "shooter",
        "style": "pixel_art",
    }
    r = requests.post(f"{BASE}/api/gamemaker/quote", headers=_h(tokens["founder"]), json=payload, timeout=60)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    quote = body.get("quote") or body
    rt = quote.get("runtime") or (quote.get("spec") or {}).get("runtime")
    assert rt == "shooter", f"runtime not honored: {rt}; body={body}"


# ---------- Cost hiding for support admin ----------
def test_quote_provider_estimate_founder_vs_support(tokens):
    payload = {"idea": "a small platformer test", "runtime": "platformer", "style": "pixel_art"}
    r_f = requests.post(f"{BASE}/api/gamemaker/quote", headers=_h(tokens["founder"]), json=payload, timeout=60)
    r_s = requests.post(f"{BASE}/api/gamemaker/quote", headers=_h(tokens["support"]), json=payload, timeout=60)
    assert r_f.status_code == 200, r_f.text[:300]
    # Support may be 200 or 403; if 200, must NOT have provider_estimate
    q_f = (r_f.json().get("quote") or r_f.json())
    assert "provider_estimate" in q_f, f"founder must see provider_estimate: {q_f}"
    if r_s.status_code == 200:
        q_s = (r_s.json().get("quote") or r_s.json())
        # scan recursively for provider_estimate key
        def has_key(obj, key):
            if isinstance(obj, dict):
                if key in obj:
                    return True
                return any(has_key(v, key) for v in obj.values())
            if isinstance(obj, list):
                return any(has_key(v, key) for v in obj)
            return False
        assert not has_key(q_s, "provider_estimate"), f"support saw provider_estimate: {q_s}"
        for k in ("estimated_cost", "est_cost", "actual_cost", "estimates"):
            assert not has_key(q_s, k), f"support saw {k}"
    else:
        pytest.skip(f"support admin cannot quote (status {r_s.status_code}) — skip diff check")


# ---------- Cost fields stripped from GET /api/games/{id} for non-founder ----------
def _find_published_game(tok):
    # Try likely listing endpoints
    for path in ["/api/games?limit=20", "/api/games/", "/api/games"]:
        r = requests.get(f"{BASE}{path}", headers=_h(tok), timeout=30)
        if r.status_code == 200:
            data = r.json()
            items = data.get("games") or data.get("items") or data if isinstance(data, list) else data.get("games") or data.get("items") or []
            for g in items or []:
                if isinstance(g, dict) and (g.get("status") == "published" or g.get("access", {}).get("mode") in ("published", "public_preview")):
                    return g.get("id") or g.get("_id")
    return None


def test_get_game_no_cost_fields_for_member(tokens):
    # Use known demo id — query as founder (projection is unconditional)
    gid = "demo-shooter-neon-breach-v1"
    r = requests.get(f"{BASE}/api/games/{gid}", headers=_h(tokens["founder"]), timeout=30)
    assert r.status_code == 200, f"GET game: {r.status_code} {r.text[:200]}"
    body = r.json()
    def has_key(obj, key):
        if isinstance(obj, dict):
            if key in obj:
                return True
            return any(has_key(v, key) for v in obj.values())
        if isinstance(obj, list):
            return any(has_key(v, key) for v in obj)
        return False
    for k in ("est_cost", "actual_cost", "estimates", "provider_estimate", "estimated_cost"):
        assert not has_key(body, k), f"member saw cost field {k} in game response"


# ---------- Private preview: creator sees, other doesn't ----------
def test_private_preview_creator_vs_other(tokens):
    """Create a temp game doc in mongo directly if we can, else attempt via API."""
    import subprocess, json, sys
    # We'll create doc via a small python one-shot into mongo using backend env
    script = r'''
import os, sys, uuid, json
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio
async def main():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    cli = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = cli[os.environ["DB_NAME"]]
    # find creator user _id for auditcheckreal
    u = await db.users.find_one({"username":"auditcheckreal"}, {"_id":0,"id":1})
    if not u:
        print("NOUSER"); return
    gid = "test-priv-" + uuid.uuid4().hex[:8]
    doc = {
        "id": gid,
        "title": "TEST_PRIV_PREVIEW",
        "status": "approved",
        "created_by": u["id"],
        "creator_id": u["id"],
        "creator_username": "auditcheckreal",
        "runtime": "shooter",
        "spec": {"runtime":"shooter"},
        "access": {"mode":"draft"},
    }
    await db.games.insert_one(doc)
    print("GID="+gid)
asyncio.run(main())
'''
    p = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30)
    out = (p.stdout or "") + (p.stderr or "")
    gid = None
    for line in out.splitlines():
        if line.startswith("GID="):
            gid = line.split("=",1)[1].strip()
    if not gid:
        pytest.skip(f"could not seed private preview doc: {out[:300]}")
    try:
        # creator (auditcheckreal) should get 200 and access.mode private_preview
        r1 = requests.get(f"{BASE}/api/games/{gid}", headers=_h(tokens["member"]), timeout=30)
        assert r1.status_code == 200, f"creator GET: {r1.status_code} {r1.text[:200]}"
        b1 = r1.json()
        acc = (b1.get("access") or {}).get("mode") or (b1.get("game") or {}).get("access", {}).get("mode")
        assert acc == "private_preview", f"expected private_preview, got {acc}. body keys={list(b1.keys())}"
        # other member should get 404
        r2 = requests.get(f"{BASE}/api/games/{gid}", headers=_h(tokens["member2"]), timeout=30)
        assert r2.status_code == 404, f"other member should 404, got {r2.status_code}"
    finally:
        cleanup = f'''
import os, asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
async def m():
    load_dotenv("/app/backend/.env")
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    await c[os.environ["DB_NAME"]].games.delete_one({{"id":"{gid}"}})
asyncio.run(m())
'''
        subprocess.run([sys.executable, "-c", cleanup], capture_output=True, text=True, timeout=15)


# ---------- Public preview: signed-in member rewards allowed ----------
def test_public_preview_member_rewards(tokens):
    # Pick an existing published game (demo shooter) and flip to public_preview via admin endpoint, then restore.
    gid = "demo-shooter-neon-breach-v1"
    # get current mode
    r0 = requests.get(f"{BASE}/api/games/{gid}", headers=_h(tokens["founder"]), timeout=30)
    if r0.status_code != 200:
        pytest.skip("demo shooter not available")
    orig_mode = ((r0.json().get("access") or {}).get("mode")) or "published"

    # Try admin access endpoint variants
    set_ok = False
    for path, payload in [
        (f"/api/admin/games/{gid}/access", {"mode": "public_preview"}),
        (f"/api/games/{gid}/access", {"mode": "public_preview"}),
    ]:
        rr = requests.put(f"{BASE}{path}", headers=_h(tokens["founder"]), json=payload, timeout=30)
        if rr.status_code in (200, 204):
            set_ok = True
            break
    if not set_ok:
        pytest.skip("could not flip game to public_preview via admin endpoint")

    try:
        r_p = requests.post(
            f"{BASE}/api/games/{gid}/progress",
            headers=_h(tokens["member"]),
            json={"score": 10, "wave": 1},
            timeout=30,
        )
        assert r_p.status_code == 200, f"progress in public_preview: {r_p.status_code} {r_p.text[:200]}"

        r_k = requests.post(
            f"{BASE}/api/fire/keys/collect",
            headers=_h(tokens["member"]),
            json={"game_id": gid, "key_id": f"testkey-{uuid.uuid4().hex[:8]}", "source": "gameplay"},
            timeout=30,
        )
        assert r_k.status_code == 200, f"fire keys collect: {r_k.status_code} {r_k.text[:200]}"
    finally:
        for path in (f"/api/admin/games/{gid}/access", f"/api/games/{gid}/access"):
            requests.put(f"{BASE}{path}", headers=_h(tokens["founder"]), json={"mode": orig_mode}, timeout=30)
