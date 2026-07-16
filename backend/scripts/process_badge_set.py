"""Badge consistency pass v2 — radial medallion detection.
Opaque coin core + attached protrusions + circular glow falloff; kills
square backgrounds, vignettes and bokeh. Identical canvas/scale/center,
tiered glow, PNG+WebP export, QA gate, upload + assign."""
import io, os, sys, requests
import numpy as np
from PIL import Image

API = os.environ["API_URL"].rstrip("/")
H = {"Authorization": f"Bearer {os.environ['TOKEN']}"}
SRC = "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/{}.png"

SET = [
 ("Newbie",      "bacdc3a0711361f694024ff0dbc9e721e038b5e9850463c40a65af5fb4fad8a7", "glowing cyan sprout medallion",    "#4DD2FF", 1.00),
 ("Explorer",    "5904dbc7fa1fd8cccc6ae92d32e0eb669eb5edcb261059fc0e2f94d457f0dc00", "emerald compass rose medallion",   "#10E670", 1.05),
 ("Creator",     "68c8194c3fcab00b846252ee834b7056a2dd62e7effdf3f74292883abbae1740", "violet paintbrush medallion",      "#C26BFF", 1.10),
 ("Rising Star", "c5fa533df7d6d5054951316da20f45fc1dfcae27f3db6cd0140e0bd4cee82428", "blue shooting star medallion",     "#4DD2FF", 1.15),
 ("Influencer",  "0353e650de0b14f4d10ffd21e5a03c992a060e7f146d91b45fcd54cedfad973e", "orange megaphone winged crest",    "#FF7A18", 1.20),
 ("Elite",       "45d28d797b9be91dbd920c24c653aff988368d58d6e5079c7401a2818b1ea19d", "golden laurel chevron shield",     "#F4C84A", 1.25),
 ("Master",      "4c22aa2824db6f8c669ae230e8801ea06933b5c687113d98ef556e20a6d8713d", "crimson crossed swords and crown", "#FF3F5A", 1.30),
 ("Legend",      "c97d2611802197964e2dca61c8837b75132538a6962a6f337398a509153830b9", "radiant green phoenix over crown", "#00FF66", 1.40),
]

CANVAS = 1024
TARGET_DIAM = 760  # identical shield diameter in px on the canvas


def process(img, tier):
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    h, w, _ = a.shape
    corners = np.concatenate([a[:20, :20].reshape(-1, 3), a[:20, -20:].reshape(-1, 3),
                              a[-20:, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    diff = np.max(np.abs(a - bg), axis=2)
    strong = diff > 55

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # centroid of strong pixels near the middle (compositions are centered)
    mid = strong & (np.hypot(xx - w / 2, yy - h / 2) < 470)
    cy, cx = yy[mid].mean(), xx[mid].mean()
    dist = np.hypot(xx - cx, yy - cy)

    # medallion radius via ring density of strong pixels
    r_med = 200
    for r in range(500, 150, -4):
        ring = (dist >= r - 3) & (dist < r + 3)
        if strong[ring].mean() > 0.12:
            r_med = r
            break

    core_disk = dist <= 0.93 * r_med
    # keep only strong pixels CONNECTED to the coin (kills bokeh islands)
    cand = (strong | core_disk) & (dist <= 1.30 * r_med)
    from PIL import ImageDraw as _ID
    m = Image.fromarray((cand * 255).astype(np.uint8), mode="L")
    _ID.floodfill(m, (int(cx), int(cy)), 128)
    core = core_disk | (np.asarray(m) == 128)
    fall = np.clip((1.42 * r_med - dist) / (0.45 * r_med), 0, 1)  # 1 inside, 0 beyond 1.42r
    glow = np.clip((diff - 6.0) * 2.4, 0, 255) * fall * tier
    alpha = np.where(core, 255.0, np.clip(glow, 0, 255))

    # unmultiply glow colour against bg (outside core only)
    af = alpha / 255.0
    rgb = a.copy()
    gz = (~core) & (af > 0.003)
    for c in range(3):
        ch = a[:, :, c]
        out = np.clip((ch - bg[c] * (1 - af)) / np.maximum(af, 1e-3), 0, 255)
        rgb[:, :, c] = np.where(gz, out, ch)

    rgba = np.dstack([rgb.astype(np.uint8), alpha.astype(np.uint8)])
    im = Image.fromarray(rgba, mode="RGBA")

    scale = TARGET_DIAM / (2 * r_med)
    im = im.resize((int(round(w * scale)), int(round(h * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(im, (int(round(CANVAS / 2 - cx * scale)), int(round(CANVAS / 2 - cy * scale))), im)
    return canvas, r_med


def qa(name, im):
    arr = np.asarray(im)[:, :, 3].astype(np.float32)
    yy, xx = np.mgrid[0:CANVAS, 0:CANVAS].astype(np.float32)
    dist = np.hypot(xx - CANVAS / 2, yy - CANVAS / 2)
    bg_resid = arr[dist > 620].mean()                       # must be ~0
    # shield disk (r=TARGET_DIAM/2) is placed at canvas centre by
    # construction — verify it is fully opaque and identical for all badges
    disk_min = arr[dist <= TARGET_DIAM / 2 - 35].min()
    edge_clip = max(arr[0, :].max(), arr[-1, :].max(), arr[:, 0].max(), arr[:, -1].max())
    ok = bg_resid < 1.0 and disk_min >= 250 and edge_clip <= 8
    print(f"QA {name:12s} shieldDiskOpaque={disk_min >= 250} bgResid={bg_resid:.2f} edgeMax={edge_clip:.0f} -> {'PASS' if ok else 'FAIL'}")
    return ok


levels = requests.get(f"{API}/api/admin/progression/levels", headers=H).json()["levels"]
by_name = {l["name"]: l for l in levels}
all_ok = True
os.makedirs("/tmp/badges2", exist_ok=True)

for name, hsh, alt_suffix, glowc, tier in SET:
    raw = requests.get(SRC.format(hsh), timeout=30).content
    out, r_med = process(Image.open(io.BytesIO(raw)), tier)
    if not qa(name, out):
        all_ok = False
    slug = name.lower().replace(" ", "_")
    out.save(f"/tmp/badges2/{slug}.png", format="PNG", optimize=True)
    out.save(f"/tmp/badges2/{slug}.webp", format="WEBP", quality=92, method=6)

if not all_ok:
    print("QA FAILED — not uploading"); sys.exit(1)

for name, hsh, alt_suffix, glowc, tier in SET:
    slug = name.lower().replace(" ", "_")
    lvl = by_name[name]
    ups = {}
    for ext, mime in [("webp", "image/webp"), ("png", "image/png")]:
        with open(f"/tmp/badges2/{slug}.{ext}", "rb") as f:
            r = requests.post(f"{API}/api/images/upload", headers=H,
                              files={"file": (f"badge_{slug}_v3.{ext}", f.read(), mime)}).json()
        if "url" not in r:
            print("UPLOAD FAIL", name, ext, r); sys.exit(1)
        ups[ext] = r
    graphics = {**(lvl.get("graphics") or {}),
                "badge_url": ups["webp"]["url"],
                "badge_png_url": ups["png"]["url"],
                "badge_thumb_url": ups["webp"]["thumbnail_url"],
                "alt_text": f"{name} level badge — {alt_suffix}",
                "glow_color": glowc, "glow_intensity": tier,
                "locked_treatment": "darken"}
    r = requests.patch(f"{API}/api/admin/progression/levels/{lvl['id']}",
                       headers={**H, "Content-Type": "application/json"},
                       json={"graphics": graphics}).json()
    print(f"{name:12s} {ups['webp']['url']} functional={r.get('functional_change')}")
print("DONE")
