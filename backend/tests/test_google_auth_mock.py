import asyncio
from unittest.mock import patch, AsyncMock, MagicMock
from dotenv import load_dotenv
load_dotenv()


async def main():
    from routers.auth import google_session, GoogleSessionPayload
    from core.db import db
    from fastapi import Response

    fake = {"id": "g1", "email": "google.tester.e2e@example.com",
            "name": "Google Tester", "picture": "https://example.com/p.png",
            "session_token": "st_test_123"}
    resp_obj = MagicMock()
    resp_obj.status_code = 200
    resp_obj.json = MagicMock(return_value=fake)
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.get = AsyncMock(return_value=resp_obj)

    with patch("httpx.AsyncClient", return_value=client):
        out = await google_session(GoogleSessionPayload(session_id="mock-sid"), Response())
        u = out["user"]
        print("NEW: created:", out["created"], "| username:", u["username"], "| token:", bool(out["access_token"]))
        doc = await db.users.find_one({"email": fake["email"]}, {"_id": 0, "google_auth": 1, "friends": 1, "email_verified": 1, "id": 1})
        print("doc google_auth:", doc["google_auth"], "| friends:", len(doc.get("friends") or []), "| email_verified:", doc["email_verified"])
        out2 = await google_session(GoogleSessionPayload(session_id="mock-sid-2"), Response())
        print("EXISTING: created:", out2["created"], "| same id:", out2["user"]["id"] == u["id"])
        n = await db.users.count_documents({"email": fake["email"]})
        print("user docs for email (must be 1):", n)
        sess = await db.user_sessions.count_documents({"user_id": doc["id"]})
        print("stored emergent sessions:", sess)
        import jwt as _jwt
        from core.config import get_jwt_secret, JWT_ALGORITHM
        p = _jwt.decode(out2["access_token"], get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        print("JWT sub matches:", p["sub"] == doc["id"])
        await db.users.delete_one({"email": fake["email"]})
        await db.user_sessions.delete_many({"user_id": doc["id"]})
        await db.user_badges.delete_many({"user_id": doc["id"]})
        await db.users.update_many({}, {"$pull": {"friends": doc["id"]}})
        print("cleanup done")

asyncio.run(main())
