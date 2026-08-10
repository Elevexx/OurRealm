"""Asset validators — reject defective generated/uploaded game art before it
is wired into gameplay (founder directive: no baked transparency
checkerboards, no empty art, no sheet/background mix-ups)."""
import io

from PIL import Image


def _blocks(gray, bs):
    w, h = gray.size
    cols, rows = w // bs, h // bs
    px = gray.load()
    means = []
    step = max(1, bs // 4)
    for r in range(rows):
        row = []
        for c in range(cols):
            s = n = 0
            for y in range(r * bs, r * bs + bs, step):
                for x in range(c * bs, c * bs + bs, step):
                    s += px[x, y]
                    n += 1
            row.append(s / max(1, n))
        means.append(row)
    return means


def checkerboard_score(raw: bytes) -> float:
    """0..1 — how strongly the image contains a baked transparency checkerboard."""
    try:
        im = Image.open(io.BytesIO(raw)).convert("L").resize((128, 128))
    except Exception:  # noqa: BLE001
        return 0.0
    best = 0.0
    for bs in (2, 4, 8, 16, 32):
        m = _blocks(im, bs)
        rows, cols = len(m), len(m[0]) if m else 0
        if rows < 3 or cols < 3:
            continue
        match = total = 0
        vals_a, vals_b = [], []
        for r in range(rows - 1):
            for c in range(cols - 1):
                total += 2
                # checker: horizontal & vertical neighbours flip brightness
                if abs(m[r][c] - m[r][c + 1]) > 8:
                    match += 1
                if abs(m[r][c] - m[r + 1][c]) > 8:
                    match += 1
                (vals_a if (r + c) % 2 == 0 else vals_b).append(m[r][c])
        if not total or not vals_a or not vals_b:
            continue
        alt = match / total
        # transparency checkers are two TIGHT light-gray clusters
        avg_a, avg_b = sum(vals_a) / len(vals_a), sum(vals_b) / len(vals_b)
        var_a = sum((v - avg_a) ** 2 for v in vals_a) / len(vals_a)
        var_b = sum((v - avg_b) ** 2 for v in vals_b) / len(vals_b)
        tight = var_a < 90 and var_b < 90 and abs(avg_a - avg_b) > 12
        light = min(avg_a, avg_b) > 120
        score = alt * (1.0 if (tight and light) else 0.35)
        best = max(best, score)
    return round(best, 3)


def transparent_fraction(raw: bytes) -> float:
    try:
        im = Image.open(io.BytesIO(raw)).convert("RGBA").resize((64, 64))
    except Exception:  # noqa: BLE001
        return 0.0
    a = list(im.getdata())
    return sum(1 for p in a if p[3] < 16) / len(a)


def validate_asset(raw: bytes, slot_key: str, slot_def: dict) -> list[str]:
    """Returns a list of human-readable rejection reasons (empty = pass)."""
    errs = []
    try:
        im = Image.open(io.BytesIO(raw))
        w, h = im.size
    except Exception:  # noqa: BLE001
        return ["file is not a readable image"]
    if w < 64 or h < 64:
        errs.append(f"image too small ({w}x{h})")
    cb = checkerboard_score(raw)
    if cb >= 0.55:
        errs.append(f"baked transparency-checkerboard pattern detected (score {cb})")
    tf = transparent_fraction(raw)
    if slot_def.get("transparent"):
        if tf > 0.985:
            errs.append("image is almost entirely transparent (empty art)")
    else:
        # backgrounds/tilesets must not have big transparent holes
        if tf > 0.25:
            errs.append(f"opaque slot '{slot_key}' has {round(tf * 100)}% transparent area (missing layer?)")
        ar = w / h
        if slot_def.get("anim") and ar < 1.5:
            errs.append("animation sheet slot received a non-sheet aspect ratio")
    return errs
