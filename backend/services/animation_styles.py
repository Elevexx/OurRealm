"""Universal Animation Style registry — DB-backed so new styles/presets are
installable WITHOUT code changes. Seeded from DEFAULTS on first read.
Collections: animation_style_registry, animation_style_presets (per-user).
"""
import time
import uuid
from datetime import datetime, timezone

from core.db import db

_cache = {"at": 0.0, "styles": None}


def _s(sid, name, desc, prompt, subjects, ages, difficulty, g1, g2, camera="cinematic"):
    return {"id": sid, "name": name, "description": desc, "prompt_fragment": prompt,
            "recommended_subjects": subjects, "recommended_ages": ages,
            "difficulty": difficulty, "gradient": [g1, g2], "camera_hint": camera,
            "providers": ["openai"], "enabled": True}


DEFAULTS = [
    _s("auto", "Auto", "ORAi picks the best style for the subject and age", "", "any", "all", "easy", "#2EA0FF", "#C26BFF"),
    _s("photorealistic", "Photorealistic", "True-to-life footage look", "photorealistic, true-to-life detail, natural imperfections, realistic physics", "science, adult training", "13+", "hard", "#5a6b7a", "#1d2b36"),
    _s("cinematic_live", "Cinematic Live Action", "Film-grade live action", "cinematic live action, shallow depth of field, film grain, anamorphic lens, dramatic composition", "any", "13+", "hard", "#8a6d3b", "#1a1208"),
    _s("documentary", "Cinematic Documentary", "Premium documentary storytelling", "premium documentary style, natural lighting, steady observational camera, authentic settings", "history, science, nature", "13+", "medium", "#3b6d5a", "#0e1f18"),
    _s("pixar", "Pixar Inspired", "Warm polished 3D animation", "polished 3D animation in the style of a major animation studio, warm lighting, expressive characters, soft subsurface skin", "elementary, storytelling", "3-12", "easy", "#ff9d5c", "#5c2e91"),
    _s("dreamworks", "DreamWorks Inspired", "Bold playful 3D animation", "bold stylized 3D animation, exaggerated expressions, dynamic poses, punchy lighting", "elementary, adventure", "5-13", "easy", "#4fc3f7", "#173a5e"),
    _s("anime", "Anime", "Japanese animation aesthetic", "high-quality anime, cel shading, expressive eyes, dramatic speed lines, detailed backgrounds", "teens, gaming, story", "13+", "medium", "#ff5c8a", "#2b1055"),
    _s("manga", "Manga", "Black & white manga panels", "manga illustration, ink linework, screentone shading, dynamic panel-like compositions", "teens, story", "13+", "medium", "#dddddd", "#222222"),
    _s("comic", "Comic Book", "Bold western comic style", "comic book art, bold outlines, halftone dots, dynamic action framing, vibrant flats", "story, history", "8+", "easy", "#ffd23b", "#d7263d"),
    _s("cartoon", "Saturday Morning Cartoon", "Fun retro TV cartoon", "playful 2D cartoon, thick outlines, flat bright colors, bouncy squash-and-stretch motion", "young kids", "3-10", "easy", "#7ee081", "#2e86ab"),
    _s("childrens_book", "Children's Book", "Gentle storybook illustration", "gentle children's picture-book illustration, soft textures, whimsical friendly characters", "toddlers, early reading", "2-8", "easy", "#ffd9a0", "#8ac6d1"),
    _s("watercolor", "Watercolor", "Soft flowing watercolor", "delicate watercolor painting, soft washes, paper texture, bleeding pigment edges", "art, poetry, nature", "any", "easy", "#a8d8ea", "#aa96da"),
    _s("oil_painting", "Oil Painting", "Classical painted look", "classical oil painting, visible brush strokes, rich impasto texture, museum quality", "art, history", "13+", "medium", "#7a5c3b", "#2b1d0e"),
    _s("pencil", "Pencil Sketch", "Hand-drawn graphite", "hand-drawn pencil sketch, graphite shading, sketchbook linework, cross-hatching", "art, math diagrams", "any", "easy", "#cccccc", "#555555"),
    _s("chalk", "Chalk Drawing", "Chalkboard classroom", "white and colored chalk drawing on dark chalkboard, dusty strokes, classroom feel", "math, science", "any", "easy", "#e8e8e8", "#1d3b2a"),
    _s("claymation", "Claymation", "Handmade clay animation", "claymation stop-motion, sculpted plasticine characters, fingerprint texture, miniature sets", "young kids, crafts", "3-12", "medium", "#e07a5f", "#3d405b"),
    _s("stop_motion", "Stop Motion", "Charming frame-by-frame", "stop-motion animation, handcrafted puppets and props, slightly jittery charming motion", "crafts, story", "5+", "medium", "#f2cc8f", "#59413b"),
    _s("papercraft", "Paper Craft", "Layered cut-paper world", "layered paper-craft diorama, cut cardstock edges, subtle drop shadows, handmade feel", "young kids, geography", "3-12", "easy", "#f4a261", "#2a9d8f"),
    _s("lego", "LEGO Style", "Plastic brick world", "toy plastic brick construction world, studded bricks, minifigure-like characters, glossy plastic", "kids, engineering", "4-14", "easy", "#ffcf00", "#d7263d"),
    _s("low_poly", "Low Poly", "Faceted geometric 3D", "low-poly 3D, faceted geometry, flat shaded triangles, clean minimal palette", "tech, geography", "8+", "easy", "#43e97b", "#38f9d7"),
    _s("voxel", "Voxel", "3D pixel cubes", "voxel art, cubic 3D blocks, isometric charm, crisp cube-based world", "gaming, coding", "6+", "easy", "#66de93", "#2c786c"),
    _s("minecraft", "Minecraft Inspired", "Blocky sandbox world", "blocky cube sandbox game world, pixel textures, block-by-block construction", "kids, coding, engineering", "6-14", "easy", "#7bb661", "#5b3a29"),
    _s("roblox", "Roblox Inspired", "Playful blocky avatars", "playful blocky avatar game style, smooth plastic characters, vibrant game environments", "kids, gaming", "6-14", "easy", "#e84545", "#903749"),
    _s("fortnite", "Fortnite Inspired", "Vibrant stylized game art", "vibrant stylized battle-game art, exaggerated proportions, saturated colors, energetic outlines", "teens, gaming", "13+", "easy", "#7f5af0", "#2cb67d"),
    _s("stylized_3d", "Stylized 3D", "Modern stylized render", "modern stylized 3D render, simplified shapes, appealing color scripts, soft global illumination", "any", "any", "easy", "#5c6cff", "#00d4ff"),
    _s("realistic_3d", "Realistic 3D", "High-end 3D visualization", "high-end realistic 3D render, physically based materials, ray-traced lighting", "science, engineering", "13+", "hard", "#6d7b8d", "#22303c"),
    _s("cyberpunk", "Cyberpunk", "Neon-noir future city", "cyberpunk aesthetic, neon-soaked rain streets, holographic interfaces, high-tech low-life mood", "cybersecurity, tech", "13+", "medium", "#ff2a6d", "#05d9e8"),
    _s("scifi", "Sci-Fi", "Sleek futuristic worlds", "sleek science-fiction environments, futuristic technology, clean holographic UI, starship interiors", "space, physics, tech", "8+", "medium", "#00b4d8", "#03045e"),
    _s("fantasy", "Fantasy", "Epic magical worlds", "epic fantasy art, magical glowing effects, enchanted forests and castles, painterly grandeur", "story, mythology", "6+", "medium", "#9d4edd", "#10002b"),
    _s("medieval", "Medieval", "Historical medieval look", "medieval historical setting, castles, illuminated-manuscript accents, torchlit stone halls", "history", "8+", "medium", "#b08968", "#3f2e1e"),
    _s("steampunk", "Steampunk", "Brass gears & steam", "steampunk world, brass gears, steam pipes, Victorian machinery, warm copper tones", "history, engineering", "13+", "medium", "#c38e4e", "#3b2a1a"),
    _s("retro80s", "Retro 80s", "VHS-era nostalgia", "retro 1980s aesthetic, VHS grain, chrome text, sunset grids, nostalgic analog glow", "music, pop culture", "13+", "easy", "#ff6ec7", "#2d00f7"),
    _s("vaporwave", "Vaporwave", "Dreamy pastel retro-future", "vaporwave aesthetic, pastel pink and teal, marble statues, retro computer graphics, dreamy haze", "music, art", "13+", "easy", "#ff71ce", "#01cdfe"),
    _s("neon", "Neon", "Glowing neon energy", "glowing neon light aesthetic, dark backgrounds with vivid neon strokes and glow bloom", "music, tech", "13+", "easy", "#39ff14", "#7d12ff"),
    _s("motion_graphics", "Motion Graphics", "Clean animated explainers", "clean modern motion graphics, animated icons and shapes, smooth easing, explainer-video clarity", "math, business, science", "any", "easy", "#4361ee", "#4cc9f0"),
    _s("whiteboard", "Whiteboard Animation", "Hand drawing explainer", "whiteboard animation, a hand drawing diagrams in marker as concepts are explained step by step", "math, process", "any", "easy", "#f8f9fa", "#495057"),
    _s("infographic", "Infographic Style", "Data-forward visuals", "animated infographic style, charts, labeled callouts, clean data visualization, flat design", "business, statistics", "13+", "easy", "#06d6a0", "#118ab2"),
    _s("blueprint", "Blueprint Style", "Technical schematics", "technical blueprint style, white line schematics on blueprint blue, measurements and annotations", "engineering", "13+", "easy", "#caf0f8", "#03045e"),
    _s("archviz", "Architectural Visualization", "Photoreal spaces", "architectural visualization, photoreal interiors and exteriors, elegant camera glides", "design, engineering", "13+", "hard", "#adb5bd", "#212529"),
    _s("nature_doc", "Nature Documentary", "Wildlife cinematography", "wildlife nature documentary cinematography, telephoto closeups, golden-hour landscapes", "biology, geography", "any", "medium", "#606c38", "#283618"),
    _s("digital_painting", "Digital Painting", "Rich concept art", "rich digital painting, concept-art quality brushwork, dramatic light and color", "art, story", "8+", "medium", "#f77f00", "#003049"),
    _s("pixel_art", "Pixel Art", "Retro game pixels", "retro pixel art, crisp 16-bit sprites, limited palette, charming dithering", "gaming, coding", "6+", "easy", "#70e000", "#004b23"),
    _s("isometric", "Isometric", "Angled miniature worlds", "isometric 3D illustration, clean angled miniature worlds, orderly detail", "city, systems, logistics", "8+", "easy", "#ffb703", "#023047"),
    _s("chibi", "Cute Chibi", "Adorable mini characters", "cute chibi characters, oversized heads, tiny bodies, sparkly cheerful energy", "young kids, language", "3-12", "easy", "#ffafcc", "#a2d2ff"),
    _s("kawaii", "Kawaii", "Ultra-cute pastel world", "kawaii aesthetic, pastel colors, smiling objects, rounded adorable shapes", "young kids", "3-10", "easy", "#ffc8dd", "#cdb4db"),
    _s("comic_noir", "Comic Noir", "Moody ink shadows", "noir comic style, high-contrast ink shadows, rain-slicked streets, dramatic single-color accents", "story, history", "13+", "medium", "#e63946", "#1d1d1d"),
]

CAMERA_STYLES = ["Auto", "Static", "Slow Pan", "Dynamic", "Handheld", "Drone", "Orbit",
                 "First Person", "Third Person", "Side Scroll", "Top Down", "Classroom",
                 "Documentary", "Interview", "Action Camera", "Screen Recording", "Mixed",
                 "Time Lapse", "Hyperlapse"]


def _iso():
    return datetime.now(timezone.utc).isoformat()


async def get_styles() -> list:
    if _cache["styles"] and time.monotonic() - _cache["at"] < 60:
        return _cache["styles"]
    n = await db.animation_style_registry.count_documents({})
    if n == 0:
        await db.animation_style_registry.insert_many([{**s, "created_at": _iso()} for s in DEFAULTS])
    rows = await db.animation_style_registry.find({"enabled": {"$ne": False}}, {"_id": 0}).to_list(300)
    order = {s["id"]: i for i, s in enumerate(DEFAULTS)}
    rows.sort(key=lambda r: order.get(r["id"], 999))
    _cache.update(at=time.monotonic(), styles=rows)
    return rows


async def profile_to_prompt(profile: dict) -> str:
    """Turn a style_profile {primary, secondary, mix, custom_prompt, camera,
    quality:{...}} into a compact art-direction text fragment."""
    if not isinstance(profile, dict):
        return ""
    styles = {s["id"]: s for s in await get_styles()}
    parts = []
    prim = styles.get(profile.get("primary"))
    sec = styles.get(profile.get("secondary"))
    mix = int(profile.get("mix") or 100)
    if prim and prim["id"] != "auto" and prim.get("prompt_fragment"):
        if sec and sec.get("prompt_fragment") and mix < 100:
            parts.append(f"Visual style blend: {mix}% [{prim['name']}: {prim['prompt_fragment']}] "
                         f"+ {100 - mix}% [{sec['name']}: {sec['prompt_fragment']}]")
        else:
            parts.append(f"Visual style — {prim['name']}: {prim['prompt_fragment']}")
    if profile.get("custom_prompt"):
        parts.append(f"Custom art direction: {str(profile['custom_prompt'])[:600]}")
    cam = profile.get("camera")
    if cam and cam != "Auto":
        parts.append(f"Camera language: {cam}")
    q = profile.get("quality") or {}
    ql = [f"{k.replace('_', ' ')} {v}/10" for k, v in q.items() if isinstance(v, (int, float))]
    if ql:
        parts.append("Quality targets: " + ", ".join(ql[:12]))
    for k, label in (("negative_prompt", "Avoid"), ("lighting_prompt", "Lighting"),
                     ("motion_prompt", "Motion"), ("palette_prompt", "Color palette"),
                     ("environment_prompt", "Environment")):
        if profile.get(k):
            parts.append(f"{label}: {str(profile[k])[:250]}")
    return "\n".join(parts)


async def save_preset(user_id: str, name: str, profile: dict) -> dict:
    doc = {"id": uuid.uuid4().hex, "user_id": user_id, "name": str(name)[:60],
           "profile": profile, "created_at": _iso()}
    await db.animation_style_presets.update_one(
        {"user_id": user_id, "name": doc["name"]}, {"$set": doc}, upsert=True)
    return doc


async def list_presets(user_id: str) -> list:
    return await db.animation_style_presets.find(
        {"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)


ANTI_FALLBACK = ("STRICT STYLE ENFORCEMENT: render ONLY in the style specified above. "
                 "Absolutely NO children's-book, cartoon, chibi, or cute-illustration "
                 "rendering unless that style was explicitly selected. Match the realism "
                 "level, palette and rendering technique exactly.")


async def resolve_style(course: dict, lesson_override: dict = None) -> dict:
    """One canonical resolved style object: lesson override > course profile,
    merged with the storyboard style bible + grade/subject context."""
    course = course or {}
    profile = dict(lesson_override or course.get("style_profile") or {})
    sb = course.get("storyboard") or {}
    return {"profile": profile, "storyboard": sb,
            "grade_level": course.get("grade_level"), "subject": course.get("subject"),
            "primary": profile.get("primary"), "secondary": profile.get("secondary"),
            "mix": profile.get("mix"), "camera": profile.get("camera")}


async def style_directive(course: dict, lesson_override: dict = None) -> str:
    """Authoritative art-direction text injected into EVERY media prompt."""
    resolved = await resolve_style(course, lesson_override)
    parts = []
    art = await profile_to_prompt(resolved["profile"])
    if art:
        parts.append(art)
    sb = resolved["storyboard"]
    if sb:
        parts.append("Course style bible (keep consistent): " + "; ".join(
            str(sb.get(k) or "") for k in ("visual_style", "characters", "environment", "palette", "branding")
            if sb.get(k))[:600])
    has_style = resolved["primary"] and resolved["primary"] != "auto"
    if has_style or resolved["profile"].get("custom_prompt"):
        parts.append(ANTI_FALLBACK)
    return "\n".join(parts)
