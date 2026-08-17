"""mailer — minimal outbound-email abstraction for account lifecycle mail.

If RESEND_API_KEY is configured the mail is sent through Resend's HTTP
API. When no provider is configured the mail is recorded in the
`outbound_emails` collection with status `logged_no_provider` so the
flow stays auditable, and callers are told delivery didn't happen so
they can fall back to in-app notification links.

Bodies must never contain sensitive personal information — only short
action descriptions and links.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone

import httpx

from core.db import db

log = logging.getLogger("ourrealm.mailer")

FROM_ADDRESS = os.environ.get("MAIL_FROM", "OurRealm <no-reply@ourrealm.social>")


def email_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY"))


async def send_email(to: str, subject: str, body_text: str, *,
                     kind: str, user_id: str | None = None) -> dict:
    """Send (or record) one email. Returns {sent: bool, id: str}."""
    now = datetime.now(timezone.utc).isoformat()
    rec = {
        "id": uuid.uuid4().hex,
        "to": to,
        "subject": subject,
        "body": body_text,
        "kind": kind,
        "user_id": user_id,
        "created_at": now,
        "status": "pending",
    }
    sent = False
    api_key = os.environ.get("RESEND_API_KEY")
    if api_key and to and "@" in to and not to.endswith(".invalid"):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"from": FROM_ADDRESS, "to": [to],
                          "subject": subject, "text": body_text},
                )
            if r.status_code in (200, 201):
                rec["status"] = "sent"
                rec["provider_id"] = (r.json() or {}).get("id")
                sent = True
            else:
                rec["status"] = "failed"
                rec["error"] = f"HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            rec["status"] = "failed"
            rec["error"] = str(e)[:300]
    else:
        rec["status"] = "logged_no_provider"
    try:
        await db.outbound_emails.insert_one(dict(rec))
    except Exception:  # noqa: BLE001
        log.exception("[mailer] could not record outbound email")
    return {"sent": sent, "id": rec["id"], "status": rec["status"]}
