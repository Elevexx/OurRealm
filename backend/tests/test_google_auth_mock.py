import asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from dotenv import load_dotenv
load_dotenv()


def mock_client(fake):
    resp_obj = MagicMock()
    resp_obj.status_code = 200
    resp_obj.json = MagicMock(return_value=fake)
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.get = AsyncMock(return_value=resp_obj)
    return client


async def main():
    from routers.auth import google_session, GoogleSessionPayload, dismiss_username_onboarding
    from core.db import db
    from fastapi import Response

    results = []

    def ok(name, cond):
        results.append((name, bool(cond)))
        print(("PASS" if cond else "FAIL"), "-", name)

    fake = {"id": "g1", "email": "google.tester.e2e@example.com",
            "name": "Google Tester", "picture": "https://example.com/p.png",
            "session_token": "st_test_123"}

    with patch("httpx.AsyncClient", return_value=mock_client(fake)):
        # 1) brand-new Google user
        out = await google_session(GoogleSessionPayload(session_id="mock-1"), Response())
        u = out["user"]
        ok("new google user created", out["created"])
        ok("new user gets onboarding flag", u.get("needs_username_onboarding") is True)
        ok("google_auth exposed", u.get("google_auth") is True)
        uid = u["id"]

        # 2) repeat login — flag unchanged, no duplicate user
        out2 = await google_session(GoogleSessionPayload(session_id="mock-2"), Response())
        ok("repeat login not created", out2["created"] is False)
        ok("repeat login keeps onboarding flag", out2["user"].get("needs_username_onboarding") is True)
        ok("single user doc", await db.users.count_documents({"email": fake["email"]}) == 1)

        # 3) dismiss clears flag permanently
        await dismiss_username_onboarding({"id": uid})
        doc = await db.users.find_one({"id": uid}, {"_id": 0, "needs_username_onboarding": 1})
        ok("dismiss clears flag", doc.get("needs_username_onboarding") is False)
        out3 = await google_session(GoogleSessionPayload(session_id="mock-3"), Response())
        ok("flag stays cleared after next login", out3["user"].get("needs_username_onboarding") is False)

    # 4) existing (non-google) account linked by email — never gets flag
    fake2 = {"id": "g2", "email": "linked.existing.e2e@example.com",
             "name": "Linked Existing", "picture": None, "session_token": "st_2"}
    import uuid as _uuid
    from core.security import hash_password
    from datetime import datetime, timezone
    lid = str(_uuid.uuid4())
    await db.users.insert_one({
        "id": lid, "email": fake2["email"], "username": "linkedexisting",
        "password_hash": hash_password("Whatever1$"), "name": "Linked",
        "role": "user", "friends": [], "widgets": [],
        "created_at": datetime.now(timezone.utc).isoformat()})
    with patch("httpx.AsyncClient", return_value=mock_client(fake2)):
        outl = await google_session(GoogleSessionPayload(session_id="mock-l1"), Response())
        ok("existing account linked (not created)", outl["created"] is False)
        ok("linked user has NO onboarding flag", outl["user"].get("needs_username_onboarding") is False)
        ok("linked user google_auth true", outl["user"].get("google_auth") is True)
        ok("linked user keeps username", outl["user"]["username"] == "linkedexisting")

    # 5) username evaluation: conflict + premium pricing (shared service)
    from routers.premium_usernames import evaluate, perform_username_change
    taken = await evaluate("linkedexisting")
    ok("conflict detected as taken", taken["status"] == "taken")
    prem = await evaluate("zx9q")  # 4 chars → premium length
    ok("premium name flagged", prem.get("premium") is True and (prem.get("cost") or 0) > 0)

    # 6) rename via THE shared service clears the onboarding flag
    await db.users.update_one({"id": lid}, {"$set": {"needs_username_onboarding": True}})
    cur = await db.users.find_one({"id": lid}, {"_id": 0})
    res = await perform_username_change(cur, "linkedrenamed001", idempotency_key=f"test-{lid}-r1")
    doc = await db.users.find_one({"id": lid}, {"_id": 0, "username": 1, "needs_username_onboarding": 1})
    ok("rename succeeded", res.get("success") and doc["username"] == "linkedrenamed001")
    ok("rename clears onboarding flag", doc.get("needs_username_onboarding") is False)

    # cleanup
    gdoc = await db.users.find_one({"email": fake["email"]}, {"_id": 0, "id": 1})
    for x in [gdoc["id"] if gdoc else None, lid]:
        if not x:
            continue
        await db.users.delete_one({"id": x})
        await db.user_sessions.delete_many({"user_id": x})
        await db.user_badges.delete_many({"user_id": x})
        await db.users.update_many({}, {"$pull": {"friends": x}})
    await db.username_rules.delete_many({"username": {"$in": ["linkedexisting"]}})
    await db.username_claims.delete_many({"username": {"$in": ["linkedexisting", "linkedrenamed001"]}})
    print("cleanup done")

    failed = [n for n, c in results if not c]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(1)

asyncio.run(main())
