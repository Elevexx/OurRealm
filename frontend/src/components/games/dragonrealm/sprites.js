/* Pixel sprite sheets for renderer_pixel_creature_rpg_v1 (original artwork). */

export const ELEM_PAL = {
  fire: { a: "#d64b2a", b: "#f4a73b", c: "#7a1f0e" },
  nature: { a: "#3f9e4d", b: "#8fd45f", c: "#1d5a28" },
  earth: { a: "#8a6a3f", b: "#c9a05e", c: "#4c3820" },
  light: { a: "#e8c34d", b: "#fff2b0", c: "#a8842a" },
  ice: { a: "#6db8e8", b: "#c9ecff", c: "#2a6a9e" },
  lightning: { a: "#e8d84d", b: "#fffba0", c: "#8a7a1a" },
  water: { a: "#3f7ede", b: "#8fc9f0", c: "#1d3a8a" },
  crystal: { a: "#a86de8", b: "#e0c9ff", c: "#5a2a9e" },
  shadow: { a: "#4a3a6a", b: "#8a7aae", c: "#1a1030" },
  air: { a: "#9ec9d8", b: "#e8f6ff", c: "#5a8a9e" },
};

// '.'=transparent  a/b/c = palette  e = eye white  p = pupil  k = dark outline
export const DRAGON_PX = [
  "....kk........",
  "...kaak...kk..",
  "..kaaaak.kaak.",
  ".kaeapak.kaak.",
  ".kaaaaakkaaak.",
  "..kaaabbaaak..",
  "...kabbbbak...",
  "..kaabbbbaak..",
  ".kaabbbbbbaak.",
  ".kabbbbbbbbak.",
  "..kabbbbbbak..",
  "...kacccak....",
  "....kacak.....",
  ".....kkk......",
];
export const BOSS_PX = [
  "..kk.......kk...",
  ".kaak..kk.kaak..",
  "kaaaakkaakkaaaak",
  "kaeapkaaaakaeapk",
  "kaaaaaaaaaaaaaak",
  ".kaaabbbbbbaaak.",
  "..kabbbbbbbbak..",
  ".kaabbbbbbbbaak.",
  "kaabbbbbbbbbbaak",
  "kabbbbbbbbbbbbak",
  ".kabbccccccbbak.",
  "..kabccccccbak..",
  "...kaccccccak...",
  "....kacccak.....",
  ".....kacak......",
  "......kkk.......",
];
export const WIZARD_PX = [
  "....hhh.....",
  "...hhhhh....",
  "..hhhhhhh.s.",
  ".hhhhhhhhhs.",
  "....fff...s.",
  "...feffp..s.",
  "...ffff...s.",
  "..rrrrrr.gs.",
  ".rrrrrrrrgs.",
  ".rrrrrrrr.s.",
  "..rrrrrr..s.",
  "..rr..rr....",
];
export const WIZ_PAL = { h: "#2a4ae8", f: "#f0c9a0", r: "#3a5af0", s: "#8a6a3f", g: "#f4d34d", e: "#fff", p: "#1a1a2a", k: "#10102a" };

export function drawSprite(ctx, rows, pal, x, y, s, flip = false) {
  const w = rows[0].length;
  for (let ry = 0; ry < rows.length; ry++) {
    for (let rx = 0; rx < w; rx++) {
      const ch = rows[ry][flip ? w - 1 - rx : rx];
      if (ch === ".") continue;
      ctx.fillStyle = ch === "e" ? "#fff" : ch === "p" ? "#1a1a2a" : ch === "k" ? "#10102a" : (pal[ch] || "#888");
      ctx.fillRect(Math.round(x + rx * s), Math.round(y + ry * s), Math.ceil(s), Math.ceil(s));
    }
  }
}

export function drawTile(ctx, ch, x, y, s, tick) {
  ctx.fillStyle = "#2f7a35"; ctx.fillRect(x, y, s, s); // grass base
  if ((x / s + y / s) % 2 === 0) { ctx.fillStyle = "rgba(255,255,255,0.03)"; ctx.fillRect(x, y, s, s); }
  if (ch === "p") { ctx.fillStyle = "#b89a5e"; ctx.fillRect(x, y, s, s); ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(x + s * 0.2, y + s * 0.3, s * 0.2, s * 0.15); }
  else if (ch === "T") {
    ctx.fillStyle = "#5a3a1e"; ctx.fillRect(x + s * 0.4, y + s * 0.55, s * 0.2, s * 0.4);
    ctx.fillStyle = "#1d5a28"; ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.35, s * 0.4, 0, 7); ctx.fill();
    ctx.fillStyle = "#3f9e4d"; ctx.beginPath(); ctx.arc(x + s * 0.38, y + s * 0.3, s * 0.22, 0, 7); ctx.fill();
  } else if (ch === "w") {
    ctx.fillStyle = "#2a5a9e"; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(x + ((tick / 20 + x) % s), y + s * 0.3, s * 0.25, 2);
  } else if (ch === "r") { ctx.fillStyle = "#7a7a8a"; ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.6, s * 0.32, 0, 7); ctx.fill(); }
  else if (ch === "f") {
    ctx.fillStyle = "#e85aa0"; ctx.fillRect(x + s * 0.3, y + s * 0.3, 3, 3);
    ctx.fillStyle = "#f4d34d"; ctx.fillRect(x + s * 0.6, y + s * 0.55, 3, 3);
  } else if (ch === "C") {
    ctx.fillStyle = "#8a5a1e"; ctx.fillRect(x + s * 0.2, y + s * 0.35, s * 0.6, s * 0.42);
    ctx.fillStyle = "#f4d34d"; ctx.fillRect(x + s * 0.44, y + s * 0.5, s * 0.12, s * 0.14);
  } else if (ch === "B") {
    ctx.fillStyle = "#4a2a5a"; ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.85);
    ctx.fillStyle = "#e84a4a"; ctx.font = `${s * 0.5}px monospace`; ctx.fillText("⚔", x + s * 0.25, y + s * 0.65);
  } else if (ch === "N") {
    ctx.fillStyle = "#e8c34d"; ctx.font = `${s * 0.55}px monospace`;
    ctx.fillText("!", x + s * 0.38, y + s * 0.35 + Math.sin(tick / 12) * 2);
  }
}
