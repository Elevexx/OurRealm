"""Arcane Hearth AAA 2D asset batch (founder OpenAI key). Resumable."""
import os
import sys
import traceback

sys.path.insert(0, "/app/backend")
from scripts.wkq_gen import generate, RAW_DIR  # noqa: E402

MAEVE = ("MAEVE O'ROURKE, the Arcane Hearth traveling chef: young woman early-to-mid 20s, warm "
         "freckled face, green-hazel eyes, long AUBURN-COPPER hair in a braid over her shoulder. "
         "Outfit: original Irish traveling-chef fantasy garb — emerald and teal tunic with Celtic "
         "knotwork trim, copper-buckled leather bodice, warm-gold sash, sturdy boots. Equipment: "
         "copper-hilted culinary blade, round copper PAN SHIELD, copper cooking backpack with "
         "hanging utensils. Palette: emerald #2e7d4f, teal #2f8f8f, copper #b3702d, warm gold #d9a441")
STYLE = "AAA hand-painted fantasy game art, bright saturated cinematic firelight, clean silhouette, no text, no logos, no watermark, no presentation board"

JOBS = [
    ("maeve_ref", f"Character reference sheet, exactly three full-body panels side by side of the SAME character: FRONT view, SIDE view (facing right), BACK view. {MAEVE}. Neutral standing pose, arms slightly away from body, consistent proportions across panels. {STYLE}", "1536x1024", True, None),
    ("maeve_sprite", f"Single full-body game character, three-quarter top-down view angle (as seen from a high camera), standing confident pose. {MAEVE}. {STYLE}, single character only", "1024x1536", True, None),
    ("npc_sean", f"Single full-body game NPC, three-quarter top-down view: SEAN O'BRIEN — cheerful sturdy Irish harbor chef, short red beard, flat cap, rolled sleeves, sea-green apron with Celtic trim, holding a wooden ladle. {STYLE}, single character only", "1024x1536", True, None),
    ("npc_brasso", f"Single full-body game NPC, three-quarter top-down view: BRASSO KETTLE — burly steampunk forge chef, brass goggles on forehead, leather smith-apron with copper rivets, thick gloves, kettle-shaped backpack venting steam. {STYLE}, single character only", "1024x1536", True, None),
    ("npc_tahir", f"Single full-body game NPC, three-quarter top-down view: TAHIR AZIZ — elegant festival spice-master chef, warm brown skin, short dark beard, saffron-and-teal robes with gold festival embroidery, tray of glowing spices. {STYLE}, single character only", "1024x1536", True, None),
    ("foe_mask_guardian", f"Video game BOSS, three-quarter top-down view: the MASK GUARDIAN — tall imposing spirit wearing a huge ornate gilded festival mask, flowing indigo ceremonial robes with ember embroidery, clawed copper gauntlets, floating slightly. {STYLE}, single character only", "1024x1536", True, None),
    ("arc_ground_l1", "Seamless tileable video game ground texture, top-down: warm sea-worn harbor kitchen flagstones with subtle Celtic knot engravings, sandy grout, small scattered herbs, bright daylight. Flat orthographic, tiles perfectly, no text", "1024x1024", False, None),
    ("arc_ground_l3", "Seamless tileable video game ground texture, top-down: riveted copper and bronze foundry floor plates with steam vents and glowing seam lines, industrial fantasy. Flat orthographic, tiles perfectly, no text", "1024x1024", False, None),
    ("arc_ground_l5", "Seamless tileable video game ground texture, top-down: festival citadel mosaic tiles in emerald, gold and indigo forming radiant Celtic patterns, subtle candle-glow highlights. Flat orthographic, tiles perfectly, no text", "1024x1024", False, None),
    ("arc_wall_l1", "Seamless tileable video game wall texture: whitewashed harbor-stone wall with teal wooden beams, hanging copper pots and dried herbs, bright and welcoming. Flat orthographic, tiles perfectly, no text", "1024x1024", False, None),
    ("arc_wall_l3", "Seamless tileable video game wall texture: dark copper boiler-plate wall with brass pipes, pressure gauges and warm furnace glow seams, industrial fantasy. Flat orthographic, tiles perfectly, no text", "1024x1024", False, None),
    ("arc_wall_l5", "Seamless tileable video game wall texture: festival citadel wall of carved emerald stone with gold Celtic arches and glowing paper lanterns. Flat orthographic, tiles perfectly, no text", "1024x1024", False, None),
]


def run():
    for slug, prompt, size, transp, refs in JOBS:
        if os.path.exists(f"{RAW_DIR}/{slug}.png"):
            print(f"[skip] {slug} exists")
            continue
        try:
            generate(slug, prompt, size=size, transparent=transp, quality="high", ref_paths=refs)
        except Exception as e:
            print(f"[FAIL] {slug}: {e}")
            traceback.print_exc()
    print("ARCANE BATCH DONE")


if __name__ == "__main__":
    run()
