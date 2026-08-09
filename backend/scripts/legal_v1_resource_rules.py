"""Publish V1 engagement-resource rules into the versioned legal system.
Idempotent — skips docs whose published body already contains the marker.
Creates a one-time 'legal terms updated' notice after next sign-in."""
import asyncio
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

MARKER = "<!-- v1-resource-rules -->"
ACTOR = {"username": "stealth", "id": "system-legal-v1"}

RESOURCE_SECTION = f"""

{MARKER}
## Engagement Resources & Game Maker (Ages 13+)

OurRealm and its Game Maker are for users aged **13 and older**.

Engagement resources (such as Fire Power, Coins, Stars, Gems and Keys) are **platform-controlled participation and progression resources**. The following rules always apply:

- Engagement resources have **no monetary value**.
- They **cannot** be purchased, sold, traded, transferred between users, cashed out, or exchanged for money or goods.
- They are **not** prizes, investments, wages, cryptocurrency or stored money.
- Every requirement (a held balance or a burn) is **shown clearly before you confirm**.
- Burns finalize **only after the requested action succeeds**; technical failures and cancellations **return held resources**.
- Previously confirmed holds keep the rule version recorded at confirmation; rule changes apply **prospectively with notice**.
- Randomized paid or resource-burn loot boxes and resource-powered games of chance are **prohibited**.
- Fraudulent, automated or abusive activity may be reversed.
- Resource participation is **never** conditioned on providing unnecessary personal information, and exercising privacy or deletion rights does **not** reduce unrelated service quality or resource eligibility.
"""


async def main():
    from services import legal_docs as ld
    updated = []
    for key, summary in [
        ("terms", "Added Engagement Resources & Game Maker (13+) rules — closed-loop, no monetary value, burn/hold protections."),
        ("fire-power", "V1 engagement-resource rules: 13+, closed-loop, no monetary value, hold/burn safeguards, prohibited loot boxes."),
    ]:
        doc = await ld.get_doc(key)
        if not doc:
            print(f"SKIP {key} — not found")
            continue
        body = doc.get("published_body") or ""
        if MARKER in body:
            print(f"SKIP {key} — already contains V1 resource rules (idempotent)")
            continue
        await ld.save_draft(key, ACTOR, body + RESOURCE_SECTION)
        await ld.publish(key, ACTOR, change_summary=summary)
        updated.append(key)
        print(f"PUBLISHED new version of {key}")
    if updated:
        n = await ld.create_notice(
            ACTOR, doc_keys=updated, mode="one_time",
            message="We've updated our legal terms: OurRealm Games and the Game Maker are for ages 13+, "
                    "and new Engagement Resource rules are now published. Resources have no monetary value "
                    "and can never be exchanged for money or goods.")
        print("Notice created:", n["id"])
    else:
        print("No changes — everything already published.")

asyncio.run(main())
