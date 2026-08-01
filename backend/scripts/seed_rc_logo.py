"""Seed the new official RC logo across branding asset slots (one-off)."""
import asyncio
import io
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

from PIL import Image  # noqa: E402


def variant(im: Image.Image, size: int, crop_emblem: bool) -> bytes:
    """Square, aspect-preserving variant. crop_emblem zooms the shield for small sizes."""
    w, h = im.size
    if crop_emblem:
        # emblem occupies roughly the central-upper 62% of the square artwork
        side = int(min(w, h) * 0.62)
        cx, cy = w // 2, int(h * 0.40)
        box = (max(0, cx - side // 2), max(0, cy - side // 2),
               min(w, cx + side // 2), min(h, cy + side // 2))
        im = im.crop(box)
    s = min(im.size)
    left = (im.width - s) // 2
    top = (im.height - s) // 2
    im = im.crop((left, top, left + s, top + s)).resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


async def main():
    from core.db import db
    from services.image_store import save_bytes
    from services import rc_media

    user = await db.users.find_one({"username": "stealth"}, {"_id": 0})
    src = Image.open("/tmp/newlogo.png").convert("RGB")

    plan = [
        ("responsibility_center.main_logo", 1024, False),
        ("responsibility_center.dark_background_logo", 1024, False),
        ("responsibility_center.compact_logo", 512, False),
        ("responsibility_center.default_center_icon", 512, False),
        ("responsibility_center.admin_icon", 256, False),
        ("responsibility_center.navigation_icon", 192, True),
        ("responsibility_center.mobile_menu_icon", 192, True),
        ("responsibility_center.favicon_icon", 128, True),
        ("responsibility_center.education.logo", 512, False),
        ("responsibility_center.education.compact_icon", 256, True),
    ]
    reason = "New official Responsibility Center logo — default branding rollout"
    for key, size, crop in plan:
        existing = await db.rc_system_asset_versions.find_one(
            {"asset_key": key, "upload_reason": reason}, {"_id": 0, "id": 1})
        if existing:
            print(f"skip {key} (already seeded)")
            continue
        raw = variant(src, size, crop)
        rec = await save_bytes(raw, user["id"], "image/png")
        row = await rc_media.create_version(
            user, key, rec.original_url, reason,
            theme_variant="default", device_variant="default",
            file_meta={"width": size, "height": size,
                       "file_type": "image/png", "file_size": len(raw)})
        await rc_media.activate_version(user, key, row["id"])
        print(f"seeded {key} v{row['version']} -> {rec.original_url}")


asyncio.run(main())
