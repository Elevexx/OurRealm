import { useEffect, useRef, useCallback } from "react";
import { FOREST_MAP, BLOCKED, SPAWN_DRAGONS, sfx } from "./engine";
import { drawTile, drawSprite, DRAGON_PX, WIZARD_PX, WIZ_PAL, ELEM_PAL } from "./sprites";

/* Exploration view: canvas tile map, keyboard + tap movement, mobile D-pad. */
export const ExploreView = ({ pos, setPos, dragons, resolved, chestOpen, onEncounter, onNpc, onChest, onBossGate, reducedMotion }) => {
  const canvasRef = useRef(null);
  const tickRef = useRef(0);
  const posRef = useRef(pos);
  posRef.current = pos;

  const tileAt = (x, y) => (FOREST_MAP[y] || "")[x] || "T";

  const tryMove = useCallback((dx, dy) => {
    const p = posRef.current;
    const nx = p.x + dx, ny = p.y + dy;
    const ch = tileAt(nx, ny);
    if (BLOCKED.has(ch)) { return; }
    if (ch === "N") { onNpc(); return; }
    if (ch === "C") { if (!chestOpen) onChest(); return; }
    if (ch === "B") { onBossGate(); return; }
    if (/[1-6]/.test(ch)) {
      const id = SPAWN_DRAGONS[ch];
      if (!resolved.includes(id)) { onEncounter(id); return; }
    }
    sfx("step");
    setPos({ x: nx, y: ny });
  }, [resolved, chestOpen, onEncounter, onNpc, onChest, onBossGate, setPos]);

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      const map = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
      if (map[k]) { e.preventDefault(); tryMove(...map[k]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tryMove]);

  useEffect(() => {
    let raf;
    const cv = canvasRef.current;
    const ctx = cv.getContext("2d");
    const W = FOREST_MAP[0].length, H = FOREST_MAP.length;
    const draw = () => {
      const s = cv.width / W;
      tickRef.current += 1;
      const tick = reducedMotion ? 0 : tickRef.current;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ch = tileAt(x, y);
        drawTile(ctx, /[1-6SN]/.test(ch) ? "." : ch, x * s, y * s, s, tick);
        if (ch === "N") drawTile(ctx, "N", x * s, y * s, s, tick);
        if (/[1-6]/.test(ch)) {
          const id = SPAWN_DRAGONS[ch];
          if (!resolved.includes(id)) {
            const el = dragons[id]?.element || "nature";
            const bob = reducedMotion ? 0 : Math.sin(tick / 14 + x) * 2;
            drawSprite(ctx, DRAGON_PX, ELEM_PAL[el], x * s + s * 0.08, y * s + bob + s * 0.05, s / 16);
          }
        }
      }
      const p = posRef.current;
      drawSprite(ctx, WIZARD_PX, WIZ_PAL, p.x * s + s * 0.1, p.y * s + s * 0.02, s / 13.5);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [dragons, resolved, reducedMotion]);

  const tapCanvas = (e) => {
    const cv = canvasRef.current;
    const r = cv.getBoundingClientRect();
    const s = r.width / FOREST_MAP[0].length;
    const tx = Math.floor((e.clientX - r.left) / s), ty = Math.floor((e.clientY - r.top) / s);
    const p = posRef.current;
    const dx = tx - p.x, dy = ty - p.y;
    if (Math.abs(dx) + Math.abs(dy) === 0) return;
    if (Math.abs(dx) >= Math.abs(dy)) tryMove(Math.sign(dx), 0); else tryMove(0, Math.sign(dy));
  };

  const DBtn = ({ label, dx, dy, testid }) => (
    <button className="w-12 h-12 rounded-xl text-lg font-bold active:scale-90 transition-transform"
      style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff" }}
      data-testid={testid} aria-label={`Move ${testid}`}
      onPointerDown={(e) => { e.preventDefault(); tryMove(dx, dy); }}>{label}</button>
  );

  return (
    <div className="relative select-none" data-testid="dr-explore">
      <canvas ref={canvasRef} width={800} height={560} onPointerDown={tapCanvas}
        className="w-full rounded-xl cursor-pointer" style={{ imageRendering: "pixelated", border: "3px solid #10102a" }}
        aria-label="Enchanted Forest map — use arrow keys, WASD or tap a direction to move" />
      <div className="absolute bottom-3 left-3 sm:hidden">
        <div className="flex justify-center"><DBtn label="▲" dx={0} dy={-1} testid="dr-dpad-up" /></div>
        <div className="flex gap-12"><DBtn label="◀" dx={-1} dy={0} testid="dr-dpad-left" /><DBtn label="▶" dx={1} dy={0} testid="dr-dpad-right" /></div>
        <div className="flex justify-center"><DBtn label="▼" dx={0} dy={1} testid="dr-dpad-down" /></div>
      </div>
    </div>
  );
};

export default ExploreView;
