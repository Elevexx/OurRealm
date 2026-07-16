"""One-shot: import generated badge artwork into the media pipeline and
assign it to the 8 launch levels (cosmetic graphics update, no republish)."""
import io, os, sys, requests
from PIL import Image

API = os.environ["API_URL"].rstrip("/")
TOKEN = os.environ["TOKEN"]
H = {"Authorization": f"Bearer {TOKEN}"}

ART = {
    "Newbie":      ("9a5b2d684e4d1d398d0840ca19da8f22cf2191a7af30544cbfe71426693de1c6", "Newbie level badge — glowing cyan sprout shield", "#4DD2FF"),
    "Explorer":    ("185c4393fe7b1302d554e609b55556681f5fdcbf2017a3feb84b349f1329ee8f", "Explorer level badge — winged emerald compass", "#10E670"),
    "Creator":     ("ea888f3b234f4a27eb9ac8c2eaa564e3550ed63e3ff30543f168902a1c1c33f0", "Creator level badge — violet paintbrush hexagon", "#C26BFF"),
    "Rising Star": ("782f7c0972a6cc1267561f60e10d96b2f5d616c39f719291e5a9eca4d2b0f9fd", "Rising Star level badge — blue shooting star medallion", "#4DD2FF"),
    "Influencer":  ("398f42f07fa5e34faba9c13553443f60e412a646010710ab4c68767641afe922", "Influencer level badge — orange megaphone crest", "#FF7A18"),
    "Elite":       ("faf8cb7a2664cf5294c8ba0991a75713d183d54ba68a09399a135d2066a1c4c0", "Elite level badge — golden laurel shield", "#F4C84A"),
    "Master":      ("15315de8e83d686c5cda15b30fa9abf37f0c2d10ffb4b14891efa097aa39023b", "Master level badge — crimson crossed swords crown", "#FF3F5A"),
    "Legend":      ("814676d9f031dc615e53500e77d2ec98809d2ad3709ed520a96c75d5e20f5284", "Legend level badge — radiant green phoenix crown", "#00FF66"),
}
SRC = "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/{}.png"

levels = requests.get(f"{API}/api/admin/progression/levels", headers=H).json()["levels"]
by_name = {l["name"]: l for l in levels}

for name, (h, alt, glow) in ART.items():
    lvl = by_name.get(name)
    if not lvl:
        print("SKIP missing level", name); continue
    raw = requests.get(SRC.format(h), timeout=30).content
    if len(raw) > 2_800_000:  # respect 3MB cap — downscale keeping alpha
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        img.thumbnail((800, 800), Image.LANCZOS)
        buf = io.BytesIO(); img.save(buf, format="PNG", optimize=True)
        raw = buf.getvalue()
    up = requests.post(f"{API}/api/images/upload", headers=H,
                       files={"file": (f"badge_{name.lower().replace(' ', '_')}.png", raw, "image/png")}).json()
    if "url" not in up:
        print("UPLOAD FAIL", name, up); sys.exit(1)
    graphics = {**(lvl.get("graphics") or {}),
                "badge_url": up["url"], "badge_thumb_url": up["thumbnail_url"],
                "alt_text": alt, "glow_color": glow, "locked_treatment": "darken"}
    r = requests.patch(f"{API}/api/admin/progression/levels/{lvl['id']}",
                       headers={**H, "Content-Type": "application/json"},
                       json={"graphics": graphics}).json()
    print(name, "->", up["url"], "| thumb:", up["thumbnail_url"], "| functional_change:", r.get("functional_change"))
print("DONE")
