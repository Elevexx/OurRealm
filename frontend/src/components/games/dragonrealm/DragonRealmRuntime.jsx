import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";
import { newWizard, grantXp, newBattle, findTile, sfx, ITEMS } from "./engine";
import { drawSprite, DRAGON_PX, WIZARD_PX, WIZ_PAL, ELEM_PAL } from "./sprites";
import ExploreView from "./ExploreView";
import BattleView from "./BattleView";

const freshSave = () => ({
  pos: findTile("S"), wizard: newWizard(), party: [], inventory: { small_potion: 2, magic_potion: 1 },
  resolved: [], chestOpen: false, npcTalked: false, battles: 0, activeDragon: null,
  settings: { sound: true, reducedMotion: false },
});

const Pixel = ({ children, className = "", style = {} }) => (
  <div className={`rounded-xl ${className}`} style={{ background: "#e8e0c0", border: "3px solid #10102a", ...style }}>{children}</div>
);

export default function DragonRealmRuntime() {
  const [state, setState] = useState(null);      // server /state payload
  const [denied, setDenied] = useState(null);
  const [screen, setScreen] = useState("title"); // title | explore | battle
  const [save, setSave] = useState(freshSave());
  const [battle, setBattle] = useState(null);
  const [overlay, setOverlay] = useState(null);  // party | quest | options | extras | credits | dialog | celebrate
  const [dialog, setDialog] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [fire, setFire] = useState({ vault: 0 });
  const [claiming, setClaiming] = useState(null);
  const [flame, setFlame] = useState(false);
  const saveTimer = useRef(null);
  const firstBattleRef = useRef(true);

  useEffect(() => {
    apiClient.get("/dragon-realm/state")
      .then((r) => { setState(r.data); setFire(r.data.fire); if (r.data.save) setSave((s) => ({ ...freshSave(), ...r.data.save })); })
      .catch((e) => setDenied(e?.response?.data?.detail || "Dragon Realm is unavailable"));
  }, []);

  const trusted = state?.trusted || { discovered: [], befriended: [], rewards: {}, boss_defeated: false, quest_complete: false };
  const content = state?.content || { dragons: {}, boss: {}, quest: { objectives: [] } };

  const doSave = useCallback((next, immediate) => {
    setSave(next);
    clearTimeout(saveTimer.current);
    const push = async (retry) => {
      setSaveStatus("Saving…");
      try { await apiClient.post("/dragon-realm/save", { save: next }); setSaveStatus("Saved"); setTimeout(() => setSaveStatus(""), 1500); }
      catch { if (!retry) { setSaveStatus("Save failed — retrying"); setTimeout(() => push(true), 2000); } else setSaveStatus("Save failed"); }
    };
    saveTimer.current = setTimeout(() => push(false), immediate ? 50 : 900);
  }, []);

  const postEvent = async (type, enemyId) => {
    try {
      const r = await apiClient.post("/dragon-realm/event", { type, enemy_id: enemyId });
      const before = trusted.quest_complete;
      setState((s) => ({ ...s, trusted: r.data.trusted }));
      if (!before && r.data.trusted.quest_complete) { sfx("win"); setOverlay("celebrate"); }
      return r.data.trusted;
    } catch (e) { toast.error(e?.response?.data?.detail || "Progress sync failed"); return null; }
  };

  const startEncounter = (dragonId, isBoss) => {
    const def = isBoss ? content.boss : content.dragons[dragonId];
    if (!def) return;
    const comp = save.party.find((d) => d.id === save.activeDragon) || null;
    sfx(isBoss ? "roar" : "spell");
    setBattle(newBattle(save.wizard, def, comp, (save.battles + 1) * 7919 + (isBoss ? 13 : 0), isBoss));
    setScreen("battle");
  };

  const endBattle = async (outcome) => {
    const b = battle; const foeId = b.foe.id; const isBoss = b.foe.boss;
    const next = { ...save, battles: save.battles + 1 };
    next.wizard = { ...save.wizard, hp: Math.max(1, b.wiz.hp), mp: b.wiz.mp };
    if (outcome === "win") {
      const ups = grantXp(next.wizard, (b.foe.lv || 10) * (isBoss ? 5 : 3));
      if (ups.length) toast.success(`⬆️ Level up! You are now Lv${next.wizard.lv}`);
      if (isBoss) {
        next.wizard.badges = [...new Set([...(next.wizard.badges || []), "Forest Badge"])];
        await postEvent("boss_win");
      } else {
        next.resolved = [...new Set([...save.resolved, foeId])];
        await postEvent("battle_win", foeId);
      }
    } else if (outcome === "befriend") {
      next.party = save.party.length < 4 ? [...save.party, content.dragons[foeId]] : save.party;
      if (save.party.length >= 4) toast.info(`${content.dragons[foeId].name} joins your reserve.`);
      next.activeDragon = next.activeDragon || foeId;
      next.resolved = [...new Set([...save.resolved, foeId])];
      await postEvent("battle_befriend", foeId);
    } else if (outcome === "loss") {
      await postEvent("battle_loss", foeId).catch?.(() => {});
      next.wizard.hp = Math.ceil(next.wizard.maxHp * 0.5);
      next.pos = findTile("S");
      toast.error("You wake up at the forest gate…");
    }
    doSave(next, true);
    setBattle(null); setScreen("explore");
    firstBattleRef.current = false;
  };

  const claim = async (rewardId) => {
    if (claiming) return;
    setClaiming(rewardId);
    try {
      const r = await apiClient.post("/dragon-realm/claim", { reward_id: rewardId });
      sfx("claim"); setFlame(true); setTimeout(() => setFlame(false), 1600);
      setFire(r.data.fire);
      setState((s) => ({ ...s, trusted: { ...s.trusted, rewards: { ...s.trusted.rewards, [rewardId]: { ...s.trusted.rewards[rewardId], status: "claimed" } } } }));
      toast.success(`🔥 +${r.data.amount} Fire Power — added to your Fire Power Vault`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Claim failed"); }
    finally { setClaiming(null); }
  };
  const claimAll = async () => {
    if (claiming) return;
    setClaiming("all");
    try {
      const r = await apiClient.post("/dragon-realm/claim-all");
      sfx("claim"); setFlame(true); setTimeout(() => setFlame(false), 1600);
      setFire(r.data.fire);
      const st = await apiClient.get("/dragon-realm/state"); setState(st.data);
      toast.success(`🔥 Claimed ${r.data.claimed.length} reward(s) — added to your Fire Power Vault`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Claim failed"); }
    finally { setClaiming(null); }
  };

  if (denied) return (
    <Pixel className="p-6 text-center" data-testid="dr-denied">
      <div className="text-3xl mb-2">🐉🔒</div>
      <b style={{ color: "#2a2a1a" }}>Founder Only</b>
      <div className="text-[12px] mt-1" style={{ color: "#5a5a4a" }}>{denied}</div>
    </Pixel>
  );
  if (!state) return <Pixel className="p-8 text-center text-sm" style={{ color: "#2a2a1a" }}>Summoning the realm…</Pixel>;

  const unclaimed = Object.entries(trusted.rewards || {}).filter(([, r]) => r.status === "unclaimed");
  const objProgress = [
    { label: content.quest.objectives[0]?.label, cur: trusted.discovered.length, target: 3 },
    { label: content.quest.objectives[1]?.label, cur: trusted.befriended.length, target: 1 },
    { label: content.quest.objectives[2]?.label, cur: trusted.boss_defeated ? 1 : 0, target: 1 },
  ];
  const bossUnlocked = trusted.discovered.length >= 3 && trusted.befriended.length >= 1;

  const fpChip = (
    <span className={`px-2 py-1 rounded-lg text-[11px] font-bold relative ${flame ? "animate-pulse" : ""}`}
      style={{ background: "#10102a", color: "#f4a73b", border: "2px solid #f4a73b" }} data-testid="dr-fire-balance">
      🔥 {fire.vault.toLocaleString()} Fire Power
      {flame && <span className="absolute -top-3 left-1/2 text-base animate-bounce">🔥</span>}
    </span>
  );

  /* ── Title screen ──────────────────────────────────────────────────── */
  if (screen === "title") return (
    <Pixel className="overflow-hidden" data-testid="dr-title">
      <div className="relative p-6 text-center" style={{ background: "linear-gradient(180deg,#0d2b4a 0%,#1d5a28 70%,#2f7a35 100%)" }}>
        <div className="text-[10px] tracking-[4px] font-bold" style={{ color: "#c9ecff" }}>OURREALM PRESENTS</div>
        <h1 className="text-3xl sm:text-5xl font-black mt-1" style={{ color: "#f4a73b", textShadow: "3px 3px 0 #7a1f0e, 6px 6px 0 #10102a", fontFamily: "var(--font-display)" }}>
          DRAGON REALM</h1>
        <div className="text-lg sm:text-2xl font-black tracking-widest" style={{ color: "#f4d34d", textShadow: "2px 2px 0 #10102a" }}>THE FIRE QUEST</div>
        <TitleScene />
        <div className="mt-3 flex justify-center">{fpChip}</div>
        <div className="mt-4 flex flex-col items-center gap-2">
          {[["New Game", () => { const f = freshSave(); doSave(f, true); setScreen("explore"); sfx("click"); }, "dr-new-game"],
            ["Continue", () => { setScreen("explore"); sfx("click"); }, "dr-continue", !state.save],
            ["Options", () => setOverlay("options"), "dr-options"],
            ["Extras", () => setOverlay("extras"), "dr-extras"],
            ["Credits", () => setOverlay("credits"), "dr-credits"]].map(([label, fn, tid, disabled]) => (
            <button key={tid} className="w-52 py-2 rounded-lg font-bold text-sm uppercase tracking-widest transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
              style={{ background: "#e8e0c0", color: "#2a2a1a", border: "3px solid #10102a", boxShadow: "0 3px 0 #10102a" }}
              onClick={fn} disabled={disabled} data-testid={tid}>▶ {label}</button>
          ))}
        </div>
        <div className="mt-4 text-[9px]" style={{ color: "#9ec9d8" }}>
          Fire Power is an OurRealm platform feature. It has no monetary value and cannot be exchanged for money or goods.
        </div>
      </div>
      {overlay && <Overlay overlay={overlay} setOverlay={setOverlay} save={save} doSave={doSave} state={state} trusted={trusted} content={content} unclaimed={unclaimed} claim={claim} claimAll={claimAll} claiming={claiming} objProgress={objProgress} fire={fire} />}
    </Pixel>
  );

  /* ── Explore / battle shell ────────────────────────────────────────── */
  return (
    <div data-testid="dr-game">
      <Pixel className="p-2 mb-2 flex items-center gap-2 flex-wrap" style={{ background: "#10102a", border: "3px solid #f4a73b" }}>
        <b className="text-[12px]" style={{ color: "#8fd45f" }} data-testid="dr-region-name">🌲 Enchanted Forest</b>
        <span className="text-[10px] hidden sm:inline" style={{ color: "#cfcfe8" }} data-testid="dr-objective">
          Objective: {!bossUnlocked ? `Discover dragons (${trusted.discovered.length}/3) · befriend one (${trusted.befriended.length}/1)` : trusted.boss_defeated ? "Region complete!" : "⚔️ Challenge THORNBEAST at the boss gate!"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {saveStatus && <span className="text-[9px]" style={{ color: "#9ec9d8" }} data-testid="dr-save-status">{saveStatus}</span>}
          {fpChip}
          <span className="text-[10px] font-bold" style={{ color: "#4ae86a" }}>❤️ {save.wizard.hp}/{save.wizard.maxHp}</span>
          <span className="text-[10px] font-bold" style={{ color: "#4a8ae8" }}>✦ {save.wizard.mp}/{save.wizard.maxMp}</span>
          <button className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: "#3f9e4d", color: "#fff", border: "2px solid #000" }}
            onClick={() => setOverlay("party")} data-testid="dr-open-party">🐉 Party</button>
          <button className={`px-2 py-1 rounded-lg text-[10px] font-bold ${unclaimed.length ? "animate-pulse" : ""}`}
            style={{ background: unclaimed.length ? "#f4a73b" : "#4a5a8a", color: "#fff", border: "2px solid #000" }}
            onClick={() => setOverlay("quest")} data-testid="dr-open-quest">📜 Quest{unclaimed.length ? ` (${unclaimed.length}!)` : ""}</button>
          <button className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: "#4a4a5a", color: "#fff", border: "2px solid #000" }}
            onClick={() => setOverlay("options")} data-testid="dr-pause" aria-label="Pause and settings">⏸</button>
        </span>
      </Pixel>

      {screen === "explore" && (
        <ExploreView pos={save.pos} setPos={(p) => doSave({ ...save, pos: p })}
          dragons={content.dragons} resolved={save.resolved} chestOpen={save.chestOpen}
          reducedMotion={save.settings?.reducedMotion}
          onEncounter={(id) => startEncounter(id, false)}
          onNpc={() => { setDialog({ who: "Forest Elder", text: save.npcTalked ? (bossUnlocked ? "The gate is open, Warden. THORNBEAST awaits to the east!" : "Discover three dragons and befriend one — then the boss gate will open.") : "Welcome, young Warden! Our forest is troubled. Discover 3 wild dragons, befriend one, and defeat THORNBEAST at the eastern gate!" }); if (!save.npcTalked) doSave({ ...save, npcTalked: true }); }}
          onChest={() => { sfx("claim"); const inv = { ...save.inventory, large_potion: (save.inventory.large_potion || 0) + 1, antidote: (save.inventory.antidote || 0) + 1 }; doSave({ ...save, inventory: inv, chestOpen: true }, true); setDialog({ who: "Treasure!", text: "You found a Large Health Potion and an Antidote!" }); }}
          onBossGate={() => { if (!bossUnlocked) { sfx("lose"); setDialog({ who: "Boss Gate", text: "🔒 Sealed by ancient thorns. Complete the Elder's objectives first!" }); } else if (trusted.boss_defeated) { setDialog({ who: "Boss Gate", text: "THORNBEAST has been defeated. The path to Crystal Caverns opens soon…" }); } else startEncounter(null, true); }} />
      )}
      {screen === "battle" && battle && (
        <BattleView battle={battle} wizard={save.wizard} party={save.party} inventory={save.inventory}
          reducedMotion={save.settings?.reducedMotion} firstBattle={firstBattleRef.current}
          onAction={(kind, id) => { if (kind === "use_item") doSave({ ...save, inventory: { ...save.inventory, [id]: Math.max(0, (save.inventory[id] || 0) - 1) } }); }}
          onEnd={endBattle} />
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setDialog(null)}>
          <Pixel className="p-4 max-w-md w-full" data-testid="dr-dialog">
            <b className="text-[12px]" style={{ color: "#7a1f0e" }}>{dialog.who}</b>
            <p className="text-[13px] mt-1" style={{ color: "#2a2a1a" }}>{dialog.text}</p>
            <button className="mt-2 px-4 py-1.5 rounded-lg text-[11px] font-bold" style={{ background: "#3f9e4d", color: "#fff", border: "2px solid #10102a" }}
              onClick={() => setDialog(null)} data-testid="dr-dialog-close">Continue ▶</button>
          </Pixel>
        </div>
      )}
      {overlay && <Overlay overlay={overlay} setOverlay={setOverlay} save={save} doSave={doSave} state={state} trusted={trusted} content={content} unclaimed={unclaimed} claim={claim} claimAll={claimAll} claiming={claiming} objProgress={objProgress} fire={fire} />}
    </div>
  );
}

/* Animated title scene: wizard + fire-breathing dragon over forest & castle. */
const TitleScene = () => {
  const ref = useRef(null);
  useEffect(() => {
    let raf, t = 0;
    const cv = ref.current, ctx = cv.getContext("2d");
    const draw = () => {
      t += 1;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = "#10203a";
      [[300, 20], [340, 12], [380, 26]].forEach(([x, h]) => ctx.fillRect(x, 60 - h, 14, h + 30)); // castle
      ctx.fillStyle = "#0d3a1a";
      for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.arc(20 + i * 45, 92, 18, 0, 7); ctx.fill(); }
      drawSprite(ctx, WIZARD_PX, WIZ_PAL, 60, 40 + Math.sin(t / 20) * 2, 4);
      drawSprite(ctx, DRAGON_PX, ELEM_PAL.fire, 250, 24 + Math.sin(t / 16) * 3, 5, true);
      for (let i = 0; i < 5; i++) { // fire breath toward wizard
        const fx = 240 - ((t * 3 + i * 18) % 90);
        ctx.fillStyle = i % 2 ? "#f4a73b" : "#e84a2a";
        ctx.fillRect(fx, 58 + Math.sin(t / 5 + i) * 4, 8, 6);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={430} height={110} className="mx-auto mt-3 w-full max-w-md" style={{ imageRendering: "pixelated" }} />;
};

/* Shared overlays: party, quest+claims, options, extras, credits, celebrate. */
const Overlay = ({ overlay, setOverlay, save, doSave, trusted, content, unclaimed, claim, claimAll, claiming, objProgress, fire }) => {
  const close = () => setOverlay(null);
  const body = (children, tid) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 overflow-y-auto" style={{ background: "rgba(0,0,0,0.6)" }} onClick={close}>
      <div className="rounded-xl p-4 max-w-lg w-full max-h-[85vh] overflow-y-auto" style={{ background: "#e8e0c0", border: "3px solid #10102a" }}
        onClick={(e) => e.stopPropagation()} data-testid={tid}>{children}
        <button className="mt-3 px-4 py-1.5 rounded-lg text-[11px] font-bold" style={{ background: "#4a4a5a", color: "#fff", border: "2px solid #10102a" }}
          onClick={close} data-testid="dr-overlay-close">✕ Close</button>
      </div>
    </div>
  );

  if (overlay === "celebrate") return body(
    <div className="text-center py-4">
      <div className="text-4xl animate-bounce">🏆</div>
      <h2 className="text-xl font-black mt-2" style={{ color: "#7a1f0e" }}>QUEST COMPLETE!</h2>
      <p className="text-[13px] mt-1" style={{ color: "#2a2a1a" }}>“The First Flame” — the Enchanted Forest is safe!</p>
      <p className="text-[12px] mt-1 font-bold" style={{ color: "#c07a1a" }}>🔥 FIRE POWER READY TO CLAIM!</p>
      <button className="mt-3 px-5 py-2 rounded-lg font-bold text-sm" style={{ background: "#f4a73b", color: "#10102a", border: "3px solid #10102a" }}
        onClick={() => setOverlay("quest")} data-testid="dr-celebrate-to-quest">View Rewards ▶</button>
    </div>, "dr-celebrate");

  if (overlay === "party") return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>🧙 {save.wizard.name} — Lv{save.wizard.lv}</h3>
      <div className="text-[11px] mt-1 grid grid-cols-2 gap-x-3" style={{ color: "#4a4a3a" }} data-testid="dr-party-wizard">
        <span>❤️ HP {save.wizard.hp}/{save.wizard.maxHp}</span><span>✦ MP {save.wizard.mp}/{save.wizard.maxMp}</span>
        <span>⚔️ ATK {save.wizard.atk} · ✨ MAG {save.wizard.mag}</span><span>🛡️ DEF {save.wizard.def} · 💨 SPD {save.wizard.spd}</span>
        <span>🪄 {save.wizard.equip.staff}</span><span>🧥 {save.wizard.equip.robe}</span>
        <span>🎩 {save.wizard.equip.hat}</span><span>🔥 {fire.vault.toLocaleString()} Fire Power</span>
      </div>
      {(save.wizard.badges || []).length > 0 && (
        <div className="text-[11px] mt-1" style={{ color: "#c07a1a" }}>🏅 {save.wizard.badges.join(" · ")}</div>)}
      <h4 className="font-black text-[12px] mt-3" style={{ color: "#2a2a1a" }}>Active Party ({save.party.length}/4)</h4>
      {save.party.length === 0 && <div className="text-[11px]" style={{ color: "#6a6a5a" }}>No dragons yet — weaken a wild dragon below 35% HP, then Befriend it!</div>}
      <div className="grid grid-cols-2 gap-1.5 mt-1">
        {save.party.map((d) => (
          <button key={d.id} className="rounded-lg p-2 text-left" data-testid={`dr-partycard-${d.id}`}
            style={{ background: save.activeDragon === d.id ? "#f4d34d" : "#fff", border: "2px solid #10102a" }}
            onClick={() => doSave({ ...save, activeDragon: d.id })}>
            <b className="text-[11px]" style={{ color: "#2a2a1a" }}>🐉 {d.name} Lv{d.level}</b>
            <div className="text-[9px]" style={{ color: "#5a5a4a" }}>{d.element} · {d.rarity}{save.activeDragon === d.id ? " · ACTIVE" : ""}</div>
          </button>
        ))}
      </div>
      <div className="text-[10px] mt-2" style={{ color: "#6a6a5a" }}>🎒 {Object.entries(save.inventory).filter(([, n]) => n > 0).map(([k, n]) => `${ITEMS[k]?.icon || ""} ${ITEMS[k]?.name} ×${n}`).join(" · ") || "Bag empty"}</div>
    </>, "dr-party-view");

  if (overlay === "quest") return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>📜 {content.quest.title}</h3>
      <p className="text-[11px]" style={{ color: "#5a5a4a" }}>{content.quest.description}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {objProgress.map((o, i) => (
          <div key={i} className="rounded-lg px-2 py-1.5 flex items-center gap-2 text-[11px]" data-testid={`dr-objective-${i}`}
            style={{ background: o.cur >= o.target ? "#d4f0c0" : "#fff", border: "2px solid #10102a", color: "#2a2a1a" }}>
            <span>{o.cur >= o.target ? "✅" : "▫️"}</span><span className="flex-1">{o.label}</span>
            <b>{Math.min(o.cur, o.target)}/{o.target}</b>
          </div>
        ))}
      </div>
      <h4 className="font-black text-[12px] mt-3 flex items-center justify-between" style={{ color: "#2a2a1a" }}>
        🔥 Fire Power Rewards
        {unclaimed.length > 1 && (
          <button className="px-3 py-1 rounded-lg text-[10px] font-bold" style={{ background: "#e84a2a", color: "#fff", border: "2px solid #10102a" }}
            disabled={!!claiming} onClick={claimAll} data-testid="dr-claim-all">CLAIM ALL ({unclaimed.reduce((a, [, r]) => a + r.amount, 0)} 🔥)</button>
        )}
      </h4>
      <div className="mt-1 flex flex-col gap-1.5" data-testid="dr-rewards-list">
        {Object.entries(trusted.rewards || {}).length === 0 && <div className="text-[11px]" style={{ color: "#6a6a5a" }}>Defeat and befriend dragons to earn Fire Power rewards!</div>}
        {Object.entries(trusted.rewards || {}).map(([rid, r]) => (
          <div key={rid} className="rounded-lg px-2 py-1.5 flex items-center gap-2 text-[11px]" data-testid={`dr-reward-${rid}`}
            style={{ background: r.status === "claimed" ? "#d8d8c8" : "#fff8dc", border: "2px solid #10102a", color: "#2a2a1a" }}>
            <span className="flex-1">{rid.startsWith("dragon_first_") ? `🐉 First victory: ${rid.replace("dragon_first_", "")}` : rid === "boss_thornbeast" ? "⚔️ BOSS DEFEATED: THORNBEAST" : "📜 Quest: The First Flame"}</span>
            <b style={{ color: "#c07a1a" }}>+{r.amount} 🔥</b>
            {r.status === "unclaimed" ? (
              <button className="px-3 py-1 rounded-lg text-[10px] font-black animate-pulse" style={{ background: "#8fd45f", color: "#10102a", border: "2px solid #10102a" }}
                disabled={!!claiming} onClick={() => claim(rid)} data-testid={`dr-claim-${rid}`}>{claiming === rid ? "…" : "CLAIM NOW"}</button>
            ) : <span className="text-[9px] font-bold" style={{ color: "#3f9e4d" }} data-testid={`dr-claimed-${rid}`}>✓ CLAIMED</span>}
          </div>
        ))}
      </div>
      <div className="text-[9px] mt-2" style={{ color: "#8a8a7a" }}>
        Fire Power is an OurRealm platform feature. It has no monetary value and cannot be exchanged for money or goods.
      </div>
    </>, "dr-quest-view");

  if (overlay === "options") return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>⚙️ Options</h3>
      {[["Sound effects", "sound"], ["Reduced motion", "reducedMotion"]].map(([label, key]) => (
        <label key={key} className="flex items-center justify-between text-[12px] mt-2" style={{ color: "#2a2a1a" }}>
          {label}
          <input type="checkbox" checked={!!save.settings?.[key]} data-testid={`dr-opt-${key}`}
            onChange={(e) => doSave({ ...save, settings: { ...save.settings, [key]: e.target.checked } })} />
        </label>
      ))}
      <div className="text-[10px] mt-3" style={{ color: "#6a6a5a" }}>Controls: Arrow keys / WASD, tap a direction on the map, or use the on-screen D-pad on mobile. In battle, tap the dragon to cast your selected spell.</div>
    </>, "dr-options-view");

  if (overlay === "extras") return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>✨ Extras</h3>
      <div className="text-[11px] mt-1" style={{ color: "#4a4a3a" }}>
        <b>Dragon Log:</b> {trusted.discovered.length}/6 discovered · {trusted.befriended.length} befriended<br />
        <b>Coming later:</b> Challenge Mode, Boss Rush <i>(after story)</i>, Dragon Arena (Beta), Co-op Realms & PvP Duels (Coming Later).
      </div>
    </>, "dr-extras-view");

  return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>📖 Credits</h3>
      <div className="text-[11px] mt-1" style={{ color: "#4a4a3a" }}>
        Dragon Realm: The Fire Quest — an original OurRealm game.<br />
        Runtime family: turn_based_creature_rpg · renderer_pixel_creature_rpg_v1.<br />
        All pixel art, names and sounds are original OurRealm creations.
      </div>
    </>, "dr-credits-view");
};
