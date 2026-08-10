"""Batch-generate all Skybound Chef AAA assets (founder OpenAI key).
Sequential, resumable: skips slugs whose raw file already exists."""
import os
import sys
import traceback

sys.path.insert(0, "/app/backend")
from scripts.wkq_gen import generate, RAW_DIR  # noqa: E402

REF = f"{RAW_DIR}/aurora_master.png"
AURORA = ("the reference character AURORA exactly — same face, same long black hair "
          "with side fringe and ponytail, same bright blue eyes, same navy futuristic "
          "chef-streetwear outfit with cyan neon trim and orange accents, same glowing "
          "cyan culinary-energy blade and brushed-steel pan shield, same tech cooking pack")
STYLE = ("AAA hand-painted game art, crisp clean silhouette, dramatic rim lighting, high "
         "detail, single character only, full body head-to-toe visible, side view facing "
         "right, no text, no logos, no watermark, no presentation board")

HERO = {
    "hero_idle": "redraw her standing in a relaxed alert idle stance, strictly true SIDE VIEW profile facing right, blade lowered at her side, weight even",
    "hero_run": "redraw her in a full sprint run pose, mid-stride, hair and apron flowing behind her",
    "hero_jump_rise": "redraw her leaping upward, knees tucked, blade arm raised, dynamic ascent pose",
    "hero_jump_fall": "redraw her falling downward, arms out for balance, hair blown upward, alert expression",
    "hero_attack": "redraw her mid-slash, sweeping her glowing cyan culinary-energy blade in a wide forward arc, cyan energy trail",
    "hero_cast": "redraw her thrusting her gauntlet forward, launching a glowing orange spice-energy projectile burst",
    "hero_dash": "redraw her in a low forward dash lunge, body horizontal-leaning, cyan speed lines trailing",
    "hero_hurt": "redraw her recoiling backward from a hit, grimacing, shield raised defensively",
    "hero_death": "redraw her collapsed on one knee, head bowed, blade planted in the ground, exhausted but dignified",
}

FOES = {
    "foe_walker": "Video game enemy sprite: the WIND-UP PANTRY IMP — small mischievous mechanical imp built from pantry tins and copper clockwork, a large turning wind-up key on its back, glowing orange eyes, tiny fork spear. Full body, side view facing left. AAA hand-painted game art, clean silhouette, no text, no watermark",
    "foe_bat": "Video game flying enemy sprite: the CLOUD SPICE WISP — small winged creature formed of swirling paprika-orange and cyan spice vapor, bat-like wing silhouette, glowing ember eyes, wisps trailing. Full body, side view. AAA hand-painted game art, no text",
    "foe_brute": "Video game heavy enemy sprite: the STEAM AUTOMATON — hulking bronze-and-navy steam-powered kitchen automaton, pressure gauges and copper pipes venting steam, massive skillet fists, glowing furnace core. Full body, side view facing left. AAA hand-painted game art, no text",
    "foe_golem": "Video game BOSS sprite: the HEARTH GUARDIAN — towering ember-forged obsidian golem with a molten culinary hearth blazing in its chest, copper inlays, a crown of blue arcane flame, massive stone ladle arm. Full body, side view facing left, imposing. AAA hand-painted game art, no text",
}

ITEMS = {
    "item_key": ("Premium AAA fantasy game item, centered: the EMERALD REALM KEY — a brilliant emerald-green "
                 "crystal key of masterwork fantasy craftsmanship, glimmering internal light, ornate gold "
                 "Celtic-knotwork metal bow and details, floating animated green magical particles, magical "
                 "reflective highlights, upright vertical orientation. Museum-quality render, no text, no watermark"),
    "item_gem": "Game pickup sprite: a cut cyan-blue arcane gem, glowing from within, faceted, floating sparkles, centered. AAA game art, no text",
    "item_potion": "Game pickup sprite: a small round red health potion flask with cork, glowing warm liquid, subtle heart-shaped shimmer, centered. AAA game art, no text",
    "item_chest": "Game prop sprite: a closed ornate navy-and-brass treasure chest, cyan glow leaking from the seams, sturdy sky-pirate design, centered. AAA game art, no text",
    "checkpoint_obelisk": "Game prop sprite: a slender carved sky-stone checkpoint obelisk with a glowing emerald rune and a small teal banner, weathered brass base, upright, centered. AAA game art, no text",
    "torch_flame": "Game FX sprite: a stylized dancing orange flame with a cyan-blue core, painterly, centered on empty background. AAA game art, no text",
    "portal_frame": "Game prop sprite: an ornate circular ring-gate archway frame of carved sky-stone and brass with cyan rune inlays, completely EMPTY OPEN center hole, upright circle, centered. AAA game art, no text",
    "portal_locked": "Game FX sprite: a dim dormant swirling grey-blue portal energy disc, faint slow vortex, low glow, circular, centered. AAA game art, no text",
    "portal_active": "Game FX sprite: a brilliant swirling cyan-blue portal energy vortex disc, radiant, luminous spiral core, circular, centered. AAA game art, no text",
}

ENV = {
    "bg_skyharbor_far": "Breathtaking video game background panorama: a floating sky-harbor market city at bright golden morning — floating islands with market docks, airships with orange sails, waterfalls cascading off island edges into a sea of clouds, distant crystal spires, warm sunlight. Palette: navy, cyan, orange, white. Painterly AAA side-scroller background, wide composition, no text, no watermark, no characters",
    "bg_neon_far": "Video game background panorama at night: a neon sushi district floating among clouds — glowing cyan and magenta abstract sign glyphs (no readable words), rain-slick tiered rooftops, strings of paper lanterns, a holographic koi swimming between towers, deep navy starfield sky. Painterly AAA side-scroller background, wide composition, no readable text, no watermark, no characters",
    "bg_nexus_far": "Video game background panorama: the ARCANE HEARTH NEXUS — a colossal ancient kitchen-temple sanctum, floating ember braziers, pillars of blue arcane flame, obsidian and copper architecture, warm firelight glow against deep indigo shadow, embers drifting. Painterly AAA side-scroller background, wide composition, no text, no watermark, no characters",
    "tile_skyharbor": "Seamless tileable video game platform texture: sun-warmed wooden dock planks with brass fittings, rope edging and subtle cyan paint marks, top-lit. Flat orthographic, tiles perfectly, no text",
    "tile_neon": "Seamless tileable video game platform texture: dark rooftop metal panels with cyan neon edge strips, rivets and grates, night lighting. Flat orthographic, tiles perfectly, no text",
    "tile_nexus": "Seamless tileable video game platform texture: obsidian stone blocks with glowing copper rune inlays and faint ember cracks. Flat orthographic, tiles perfectly, no text",
}

MID = {
    "bg_skyharbor_mid": "Parallax mid-ground layer for a 2D side-scroller: a row of silhouetted floating market stalls, loading cranes, mooring masts and canvas awnings in muted navy-teal tones occupying ONLY the bottom third of the image; the entire upper two-thirds is completely empty flat solid pure magenta #FF00FF. No text",
    "bg_neon_mid": "Parallax mid-ground layer for a 2D side-scroller: silhouetted neon rooftop water towers, antennae, hanging lantern strings and vent stacks with faint cyan edge glow in dark navy tones occupying ONLY the bottom third of the image; the entire upper two-thirds is completely empty flat solid pure magenta #FF00FF. No readable text",
    "bg_nexus_mid": "Parallax mid-ground layer for a 2D side-scroller: silhouetted obsidian temple columns, brazier stands and copper arches with faint ember glow in deep indigo tones occupying ONLY the bottom third of the image; the entire upper two-thirds is completely empty flat solid pure magenta #FF00FF. No text",
}


def run():
    jobs = []
    for slug, p in HERO.items():
        jobs.append((slug, f"Using {AURORA}, {p}. {STYLE}", "1024x1536", True, [REF]))
    for slug, p in FOES.items():
        jobs.append((slug, p, "1024x1024", True, None))
    for slug, p in ITEMS.items():
        jobs.append((slug, p, "1024x1024", True, None))
    for slug, p in ENV.items():
        sz = "1536x1024" if slug.startswith("bg_") else "1024x1024"
        jobs.append((slug, p, sz, False, None))
    for slug, p in MID.items():
        jobs.append((slug, p, "1536x1024", True, None))
    for slug, prompt, size, transp, refs in jobs:
        if os.path.exists(f"{RAW_DIR}/{slug}.png"):
            print(f"[skip] {slug} exists")
            continue
        try:
            generate(slug, prompt, size=size, transparent=transp, quality="high", ref_paths=refs)
        except Exception as e:
            print(f"[FAIL] {slug}: {e}")
            traceback.print_exc()
    print("BATCH DONE")


if __name__ == "__main__":
    run()
