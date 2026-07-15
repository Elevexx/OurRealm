"""Idempotent FAQ starter seed — inserts founder-editable FAQ entries.
Skips any question that already exists (case-insensitive). Run:
    cd /app/backend && python scripts/seed_faq_entries.py
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

STARTERS = [
    ("What is OurRealm?",
     "OurRealm is a multi-mode social platform where you can post thoughts, photos, videos, sounds, and polls, join Realms (communities), message friends, and fully customize your profile with widgets. Live. Connect. Experience."),
    ("What are Modes and how do I switch them?",
     "Modes re-theme the entire app. Choose between NEON, BUSINESS, MILLENNIUM, and STEALTH from the Modes page or Settings. Your selection persists across every page, and you can also customize each mode's accent colors from the Modes page."),
    ("How do I create a post?",
     "Use the composer at the top of the For You feed, or tap the + button in the bottom navigation. Both support text, up to 6 images per album, video, sounds, polls, hashtags, and audience controls (Public, Friends, Custom, or Private)."),
    ("How do hashtags work?",
     "Add hashtags in the composer's hashtag field or type #tag directly in your post. Hashtags are clickable — tapping one opens a feed of every post using that tag. Trending hashtags appear on the For You page."),
    ("What are Realms?",
     "Realms are communities built around shared interests. Join a Realm to chat with members, see community posts, and use Realm widgets. You can create your own Realm from the Realms page."),
    ("What is ORAi?",
     "ORAi (OurRealm AI) is the platform's built-in AI assistant. It powers the founder's Command Center for analytics, drafts, and operations, and drives AI features across OurRealm."),
    ("How do I customize my profile?",
     "Open your Profile and tap Edit. You can change your display name, bio, profile picture, and banner, plus add, resize, and rearrange widgets like Top 8, Music, Polls, and more."),
    ("What is VIP?",
     "VIP members unlock perks like longer posts (500 characters instead of 300) and a VIP badge on their profile."),
    ("How do I report content or get support?",
     "Tap the report icon on any post to flag it for moderators. For account help, open Profile → Support to create a support ticket — our team responds via direct message."),
    ("How do I delete my account?",
     "Go to Settings → Account. Account deletion is a soft delete with a 30-day restore window — sign back in within 30 days to restore everything, after which your data is permanently purged."),
]


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    now = datetime.now(timezone.utc).isoformat()
    last = await db.faq.find_one({}, sort=[("order_index", -1)])
    order = int((last or {}).get("order_index") or 0) + 10
    inserted = 0
    for question, answer in STARTERS:
        exists = await db.faq.find_one({"question": {"$regex": f"^{question[:40]}", "$options": "i"}})
        if exists:
            continue
        await db.faq.insert_one({
            "id": uuid.uuid4().hex,
            "question": question,
            "answer": answer,
            "is_published": True,
            "order_index": order,
            "created_at": now,
            "updated_at": now,
            "created_by": "seed_script",
        })
        order += 10
        inserted += 1
    total = await db.faq.count_documents({})
    print(f"inserted={inserted} total={total}")


if __name__ == "__main__":
    asyncio.run(main())
