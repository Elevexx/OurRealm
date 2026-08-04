import { useEffect, useRef, useState } from "react";
import { act, turnOrder, spellsFor, ITEMS, SPELLS, sfx, aliveFoes, target } from "./engine";
import { drawSprite, DRAGON_PX, BOSS_PX, WIZARD_PX, WIZ_PAL, ELEM_PAL } from "./sprites";

const Bar = ({ val, max, color, label, testid }) => (
  <div className="mb-0.5">
    <div className="flex justify-between text-[9px]" style={{ color: "#e8e8f0" }}>
      <span>{label}</span><span data-testid={testid}>{Math.max(0, val)} / {max}</span>
    </div>
    <div className="h-2 rounded-sm overflow-hidden" style={{ background: "#10102a", border: "1px solid #000" }}>
      <div className="h-full transition-all duration-300" style={{ width: `${Math.max(0, (val / max) * 100)}%`, background: color }} />
    </div>
  </div>
);
const statusIcons = (f) => f.statuses.map((s) => ({ poison: "☠️", burn: "🔥", shield: "🛡️", ward: "🌵", regen: "🌿", root: "🪢", stun: "💫", reflect: "🪞", blind: "🌫️", charge: "⚠️", atk_up: "💪", def_down: "🩹" }[s.id] || "•")).join(" ");

/* Turn-based battle view (multi-enemy capable). Tapping an enemy dragon casts
   the currently selected spell through the same legal action path as Spell. */
export const BattleView = ({ battle, wizard, party, inventory, sceneTheme, onAction, onEnd, firstBattle, reducedMotion }) => {
  const canvasRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [selSpell, setSelSpell] = useState("fireball");
  const [floats, setFloats] = useState([]);
  const [msg, setMsg] = useState(battle.log[0]);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [, force] = useState(0);
  const b = battle;
  const foes = aliveFoes(b);
  const tgt = target(b);
  const transformed = b.phase >= 3;

  useEffect(() => {
    let raf; let t = 0;
    const cv = canvasRef.current; const ctx = cv.getContext("2d");
    const draw = () => {
      t += 1; const tick = reducedMotion ? 0 : t;
      const W = cv.width, H = cv.height;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, transformed ? "#2a0505" : (sceneTheme?.sky || "#0d2b4a"));
      g.addColorStop(0.6, sceneTheme?.ground || "#1d5a28"); g.addColorStop(1, sceneTheme?.ground2 || "#2f7a35");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (transformed && !reducedMotion && Math.floor(tick / 30) % 4 === 0) { ctx.fillStyle = "rgba(232,58,10,0.12)"; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(60 + i * 130, 60 + (i % 2) * 20, 26, 0, 7); ctx.fill(); }
      const bob = Math.sin(tick / 16) * 3;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(W * 0.2, H * 0.84, 70, 14, 0, 0, 7); ctx.fill();
      drawSprite(ctx, WIZARD_PX, WIZ_PAL, W * 0.12, H * 0.52 + bob * 0.5, 5.2);
      if (b.comp && b.comp.hp > 0) drawSprite(ctx, DRAGON_PX, ELEM_PAL[b.comp.element] || ELEM_PAL.fire, W * 0.26, H * 0.64 + bob, 3.2);
      const alive = aliveFoes(b);
      alive.forEach((f, i) => {
        const isKing = f.id === "dragon_king";
        const scale = (f.boss ? (isKing && transformed ? 8 : 6.4) : 5.4);
        const fx = W * (alive.length === 1 ? 0.58 : 0.4 + i * 0.21);
        const fy = H * (f.boss ? 0.18 : 0.24) + bob + (i % 2) * 8;
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath(); ctx.ellipse(fx + 55, fy + scale * 14, 70, 14, 0, 0, 7); ctx.fill();
        if (f === target(b)) { ctx.strokeStyle = "#f4d34d"; ctx.lineWidth = 3; ctx.strokeRect(fx - 8, fy - 8, scale * 15, scale * 15); }
        drawSprite(ctx, f.boss ? BOSS_PX : DRAGON_PX, ELEM_PAL[f.element] || ELEM_PAL.nature, fx, fy, scale, true);
        if (isKing && transformed) { ctx.fillStyle = "#ff2a1a"; for (let c = 0; c < 4; c++) ctx.fillRect(fx + 20 + c * 22, fy + 30 + (c % 2) * 18, 3, 14); }
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [b.foes.length, b.comp?.sid, b.phase, reducedMotion, transformed, foes.length]);

  const pushFloat = (who, text, cls) => {
    const id = Math.random();
    setFloats((f) => [...f, { id, who, text, cls }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1200);
  };

  const run = (action) => {
    if (busy || (b.over && b.over !== "finale")) return;
    if (b.over === "finale" && action.kind !== "finisher") return;
    setBusy(true); setMenu(null);
    const events = act(b, action);
    let d = 0;
    events.forEach((ev) => {
      setTimeout(() => {
        if (ev.t === "dmg") {
          pushFloat(ev.who, `-${ev.amount}${ev.crit ? " CRIT!" : ""}${ev.eff === "weak" ? " ▲" : ev.eff === "resist" ? " ▽" : ""}`, ev.crit ? "crit" : "dmg");
          sfx("hit"); if (ev.who === "wiz") { setShake(true); setTimeout(() => setShake(false), 300); }
        } else if (ev.t === "heal") { pushFloat(ev.who, `+${ev.amount}`, "heal"); sfx("heal"); }
        else if (ev.t === "msg") setMsg(ev.m);
        else if (ev.t === "phase") sfx("roar");
        force((x) => x + 1);
      }, d);
      d += ev.t === "msg" ? 430 : 260;
    });
    setTimeout(() => {
      setBusy(false); force((x) => x + 1);
      if (b.over && b.over !== "finale") { sfx(b.over === "loss" ? "lose" : "win"); setTimeout(() => onEnd(b.over), 900); }
      if (b.over === "finale") sfx("roar");
    }, d + 200);
  };

  const cmdBtn = "px-2.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide active:scale-95 transition-transform disabled:opacity-40";
  const locked = busy || (!!b.over && b.over !== "finale");

  return (
    <div className={`relative ${shake && !reducedMotion ? "animate-[drshake_0.3s]" : ""}`} data-testid="dr-battle">
      <style>{`@keyframes drshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
        @keyframes drfloat{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-34px)}}`}</style>
      <div className="relative">
        <canvas ref={canvasRef} width={780} height={400} className="w-full rounded-t-xl"
          style={{ imageRendering: "pixelated", border: "3px solid #10102a", borderBottom: "none" }} />
        <button className="absolute inset-y-0 right-0 w-1/2 cursor-pointer" style={{ background: "transparent" }}
          aria-label={`Tap ${tgt?.name} to cast ${SPELLS[selSpell]?.name}`} data-testid="dr-tap-enemy"
          onClick={() => run({ kind: "spell", spell: selSpell })} disabled={locked} />
        {firstBattle && !b.over && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-lg text-[11px] font-bold animate-pulse"
            style={{ background: "rgba(244,211,77,0.95)", color: "#3a2a00", border: "2px solid #10102a" }} data-testid="dr-tap-hint">
            👆 Tap the dragon to cast a spell!
          </div>
        )}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end" style={{ maxWidth: "52%" }}>
          {foes.map((f, i) => (
            <button key={f.sid} className="px-2 py-1 rounded-lg text-left w-44" data-testid={`dr-target-${i}`}
              style={{ background: "rgba(16,16,42,0.85)", border: f === tgt ? "2px solid #f4d34d" : "2px solid #000" }}
              onClick={() => { b.ti = i; sfx("click"); force((x) => x + 1); }}>
              <div className="text-[10px] font-bold flex items-center gap-1" style={{ color: "#fff" }} data-testid={i === 0 ? "dr-foe-name" : undefined}>
                {f === tgt && foes.length > 1 ? "🎯 " : ""}{f.name} <span style={{ color: "#f4d34d" }}>Lv{f.lv}</span> <span className="text-[9px]">{statusIcons(f)}</span>
              </div>
              <Bar val={f.hp} max={f.maxHp} color="#e84a4a" label="HP" testid={i === 0 ? "dr-foe-hp" : `dr-foe-hp-${i}`} />
              {f.boss && f.intent && <div className="text-[8.5px]" style={{ color: f.intent.includes("CATACLYSM") ? "#ff4a4a" : "#f4a73b" }} data-testid={i === 0 ? "dr-boss-intent" : undefined}>Next: {f.intent}</div>}
            </button>
          ))}
        </div>
        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-lg" style={{ background: "rgba(16,16,42,0.85)", border: "2px solid #000", minWidth: 150 }}>
          <div className="text-[10px] font-bold" style={{ color: "#fff" }}>{wizard.name} Lv{wizard.lv} <span className="text-[9px]">{statusIcons(b.wiz)}</span></div>
          <Bar val={b.wiz.hp} max={b.wiz.maxHp} color="#4ae86a" label="HP" testid="dr-wiz-hp" />
          <Bar val={b.wiz.mp} max={b.wiz.maxMp} color="#4a8ae8" label="MP" testid="dr-wiz-mp" />
        </div>
        <div className="absolute top-2 left-2 flex gap-1 flex-wrap" style={{ maxWidth: "42%" }} data-testid="dr-turn-order">
          {turnOrder(b).map((o, i) => (
            <span key={o.id} className="px-1.5 py-0.5 rounded text-[8.5px] font-bold"
              style={{ background: i === 0 ? "#f4d34d" : "rgba(16,16,42,0.8)", color: i === 0 ? "#3a2a00" : "#cfcfe8", border: "1px solid #000" }}>
              {o.name}</span>
          ))}
        </div>
        {b.phase > 0 && (
          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-[9px] font-black" data-testid="dr-phase"
            style={{ background: "#e84a4a", color: "#fff", border: "2px solid #10102a" }}>PHASE {Math.min(b.phase, 4)}</div>
        )}
        {floats.map((f) => (
          <div key={f.id} className="absolute font-bold pointer-events-none" style={{
            top: f.who.startsWith("foe") ? "22%" : "58%",
            left: f.who.startsWith("foe") ? `${52 + (parseInt(f.who.slice(3)) || 0) * 16}%` : "20%",
            color: f.cls === "heal" ? "#4ae86a" : f.cls === "crit" ? "#f4d34d" : "#ff6b6b",
            fontSize: f.cls === "crit" ? 20 : 15, textShadow: "2px 2px 0 #000", animation: "drfloat 1.2s forwards" }}>
            {f.text}</div>
        ))}
        {b.over === "finale" && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(10,2,2,0.82)" }} data-testid="dr-finale">
            <div className="text-center p-4 rounded-xl mx-4" style={{ background: "#e8e0c0", border: "3px solid #f4a73b" }}>
              <div className="text-2xl">⚔️👑</div>
              <h3 className="font-black text-sm mt-1" style={{ color: "#7a1f0e" }}>FINAL WARDEN STRIKE</h3>
              <p className="text-[11px] mt-1" style={{ color: "#2a2a1a" }}>The Dragon King staggers! Choose your finishing spell — your dragons strike with you!</p>
              <div className="flex gap-2 justify-center mt-2 flex-wrap">
                {spellsFor(wizard.lv).filter((s) => s.power > 0).slice(0, 4).map((sp) => (
                  <button key={sp.id} className="px-3 py-2 rounded-lg text-[11px] font-bold animate-pulse" data-testid={`dr-finisher-${sp.id}`}
                    style={{ background: "#f4a73b", color: "#10102a", border: "2px solid #10102a" }}
                    onClick={() => run({ kind: "finisher", spell: sp.id })}>{sp.icon} {sp.name}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="rounded-b-xl p-2" style={{ background: "#e8e0c0", border: "3px solid #10102a" }}>
        <div className="px-2 py-1.5 mb-2 rounded-lg text-[12px] font-semibold min-h-[34px]" role="status"
          style={{ background: "#f8f4dc", border: "2px solid #3a3a2a", color: "#2a2a1a" }} data-testid="dr-battle-msg">{msg}</div>
        {!menu && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            <button className={cmdBtn} style={{ background: "#e84a4a", color: "#fff", border: "2px solid #10102a" }} disabled={locked} onClick={() => run({ kind: "fight" })} data-testid="dr-cmd-fight">⚔️ Fight</button>
            <button className={cmdBtn} style={{ background: "#4a8ae8", color: "#fff", border: "2px solid #10102a" }} disabled={locked} onClick={() => { sfx("click"); setMenu("spell"); }} data-testid="dr-cmd-spell">✨ Spell</button>
            <button className={cmdBtn} style={{ background: "#3f9e4d", color: "#fff", border: "2px solid #10102a" }} disabled={locked} onClick={() => { sfx("click"); setMenu("dragon"); }} data-testid="dr-cmd-dragon">🐉 Dragon</button>
            <button className={cmdBtn} style={{ background: "#a86de8", color: "#fff", border: "2px solid #10102a" }} disabled={locked} onClick={() => { sfx("click"); setMenu("item"); }} data-testid="dr-cmd-item">🎒 Item</button>
            <button className={cmdBtn} style={{ background: "#8a8a9a", color: "#fff", border: "2px solid #10102a" }} disabled={locked} onClick={() => run({ kind: "defend" })} data-testid="dr-cmd-defend">🛡️ Defend</button>
            <button className={cmdBtn} style={{ background: "#c9a05e", color: "#2a1a00", border: "2px solid #10102a" }} disabled={locked} onClick={() => run({ kind: "run" })} data-testid="dr-cmd-run">👟 Run</button>
            {tgt && !tgt.boss && tgt.hp <= tgt.maxHp * 0.35 && (
              <button className={`${cmdBtn} col-span-3 sm:col-span-6 animate-pulse`} style={{ background: "#f4d34d", color: "#3a2a00", border: "2px solid #10102a" }}
                disabled={locked} onClick={() => run({ kind: "befriend" })} data-testid="dr-cmd-befriend">💖 Befriend {tgt.name}!</button>
            )}
          </div>
        )}
        {menu === "spell" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {spellsFor(wizard.lv).map((sp) => (
              <button key={sp.id} className={cmdBtn} data-testid={`dr-spell-${sp.id}`}
                style={{ background: selSpell === sp.id ? "#f4d34d" : "#fff", color: "#2a2a1a", border: "2px solid #10102a", textAlign: "left" }}
                disabled={busy || b.wiz.mp < sp.mp || (b.wiz.cds[sp.id] || 0) > 0}
                onClick={() => { setSelSpell(sp.id); run({ kind: "spell", spell: sp.id }); }}
                title={sp.desc}>
                {sp.icon} {sp.name}<br /><span className="text-[8.5px] font-normal">{sp.mp} MP{(b.wiz.cds[sp.id] || 0) > 0 ? ` · CD ${b.wiz.cds[sp.id]}` : ""}</span>
              </button>
            ))}
            <button className={cmdBtn} style={{ background: "#8a8a9a", color: "#fff", border: "2px solid #10102a" }} onClick={() => setMenu(null)} data-testid="dr-menu-back">← Back</button>
          </div>
        )}
        {menu === "item" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {Object.entries(inventory).filter(([, n]) => n > 0).map(([id, n]) => (
              <button key={id} className={cmdBtn} style={{ background: "#fff", color: "#2a2a1a", border: "2px solid #10102a", textAlign: "left" }}
                disabled={busy} onClick={() => { onAction("use_item", id); run({ kind: "item", item: id }); }} data-testid={`dr-item-${id}`}>
                {ITEMS[id]?.icon} {ITEMS[id]?.name} ×{n}<br /><span className="text-[8.5px] font-normal">{ITEMS[id]?.desc}</span>
              </button>
            ))}
            {Object.values(inventory).every((n) => !n) && <div className="text-[11px] p-2" style={{ color: "#6a6a5a" }}>Your bag is empty.</div>}
            <button className={cmdBtn} style={{ background: "#8a8a9a", color: "#fff", border: "2px solid #10102a" }} onClick={() => setMenu(null)}>← Back</button>
          </div>
        )}
        {menu === "dragon" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {party.length === 0 && <div className="text-[11px] p-2" style={{ color: "#6a6a5a" }}>No dragons yet — befriend one in the wild!</div>}
            {party.map((d) => (
              <button key={d.id} className={cmdBtn} style={{ background: b.comp?.id === d.id ? "#f4d34d" : "#fff", color: "#2a2a1a", border: "2px solid #10102a", textAlign: "left" }}
                disabled={busy} onClick={() => run({ kind: "swap", dragon: d })} data-testid={`dr-party-${d.id}`}>
                🐉 {d.name} Lv{d.level}<br /><span className="text-[8.5px] font-normal">{d.element}</span>
              </button>
            ))}
            <button className={cmdBtn} style={{ background: "#8a8a9a", color: "#fff", border: "2px solid #10102a" }} onClick={() => setMenu(null)}>← Back</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BattleView;
