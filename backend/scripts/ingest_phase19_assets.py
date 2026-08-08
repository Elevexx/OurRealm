"""Phase-19..23 asset ingest — sheets AND full images, S3 upload included."""
import asyncio, os, sys, uuid, io, shutil, tempfile
from datetime import datetime, timezone
from pathlib import Path
import requests
from PIL import Image
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
from ingest_phase18_assets import key_out, bbox_alpha  # noqa

GID = "9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b01"
J = "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/"

# slot: (file, kind, rows, cols, key_mode, fps, extra)
CFG = {
 "bg_forest_far":  ("9c78aef1351f60d280c357ea8e7eb09b7eb141e6cfb4c4422b59be9ba043152a.jpeg","image",0,0,"none",0,{}),
 "bg_forest_mid":  ("5e664c1ba46276c546f2987eba2267f689a1141a7590d44e06bb0721a471e68e.jpeg","image",0,0,"magenta",0,{}),
 "bg_forest_near": ("43b383b512230727aad8b4b7360a449cc07198b8f8c3e5b0692e1a68a16385be.jpeg","image",0,0,"magenta",0,{}),
 "bg_cave":        ("38d8fbc78405b981a61a26ea9bb833b5700e3d9c537a34024d20626b6c4f12d1.jpeg","image",0,0,"none",0,{}),
 "bg_nexus_far":   ("a36a400c59d81b9bb608fecf6d8cdc5254bf3e80fbdad208156f79f38aa049a9.jpeg","image",0,0,"none",0,{}),
 "bg_nexus_mid":   ("cf5769635285eddb22b4ef198d7c28097a87cd4f9ac0683ba5a381e0238a8d5c.jpeg","image",0,0,"magenta",0,{}),
 "terrain_tile":   ("262c50b4d305c94a60829614bc3d1f32dbde5bdfb7a9779131b66e0b3c66c107.jpeg","image",0,0,"none",0,{}),
 "nexus_tile":     ("b44021b0555918c3360719dbb8f900bd5df58e0614a2b4259f17e86b65879005.jpeg","image",0,0,"none",0,{}),
 "terrain_top":    ("ce5c99e995fa6ab60e42fb0cc5c64943061034dca5e852ed917ed5373e2c5d59.jpeg","image",0,0,"magenta",0,{}),
 "torch_flame":    ("a4c2547908300d10a40e00c41da797e8f5675cc88e26df128ce652cddfef3324.jpeg","sheet",2,3,"none",9,{"crop_bottom":0.14,"blend":"screen"}),
 "foe_walker":     ("1b36a95da72b520d939f73273d79c63c0cd11b163ecfb5f6921d429210f2a15b.jpeg","sheet",2,3,"magenta",8,{}),
 "foe_brute":      ("5732358ccf159a9705e0bb32e95bd24a82102c71af3602fc5e387938effeed25.jpeg","sheet",2,3,"magenta",6,{}),
 "foe_bat":        ("36116f0a7a6a2ed505405b715d10097ac7499c27adf68cbcc44f710085f2646c.jpeg","sheet",2,2,"magenta",8,{}),
 "foe_titan":      ("cc5b77f7ce916948c3d7f9d810b5289952c655fb0644e5bf829a3793446ee13c.jpeg","sheet",2,3,"magenta",5,{}),
 "foe_drone":      ("258aff95f78dcff2f659f8119e84af53d902f6204086c7690b0fc2eaa88a8644.jpeg","sheet",2,2,"magenta",8,{}),
 "foe_sentinel":   ("1b4dfebcbd4904d1ab1a2e4fc204fb4c947e1db68ab529b85bc356ab99156a9c.jpeg","sheet",2,3,"magenta",7,{}),
 "foe_golem":      ("43a6272cb603e474ef18f202ccb6e0c03130c957222e4d1d9c518d2e4ea7ff09.jpeg","sheet",2,3,"magenta",5,{}),
 "item_key":       ("84519a83745037cabc29453cb1220980efe5934597af8063e547b8bc71f0e841.jpeg","sheet",2,2,"magenta",5,{}),
 "item_chest":     ("3c174923396d8e573ab9a6e3ca96e037d452edc98211af3aa2c2aaaf58c770ca.jpeg","sheet",2,2,"magenta",1,{}),
 "item_potion":    ("c67595600539ed3ebd425bb928b2e7e95b1c1e318c9f4e82a38887797cd5399b.jpeg","sheet",2,2,"magenta",5,{}),
 "item_gem":       ("205f288d11c1564e2f26e48da90dd0a847e488c13ba24edb32a7b0e4a5d25fa8.jpeg","sheet",2,2,"none",5,{"blend":"screen"}),
 "checkpoint_obelisk": ("2c3f66644fcf6335e435d25e2cc1aeb6ad5e7512b80f0f0efd9e639be590b88b.jpeg","sheet",1,2,"magenta",1,{}),
 "portal2_active": ("551aa7ad135f3509e55e82e056faf146f24ada015573c4ef560851a10ec11137.jpeg","sheet",2,4,"none",10,{"blend":"screen","edge":10}),
 "portal2_locked": ("60fd086b3df3cbc8c49337dbdb8672417669b08737b7ccd9863d76ba96f53db3.jpeg","sheet",2,2,"none",4,{"blend":"screen","edge":10}),
 "portal2_unlocking": ("237628942532e48735f8af3e5d043ebddf6f7ce099e2c1135beb6c09d86ea11c.jpeg","sheet",2,4,"none",5,{"blend":"screen","edge":10}),
}


def build(slot, raw, kind, rows, cols, mode, extra):
    if kind == "image":
        im = raw.convert("RGBA") if mode == "none" else key_out(raw, mode)
        if im.height > 1024:
            sc = 1024 / im.height
            im = im.resize((int(im.width * sc), 1024), Image.LANCZOS)
        return im, 1
    W, H = raw.size
    cw, ch = W // cols, H // rows
    cells = []
    from PIL import ImageDraw
    for r in range(rows):
        for c in range(cols):
            cell = raw.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            if extra.get("crop_bottom"):
                cell = cell.crop((0, 0, cell.width, int(cell.height * (1 - extra["crop_bottom"]))))
            cell = key_out(cell, mode)
            if extra.get("edge") and mode == "none":
                d = ImageDraw.Draw(cell)
                m2 = extra["edge"]
                for box in ([0,0,cell.width,m2],[0,cell.height-m2,cell.width,cell.height],
                            [0,0,m2,cell.height],[cell.width-m2,0,cell.width,cell.height]):
                    d.rectangle(box, fill=(0,0,0,255))
            bb = bbox_alpha(cell, mode)
            if bb:
                cells.append(cell.crop(bb))
    fw = max(c.width for c in cells) + 8
    fh = max(c.height for c in cells) + 8
    strip = Image.new("RGBA", (fw * len(cells), fh), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        strip.paste(c, (i * fw + (fw - c.width) // 2, fh - c.height - 4), c)
    if mode == "none":
        bg = Image.new("RGBA", strip.size, (0, 0, 0, 255))
        bg.paste(strip, (0, 0), strip)
        strip = bg
    if fh > 512:
        sc = 512 / fh
        strip = strip.resize((int(strip.width * sc), 512), Image.LANCZOS)
    return strip, len(cells)


async def main():
    from motor.motor_asyncio import AsyncIOMotorClient
    from services.storage import media_dir
    from services.storage_adapter import get_storage_adapter, S3CompatibleAdapter
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    ad = get_storage_adapter()
    now = datetime.now(timezone.utc).isoformat()
    assets = {}
    for slot, (f, kind, rows, cols, mode, fps, extra) in CFG.items():
        try:
            raw = Image.open(io.BytesIO(requests.get(J + f, timeout=60).content)).convert("RGB")
        except Exception as e:
            print("DOWNLOAD FAIL", slot, e)
            continue
        im, frames = build(slot, raw, kind, rows, cols, mode, extra)
        fn = uuid.uuid4().hex + ".png"
        local = media_dir("images") / fn
        im.save(str(local), "PNG", optimize=True)
        if isinstance(ad, S3CompatibleAdapter):
            tmp = Path(tempfile.mkdtemp()) / fn
            shutil.copy(local, tmp)
            ad.put("images", fn, tmp)
        await db.orai_assets.insert_one({
            "id": uuid.uuid4().hex, "type": "game_asset", "subtype": kind,
            "title": f"Jungle Nexus — {slot}", "tags": ["action_rpg_2_5d", slot],
            "search_keywords": [slot], "creator_id": "e3cd1aab-6009-49f8-ac90-62736509699a",
            "creator_username": "stealth", "project_id": None, "game_id": GID,
            "provider": "orai_image_engine", "model": "gemini-3.1-flash-image",
            "prompt": f"phase19 {slot}", "settings": {"slot": slot}, "refs": {},
            "privacy": "private", "eligibility": "owner_only", "moderation_status": "clean",
            "archived": False, "usage_count": 0, "file_name": fn,
            "created_at": now, "updated_at": now})
        assets[slot] = {"url": f"/api/public/game-assets/{fn}",
                        "meta": {"kind": kind, "frames": frames, "fps": fps,
                                 "width": im.width, "height": im.height,
                                 "blend": extra.get("blend", "normal")}}
        print("OK", slot, frames, "f", im.width, "x", im.height)
    g = await db.games.find_one({"id": GID}, {"_id": 0, "spec.assets": 1})
    merged = {**(g["spec"].get("assets") or {}), **assets}
    await db.games.update_one({"id": GID}, {"$set": {"spec.assets": merged, "updated_at": now}})
    print("wired", len(assets))

asyncio.run(main()) if __name__ == "__main__" else None
