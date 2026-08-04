import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";
import { newWizard, grantXp, newBattle, findTile, sfx, startMusic, stopMusic, ITEMS, REGION_THEMES, REGION_ORDER as RO_FALLBACK } from "./engine";
import { drawSprite, DRAGON_PX, WIZARD_PX, WIZ_PAL, ELEM_PAL } from "./sprites";
import ExploreView from "./ExploreView";
import BattleView from "./BattleView";

const freshSave = () => ({
  region: "enchanted_forest", pos: null, wizard: newWizard(), party: [], reserve: [],
  inventory: { small_potion: 2, magic_potion: 1 }, resolvedByRegion: {}, chests: {}, npcTalked: {},
  battles: 0, activeDragon: null, settings: { sound: true, music: true, reducedMotion: false },
});

const Pixel = ({ children, className = "", style = {}, testid }) => (
  <div className={`rounded-xl ${className}`} data-testid={testid} style={{ background: "#e8e0c0", border: "3px solid #10102a", ...style }}>{children}</div>
);

export default function DragonRealmRuntime() {
  const [state, setState] = useState(null);
  const [denied, setDenied] = useState(null);
  const [screen, setScreen] = useState("title"); // title | world | explore | battle
  const [save, setSave] = useState(freshSave());
  const [battle, setBattle] = useState(null);
  const [overlay, setOverlay] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [fire, setFire] = useState({ vault: 0 });
  const [claiming, setClaiming] = useState(null);
  const [flame, setFlame] = useState(false);
  const saveTimer = useRef(null);
  const firstBattleRef = useRef(true);

  useEffect(() => {
    apiClient.get("/dragon-realm/state")
      .then((r) => { setState(r.data); setFire(r.data.fire); if (r.data.save) setSave({ ...freshSave(), ...r.data.save }); })
      .catch((e) => setDenied(e?.response?.data?.detail || "Dragon Realm is unavailable"));
    return () => stopMusic();
  }, []);

  const trusted = state?.trusted || { discovered: [], befriended: [], bosses: {}, quests: {}, rewards: {} };
  const content = state?.content || { regions: {}, bosses: {}, quests: {}, region_order: RO_FALLBACK };
  const RO = content.region_order || RO_FALLBACK;
  const rid = save.region || "enchanted_forest";
  const region = content.regions[rid];
  const theme = REGION_THEMES[rid] || REGION_THEMES.enchanted_forest;
  const regionDragons = Object.fromEntries((region?.dragons || []).map((d) => [d.id, d]));
  const spawnMap = Object.fromEntries((region?.dragons || []).map((d, i) => [String(i + 1), d.id]));
  const boss = content.bosses[region?.boss_id];
  const unlocked = (r) => RO.indexOf(r) === 0 || !!trusted.bosses?.[RO[RO.indexOf(r) - 1]];
  const regProg = (r) => {
    const ids = (content.regions[r]?.dragons || []).map((d) => d.id);
    const disc = (trusted.discovered || []).filter((x) => ids.includes(x)).length;
    return { disc, boss: !!trusted.bosses?.[r], pct: Math.round(((disc / Math.max(1, ids.length)) * 0.6 + (trusted.bosses?.[r] ? 0.4 : 0)) * 100) };
  };
  const bossUnlocked = regProg(rid).disc >= 3 && (rid !== "enchanted_forest" || (trusted.befriended || []).length >= 1);

  useEffect(() => {
    if (screen === "explore" && save.settings?.music !== false) startMusic(rid);
    else stopMusic();
    return () => stopMusic();
  }, [screen, rid, save.settings?.music]);

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

  const postEvent = async (type, extra) => {
    try {
      const r = await apiClient.post("/dragon-realm/event", { type, ...extra });
      const before = Object.values(trusted.quests || {}).filter(Boolean).length;
      setState((s) => ({ ...s, trusted: r.data.trusted }));
      if (Object.values(r.data.trusted.quests || {}).filter(Boolean).length > before) { sfx("win"); setOverlay("celebrate"); }
      return r.data.trusted;
    } catch (e) { toast.error(e?.response?.data?.detail || "Progress sync failed"); return null; }
  };

  const startEncounter = (dragonId, isBoss) => {
    const def = isBoss ? boss : regionDragons[dragonId];
    if (!def) return;
    const comp = save.party.find((d) => d.id === save.activeDragon) || null;
    sfx(isBoss ? "roar" : "spell");
    stopMusic();
    setBattle(newBattle(save.wizard, def, comp, (save.battles + 1) * 7919 + (isBoss ? 13 : 0), isBoss));
    setScreen("battle");
  };

  const endBattle = async (outcome) => {
    const b = battle; const isBoss = b.foes.some((f) => f.boss);
    const foeId = isBoss ? region.boss_id : b.foes[0].id;
    const next = { ...save, battles: save.battles + 1 };
    next.wizard = { ...save.wizard, hp: Math.max(1, b.wiz.hp), mp: b.wiz.mp };
    const resolved = { ...save.resolvedByRegion };
    if (outcome === "win") {
      const lv = b.foes[0].lv || 10;
      const ups = grantXp(next.wizard, lv * (isBoss ? 5 : 3));
      if (ups.length) toast.success(`⬆️ Level up! You are now Lv${next.wizard.lv}`);
      if (isBoss) {
        const badge = { enchanted_forest: "Forest Badge", crystal_caverns: "Crystal Badge", sandsear_desert: "Sun Badge", frozen_peaks: "Frost Badge", storm_isles: "Storm Badge", dragonfall_castle: "Dragon Warden" }[rid];
        next.wizard.badges = [...new Set([...(next.wizard.badges || []), badge])];
        await postEvent("boss_win", { region: rid });
        if (rid === "dragonfall_castle") setTimeout(() => setOverlay("warden"), 1200);
      } else {
        resolved[rid] = [...new Set([...(resolved[rid] || []), foeId])];
        await postEvent("battle_win", { enemy_id: foeId });
      }
    } else if (outcome === "befriend") {
      const d = regionDragons[foeId];
      if (save.party.length < 4) next.party = [...save.party, d];
      else { next.reserve = [...(save.reserve || []), d]; toast.info(`${d.name} joins your reserve.`); }
      next.activeDragon = next.activeDragon || foeId;
      resolved[rid] = [...new Set([...(resolved[rid] || []), foeId])];
      await postEvent("battle_befriend", { enemy_id: foeId });
    } else if (outcome === "loss") {
      next.wizard.hp = Math.ceil(next.wizard.maxHp * 0.5);
      next.pos = null;
      toast.error("You wake up at the region gate…");
    }
    next.resolvedByRegion = resolved;
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
    <Pixel className="p-6 text-center" testid="dr-denied">
      <div className="text-3xl mb-2">🐉🔒</div>
      <b style={{ color: "#2a2a1a" }}>Founder Only</b>
      <div className="text-[12px] mt-1" style={{ color: "#5a5a4a" }}>{denied}</div>
    </Pixel>
  );
  if (!state) return <Pixel className="p-8 text-center text-sm" style={{ color: "#2a2a1a" }}>Summoning the realm…</Pixel>;

  const unclaimed = Object.entries(trusted.rewards || {}).filter(([, r]) => r.status === "unclaimed");
  const fpChip = (
    <span className={`px-2 py-1 rounded-lg text-[11px] font-bold relative ${flame ? "animate-pulse" : ""}`}
      style={{ background: "#10102a", color: "#f4a73b", border: "2px solid #f4a73b" }} data-testid="dr-fire-balance">
      🔥 {fire.vault.toLocaleString()} Fire Power
      {flame && <span className="absolute -top-3 left-1/2 text-base animate-bounce">🔥</span>}
    </span>
  );
  const sharedOverlay = overlay && (
    <Overlay overlay={overlay} setOverlay={setOverlay} save={save} doSave={doSave} trusted={trusted}
      content={content} rid={rid} unclaimed={unclaimed} claim={claim} claimAll={claimAll} claiming={claiming} fire={fire} />
  );

  if (screen === "title") return (
    <Pixel className="overflow-hidden" testid="dr-title">
      <div className="relative p-6 text-center" style={{ background: "linear-gradient(180deg,#0d2b4a 0%,#1d5a28 70%,#2f7a35 100%)" }}>
        <div className="text-[10px] tracking-[4px] font-bold" style={{ color: "#c9ecff" }}>OURREALM PRESENTS</div>
        <h1 className="text-3xl sm:text-5xl font-black mt-1" style={{ color: "#f4a73b", textShadow: "3px 3px 0 #7a1f0e, 6px 6px 0 #10102a" }}>DRAGON REALM</h1>
        <div className="text-lg sm:text-2xl font-black tracking-widest" style={{ color: "#f4d34d", textShadow: "2px 2px 0 #10102a" }}>THE FIRE QUEST</div>
        <TitleScene />
        <div className="mt-3 flex justify-center">{fpChip}</div>
        <div className="mt-4 flex flex-col items-center gap-2">
          {[["New Game", () => { const f = freshSave(); doSave(f, true); setScreen("world"); sfx("click"); }, "dr-new-game"],
            ["Continue", () => { setScreen("world"); sfx("click"); }, "dr-continue", !state.save],
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
      {sharedOverlay}
    </Pixel>
  );

  if (screen === "world") return (
    <Pixel className="p-4" testid="dr-world-map" style={{ background: "#10102a", border: "3px solid #f4a73b" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-black text-sm" style={{ color: "#f4d34d" }}>🗺️ WORLD MAP</h2>
        <span className="ml-auto flex gap-2 items-center">{fpChip}
          <button className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: "#4a4a5a", color: "#fff", border: "2px solid #000" }}
            onClick={() => { stopMusic(); setScreen("title"); }} data-testid="dr-world-back">← Title</button></span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {RO.map((r, i) => {
          const reg = content.regions[r]; const th = REGION_THEMES[r]; const p = regProg(r);
          const open = unlocked(r); const cur = r === rid;
          const bossName = content.bosses[reg.boss_id]?.name;
          return (
            <button key={r} className="rounded-xl p-2.5 text-left flex items-center gap-3 transition-transform hover:scale-[1.01] disabled:opacity-50"
              data-testid={`dr-region-${r}`} disabled={!open}
              style={{ background: `linear-gradient(90deg, ${th.sky}, ${th.ground})`, border: cur ? "3px solid #f4d34d" : "3px solid #000" }}
              onClick={() => { doSave({ ...save, region: r, pos: null }, true); setScreen("explore"); sfx("click"); }}>
              <span className="text-2xl">{open ? th.icon : "🔒"}</span>
              <span className="flex-1 min-w-0">
                <b className="text-[13px]" style={{ color: "#fff", textShadow: "1px 1px 0 #000" }}>{i + 1}. {reg.name}{cur ? " ◀" : ""}</b>
                <div className="text-[9.5px]" style={{ color: "#e8e8f0" }}>
                  {open ? `Boss: ${bossName} ${p.boss ? "✅" : "⚔️"} · dragons ${p.disc}/${reg.dragons.length} · ${p.pct}%` : `Defeat ${content.bosses[content.regions[RO[i - 1]]?.boss_id]?.name} to unlock`}
                </div>
                <div className="h-1.5 rounded mt-1" style={{ background: "#00000066" }}>
                  <div className="h-full rounded" style={{ width: `${p.pct}%`, background: "#f4d34d" }} />
                </div>
              </span>
              {trusted.quests?.[r] && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#3f9e4d", color: "#fff" }}>QUEST ✓</span>}
            </button>
          );
        })}
      </div>
      {unclaimed.length > 0 && (
        <button className="mt-3 w-full py-2 rounded-lg font-black text-[12px] animate-pulse" style={{ background: "#f4a73b", color: "#10102a", border: "3px solid #000" }}
          onClick={() => setOverlay("quest")} data-testid="dr-world-rewards">🔥 {unclaimed.length} FIRE POWER REWARD(S) READY TO CLAIM!</button>
      )}
      {sharedOverlay}
    </Pixel>
  );

  return (
    <div data-testid="dr-game">
      <Pixel className="p-2 mb-2 flex items-center gap-2 flex-wrap" style={{ background: "#10102a", border: "3px solid #f4a73b" }}>
        <button className="text-[12px] font-bold" style={{ color: "#f4d34d" }} onClick={() => { stopMusic(); setScreen("world"); }} data-testid="dr-open-world">🗺️</button>
        <b className="text-[12px]" style={{ color: "#8fd45f" }} data-testid="dr-region-name">{theme.icon} {region?.name}</b>
        <span className="text-[10px] hidden sm:inline" style={{ color: "#cfcfe8" }} data-testid="dr-objective">
          {!bossUnlocked ? `Discover dragons (${regProg(rid).disc}/3)${rid === "enchanted_forest" ? ` · befriend one (${Math.min(1, (trusted.befriended || []).length)}/1)` : ""}` : trusted.bosses?.[rid] ? "Region complete!" : `⚔️ Challenge ${boss?.name} at the boss gate!`}
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

      {screen === "explore" && region && (
        <ExploreView theme={theme} spawnMap={spawnMap}
          pos={save.pos || findTile(theme.map, "S")} setPos={(p) => doSave({ ...save, pos: p })}
          dragons={regionDragons} resolved={save.resolvedByRegion?.[rid] || []} chestOpen={!!save.chests?.[rid]}
          reducedMotion={save.settings?.reducedMotion}
          onEncounter={(id) => startEncounter(id, false)}
          onNpc={() => { setDialog({ who: "Guide", text: bossUnlocked ? `The gate is open, Warden. ${boss?.name} awaits!` : `Discover 3 dragons of the ${region.name}${rid === "enchanted_forest" ? " and befriend one" : ""} — then the boss gate will open.` }); doSave({ ...save, npcTalked: { ...save.npcTalked, [rid]: true } }); }}
          onChest={() => { sfx("claim"); const inv = { ...save.inventory, large_potion: (save.inventory.large_potion || 0) + 1, [rid === "frozen_peaks" ? "thaw_potion" : "antidote"]: (save.inventory[rid === "frozen_peaks" ? "thaw_potion" : "antidote"] || 0) + 1 }; doSave({ ...save, inventory: inv, chests: { ...save.chests, [rid]: true } }, true); setDialog({ who: "Treasure!", text: "You found potions in the chest!" }); }}
          onBossGate={() => { if (!bossUnlocked) { sfx("lose"); setDialog({ who: "Boss Gate", text: "🔒 Sealed. Complete the region objectives first!" }); } else if (trusted.bosses?.[rid]) { setDialog({ who: "Boss Gate", text: `${boss?.name} has already fallen. Onward, via the World Map!` }); } else startEncounter(null, true); }} />
      )}
      {screen === "battle" && battle && (
        <BattleView battle={battle} wizard={save.wizard} party={save.party} inventory={save.inventory}
          sceneTheme={theme} reducedMotion={save.settings?.reducedMotion} firstBattle={firstBattleRef.current}
          onAction={(kind, id) => { if (kind === "use_item") doSave({ ...save, inventory: { ...save.inventory, [id]: Math.max(0, (save.inventory[id] || 0) - 1) } }); }}
          onEnd={endBattle} />
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setDialog(null)}>
          <Pixel className="p-4 max-w-md w-full" testid="dr-dialog">
            <b className="text-[12px]" style={{ color: "#7a1f0e" }}>{dialog.who}</b>
            <p className="text-[13px] mt-1" style={{ color: "#2a2a1a" }}>{dialog.text}</p>
            <button className="mt-2 px-4 py-1.5 rounded-lg text-[11px] font-bold" style={{ background: "#3f9e4d", color: "#fff", border: "2px solid #10102a" }}
              onClick={() => setDialog(null)} data-testid="dr-dialog-close">Continue ▶</button>
          </Pixel>
        </div>
      )}
      {sharedOverlay}
    </div>
  );
}

const TitleScene = () => {
  const ref = useRef(null);
  useEffect(() => {
    let raf, t = 0;
    const cv = ref.current, ctx = cv.getContext("2d");
    const draw = () => {
      t += 1;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = "#10203a";
      [[300, 20], [340, 12], [380, 26]].forEach(([x, h]) => ctx.fillRect(x, 60 - h, 14, h + 30));
      ctx.fillStyle = "#0d3a1a";
      for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.arc(20 + i * 45, 92, 18, 0, 7); ctx.fill(); }
      drawSprite(ctx, WIZARD_PX, WIZ_PAL, 60, 40 + Math.sin(t / 20) * 2, 4);
      drawSprite(ctx, DRAGON_PX, ELEM_PAL.fire, 250, 24 + Math.sin(t / 16) * 3, 5, true);
      for (let i = 0; i < 5; i++) {
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

const REWARD_LABEL = (rid2, content) => {
  if (rid2.startsWith("dragon_first_")) return `🐉 First victory: ${rid2.replace("dragon_first_", "").replace(/_/g, " ")}`;
  if (rid2.startsWith("boss_")) return `⚔️ BOSS DEFEATED: ${content.bosses[rid2.replace("boss_", "")]?.name || rid2}`;
  return `📜 Quest: ${content.quests[rid2.replace("quest_", "")]?.title || rid2}`;
};

const Overlay = ({ overlay, setOverlay, save, doSave, trusted, content, rid, unclaimed, claim, claimAll, claiming, fire }) => {
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
      <p className="text-[13px] mt-1" style={{ color: "#2a2a1a" }}>“{content.quests[rid]?.title}” — {content.regions[rid]?.name} is safe!</p>
      <p className="text-[12px] mt-1 font-bold" style={{ color: "#c07a1a" }}>🔥 FIRE POWER READY TO CLAIM!</p>
      <button className="mt-3 px-5 py-2 rounded-lg font-bold text-sm" style={{ background: "#f4a73b", color: "#10102a", border: "3px solid #10102a" }}
        onClick={() => setOverlay("quest")} data-testid="dr-celebrate-to-quest">View Rewards ▶</button>
    </div>, "dr-celebrate");

  if (overlay === "warden") return body(
    <div className="text-center py-4" style={{ background: "linear-gradient(180deg,#2a0505,#10102a)", margin: -16, padding: 24, borderRadius: 8 }}>
      <div className="text-4xl animate-bounce">👑🐉</div>
      <h2 className="text-xl font-black mt-2" style={{ color: "#f4d34d", textShadow: "2px 2px 0 #7a1f0e" }}>YOU ARE THE DRAGON WARDEN</h2>
      <p className="text-[12px] mt-2" style={{ color: "#e8e8f0" }}>The Legendary Dragon King has fallen. Every land, from the Enchanted Forest to Dragonfall Castle, sings your name.</p>
      <button className="mt-3 px-5 py-2 rounded-lg font-bold text-sm" style={{ background: "#f4a73b", color: "#10102a", border: "3px solid #10102a" }}
        onClick={() => setOverlay("quest")} data-testid="dr-warden-to-quest">Claim the Final Reward ▶</button>
    </div>, "dr-warden");

  if (overlay === "party") return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>🧙 {save.wizard.name} — Lv{save.wizard.lv}</h3>
      <div className="text-[11px] mt-1 grid grid-cols-2 gap-x-3" style={{ color: "#4a4a3a" }} data-testid="dr-party-wizard">
        <span>❤️ HP {save.wizard.hp}/{save.wizard.maxHp}</span><span>✦ MP {save.wizard.mp}/{save.wizard.maxMp}</span>
        <span>⚔️ ATK {save.wizard.atk} · ✨ MAG {save.wizard.mag}</span><span>🛡️ DEF {save.wizard.def} · 💨 SPD {save.wizard.spd}</span>
        <span>🪄 {save.wizard.equip.staff}</span><span>🔥 {fire.vault.toLocaleString()} Fire Power</span>
      </div>
      {(save.wizard.badges || []).length > 0 && (
        <div className="text-[11px] mt-1" style={{ color: "#c07a1a" }}>🏅 {save.wizard.badges.join(" · ")}</div>)}
      <h4 className="font-black text-[12px] mt-3" style={{ color: "#2a2a1a" }}>Active Party ({save.party.length}/4)</h4>
      {save.party.length === 0 && <div className="text-[11px]" style={{ color: "#6a6a5a" }}>Weaken a wild dragon below 35% HP, then Befriend it!</div>}
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
      {(save.reserve || []).length > 0 && (
        <div className="text-[10px] mt-2" style={{ color: "#6a6a5a" }} data-testid="dr-reserve">📦 Reserve: {(save.reserve || []).map((d) => d.name).join(", ")}</div>)}
      <div className="text-[10px] mt-2" style={{ color: "#6a6a5a" }}>🎒 {Object.entries(save.inventory).filter(([, n]) => n > 0).map(([k, n]) => `${ITEMS[k]?.icon || ""} ${ITEMS[k]?.name} ×${n}`).join(" · ") || "Bag empty"}</div>
      <div className="text-[10px] mt-1" style={{ color: "#6a6a5a" }} data-testid="dr-dex">📖 Dragon Log: {(trusted.discovered || []).length}/36 discovered · {(trusted.befriended || []).length} befriended</div>
    </>, "dr-party-view");

  if (overlay === "quest") {
    const q = content.quests[rid];
    const ids = (content.regions[rid]?.dragons || []).map((d) => d.id);
    const disc = (trusted.discovered || []).filter((x) => ids.includes(x)).length;
    const objs = [
      { label: `Discover 3 dragons of the ${content.regions[rid]?.name}`, cur: disc, target: 3 },
      ...(rid === "enchanted_forest" ? [{ label: "Befriend a dragon", cur: (trusted.befriended || []).length, target: 1 }] : []),
      { label: `Defeat ${content.bosses[content.regions[rid]?.boss_id]?.name}`, cur: trusted.bosses?.[rid] ? 1 : 0, target: 1 },
    ];
    return body(
      <>
        <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>📜 {q?.title}</h3>
        <div className="mt-2 flex flex-col gap-1.5">
          {objs.map((o, i) => (
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
          {Object.entries(trusted.rewards || {}).map(([r2, r]) => (
            <div key={r2} className="rounded-lg px-2 py-1.5 flex items-center gap-2 text-[11px]" data-testid={`dr-reward-${r2}`}
              style={{ background: r.status === "claimed" ? "#d8d8c8" : "#fff8dc", border: "2px solid #10102a", color: "#2a2a1a" }}>
              <span className="flex-1">{REWARD_LABEL(r2, content)}</span>
              <b style={{ color: "#c07a1a" }}>+{r.amount} 🔥</b>
              {r.status === "unclaimed" ? (
                <button className="px-3 py-1 rounded-lg text-[10px] font-black animate-pulse" style={{ background: "#8fd45f", color: "#10102a", border: "2px solid #10102a" }}
                  disabled={!!claiming} onClick={() => claim(r2)} data-testid={`dr-claim-${r2}`}>{claiming === r2 ? "…" : "CLAIM NOW"}</button>
              ) : <span className="text-[9px] font-bold" style={{ color: "#3f9e4d" }} data-testid={`dr-claimed-${r2}`}>✓ CLAIMED</span>}
            </div>
          ))}
        </div>
        <div className="text-[9px] mt-2" style={{ color: "#8a8a7a" }}>
          Fire Power is an OurRealm platform feature. It has no monetary value and cannot be exchanged for money or goods.
        </div>
      </>, "dr-quest-view");
  }

  if (overlay === "options") return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>⚙️ Options</h3>
      {[["Sound effects", "sound"], ["Region music", "music"], ["Reduced motion", "reducedMotion"]].map(([label, key]) => (
        <label key={key} className="flex items-center justify-between text-[12px] mt-2" style={{ color: "#2a2a1a" }}>
          {label}
          <input type="checkbox" checked={save.settings?.[key] !== false} data-testid={`dr-opt-${key}`}
            onChange={(e) => doSave({ ...save, settings: { ...save.settings, [key]: e.target.checked } })} />
        </label>
      ))}
      <div className="text-[10px] mt-3" style={{ color: "#6a6a5a" }}>Controls: Arrow keys / WASD, tap a direction on the map, or the on-screen D-pad on mobile. In battle, tap a dragon to cast your selected spell; tap an enemy panel to change targets.</div>
    </>, "dr-options-view");

  if (overlay === "extras") return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>✨ Extras</h3>
      <div className="text-[11px] mt-1" style={{ color: "#4a4a3a" }}>
        <b>Dragon Log:</b> {(trusted.discovered || []).length}/36 discovered · {(trusted.befriended || []).length} befriended<br />
        <b>Bosses felled:</b> {Object.values(trusted.bosses || {}).filter(Boolean).length}/6<br />
        <b>Coming later:</b> Challenge Mode, Boss Rush <i>(after story)</i>, Dragon Arena (Beta), Co-op Realms & PvP Duels (Coming Later).
      </div>
    </>, "dr-extras-view");

  return body(
    <>
      <h3 className="font-black text-sm" style={{ color: "#2a2a1a" }}>📖 Credits</h3>
      <div className="text-[11px] mt-1" style={{ color: "#4a4a3a" }}>
        Dragon Realm: The Fire Quest — an original OurRealm game.<br />
        Runtime family: turn_based_creature_rpg · renderer_pixel_creature_rpg_v1.<br />
        All pixel art, names, music and sounds are original OurRealm creations.
      </div>
    </>, "dr-credits-view");
};
