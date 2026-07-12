"""Canonical definition of a REAL, analytics-eligible member.

Every admin metric (Total Members, signups, DAU/MAU, growth charts)
must use this single filter so all dashboards agree on the same number.

A real member:
  • has a valid, normalized email address
  • is not a system/service account (@support, neutralised legacy admin)
  • is not flagged synthetic (bot / demo / seed / mock / test)
  • is not in the deleted-pending-purge window
  • completed signup successfully
"""
import re

VALID_EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"

LEGACY_ADMIN_EMAIL = "admin@ourrealm.app"

NON_HUMAN_ACCOUNT_TYPES = ["bot", "demo", "test", "seed", "mock", "system"]


def real_member_filter() -> dict:
    """Mongo filter selecting only real registered human accounts."""
    return {
        "email": {
            "$exists": True,
            "$nin": [None, "", LEGACY_ADMIN_EMAIL],
            "$regex": VALID_EMAIL_RE,
        },
        "is_system": {"$ne": True},
        "is_synthetic": {"$ne": True},
        "analytics_eligible": {"$ne": False},
        "account_type": {"$nin": NON_HUMAN_ACCOUNT_TYPES},
        "account_status": {"$ne": "deleted_pending_restore"},
        "signup_completed": {"$ne": False},
    }


def is_valid_email(email) -> bool:
    return bool(email) and bool(re.match(VALID_EMAIL_RE, str(email)))


async def count_real_members(db) -> int:
    return await db.users.count_documents(real_member_filter())
