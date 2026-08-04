/* Dragon Realm engine — deterministic turn-based battle core + world + audio.
   Renderer: renderer_pixel_creature_rpg_v1 (reusable creature-RPG family). */

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRONG = { fire: ["nature", "ice"], water: ["fire", "earth"], earth: ["lightning", "crystal"],
  air: ["nature", "earth"], ice: ["nature", "air"], lightning: ["water", "air"],
  nature: ["water", "earth"], crystal: ["light", "ice"], shadow: ["light", "crystal"], light: ["shadow", "nature"] };
export function elemMult(atk, def) {
  if (!atk || !def) return 1;
  if ((STRONG[atk] || []).includes(def)) return 1.5;
  if ((STRONG[def] || []).includes(atk)) return 0.66;
  return 1;
}

export const SPELLS = {
  fireball: { id: "fireball", name: "Fireball", element: "fire", power: 14, mp: 4, cd: 0, icon: "🔥", unlock: 1, desc: "A blazing orb. Breaks wards and burns away regeneration." },
  ice_shard: { id: "ice_shard", name: "Ice Shard", element: "ice", power: 12, mp: 3, cd: 0, icon: "❄️", unlock: 2, desc: "A razor shard of frost." },
  lightning_bolt: { id: "lightning_bolt", name: "Lightning Bolt", element: "lightning", power: 16, mp: 5, cd: 1, icon: "⚡", unlock: 3, desc: "May stun regular dragons." },
  nature_burst: { id: "nature_burst", name: "Nature Burst", element: "nature", power: 12, mp: 4, cd: 0, icon: "🌿", unlock: 3, desc: "Verdant energy erupts from the ground." },
  heal: { id: "heal", name: "Heal", element: "light", power: -18, mp: 5, cd: 0, icon: "💚", unlock: 1, desc: "Restores your HP." },
  shield: { id: "shield", name: "Shield", element: "crystal", power: 0, mp: 4, cd: 2, icon: "🛡️", unlock: 1, status: "shield", desc: "Halves damage for 3 turns." },
  cleanse: { id: "cleanse", name: "Cleanse", element: "water", power: 0, mp: 3, cd: 1, icon: "💧", unlock: 4, desc: "Removes poison, burn, root and freeze." },
  teleport_strike: { id: "teleport_strike", name: "Teleport Strike", element: "air", power: 20, mp: 7, cd: 2, icon: "🌀", unlock: 5, desc: "Blink behind the enemy — never misses." },
};
export const spellsFor = (lv) => Object.values(SPELLS).filter((s) => lv >= s.unlock);

export const ITEMS = {
  small_potion: { id: "small_potion", name: "Small Health Potion", icon: "🧪", heal: 20, desc: "+20 HP" },
  large_potion: { id: "large_potion", name: "Large Health Potion", icon: "🍶", heal: 45, desc: "+45 HP" },
  magic_potion: { id: "magic_potion", name: "Magic Potion", icon: "🔮", mp: 12, desc: "+12 MP" },
  antidote: { id: "antidote", name: "Antidote", icon: "🌱", cure: ["poison", "burn"], desc: "Cures poison & burn" },
  thaw_potion: { id: "thaw_potion", name: "Thaw Potion", icon: "☕", cure: ["freeze", "stun"], desc: "Cures freeze & stun" },
};

export function newWizard(name) {
  return { name: name || "Warden", lv: 1, xp: 0, hp: 42, maxHp: 42, mp: 22, maxMp: 22,
    atk: 6, def: 5, mag: 9, res: 5, spd: 7, element: "light",
    equip: { staff: "Oak Staff", robe: "Apprentice Robe", hat: "Warden Hat" }, badges: [] };
}
export function xpNeeded(lv) { return lv * 30; }
export function grantXp(w, amount) {
  w.xp += amount; const ups = [];
  while (w.xp >= xpNeeded(w.lv)) {
    w.xp -= xpNeeded(w.lv); w.lv += 1;
    w.maxHp += 6; w.maxMp += 3; w.atk += 1; w.mag += 2; w.def += 1; w.res += 1;
    w.hp = w.maxHp; w.mp = w.maxMp; ups.push(w.lv);
  }
  return ups;
}

/* ── World: one 20x14 map per region. T obstacle, w liquid, r rock, f detail,
   p path, S start, N guide, C chest, B boss gate, 1-6 dragon spots. ─────── */
const M_FOREST = [
  "TTTTTTTTTTTTTTTTTTTT", "T....f..T..1...f...T", "T.S.pppppppppppp.C.T", "T...p..T.....T.p...T",
  "TT..p.TT..2..T.p.TTT", "T...p.....T....p...T", "T.f.ppppNppppppp.3.T", "T...p.....T....p...T",
  "T...p..ww.www..p...T", "TT..p..r.ww....p.TTT", "T...p....f.....ppB.T", "T.4.p.......5......T",
  "T......T.....T..6..T", "TTTTTTTTTTTTTTTTTTTT"];
const M_CAVERN = [
  "TTTTTTTTTTTTTTTTTTTT", "T.S..f...T...1..f..T", "T.pppppp.T.pppppp..T", "T.....p..T.p....p..T",
  "TT.2..p..T.p.T..p.CT", "T.....p....p.T..p..T", "T..ppppNppppp...p..T", "T..p....T..3.T..p..T",
  "T..p.ww.T....T..p..T", "T..p.ww.TT.4.T..p..T", "T..p......f.....pB.T", "T..p..5....T.......T",
  "T..pppppp..T..6....T", "TTTTTTTTTTTTTTTTTTTT"];
const M_DESERT = [
  "TTTTTTTTTTTTTTTTTTTT", "T.S...1....f...2...T", "T.ppppppppppppppp..T", "T....T.....T....p..T",
  "TT.f.T..3..T..C.p.TT", "T....T.....T....p..T", "T.pppppppNppppppp..T", "T.p....ww..T.......T",
  "T.p.4..ww..T...5...T", "T.p....ww..TT.....TT", "T.ppppppppppppppB..T", "T....f.....T.......T",
  "T.......6..T...f...T", "TTTTTTTTTTTTTTTTTTTT"];
const M_FROZEN = [
  "TTTTTTTTTTTTTTTTTTTT", "T..1.....T...f..2..T", "T..ppppppppppppppp.T", "T..p..T..T...T...p.T",
  "TTСp..T..3...T...pTT".replace("С", "."), "T..p..T......T.C.p.T", "T..pppppNpppppp..p.T", "T..p...ww....Tp..p.T",
  "T..p.4.ww.5..Tp..p.T", "TT.p...ww....Tp..pTT", "T..p.........Tpp.B.T", "T..ppppppp...T.....T",
  "T....f...6...T..f..T", "TTTTTTTTTTTTTTTTTTTT"];
const M_STORM = [
  "TTTTTTTTTTTTTTTTTTTT", "T.S..w..1..w...2...T", "T.pp.w.ppp.w.ppp...T", "T..p.w.p.p.w.p.p...T",
  "TT.pppplp.pppp.p.CTT".replace("l", "p"), "T....w.p...w...p...T", "T.3..w.pppNpppppp..T", "T....w.p...w....p..T",
  "T.ppppppp..w.4..p..T", "TT.p...w...w....pTTT", "T..p.5.w...ww...pB.T", "T..ppppppp.w.......T",
  "T....f...6.w...f...T", "TTTTTTTTTTTTTTTTTTTT"];
const M_CASTLE = [
  "TTTTTTTTTTTTTTTTTTTT", "T.S...T..1...T..2..T", "T.ppp.T.pppp.T.pp..T", "T...p.T.p..p.T..p..T",
  "TT..p.ppp..p.ppppTT".padEnd(19, "T") + "T", "T.3.p...w..p....p..T", "T...pppNw..pppp.p..T", "T...p...w.....p.p..T",
  "T.C.p.4.ww.5..p.p..T", "TT..p...ww....p.pTTT", "T...ppppppppppp.pB.T", "T........w......p..T",
  "T...f..6.w...f..p..T", "TTTTTTTTTTTTTTTTTTTT"];

export const REGION_ORDER = ["enchanted_forest", "crystal_caverns", "sandsear_desert",
  "frozen_peaks", "storm_isles", "dragonfall_castle"];

export const REGION_THEMES = {
  enchanted_forest: { map: M_FOREST, ground: "#2f7a35", ground2: "#3a8a40", path: "#b89a5e", liquid: "#2a5a9e", obstacle: "tree", oa: "#1d5a28", ob: "#3f9e4d", trunk: "#5a3a1e", sky: "#0d2b4a", icon: "🌲" },
  crystal_caverns: { map: M_CAVERN, ground: "#2a1a4a", ground2: "#341f58", path: "#6a5a9e", liquid: "#1a3a8a", obstacle: "crystal", oa: "#5a2a9e", ob: "#a86de8", trunk: "#3a1a6a", sky: "#120a2a", icon: "💎" },
  sandsear_desert: { map: M_DESERT, ground: "#c9944a", ground2: "#d4a05a", path: "#e8c48a", liquid: "#e84a1a", obstacle: "dune", oa: "#8a5a1e", ob: "#e8b46a", trunk: "#6a4a1a", sky: "#4a2408", icon: "🏜️" },
  frozen_peaks: { map: M_FROZEN, ground: "#c9dce8", ground2: "#d8e8f4", path: "#8aa8c9", liquid: "#5a9ed8", obstacle: "ice", oa: "#6db8e8", ob: "#e8f4ff", trunk: "#4a7a9e", sky: "#1a3450", icon: "🏔️" },
  storm_isles: { map: M_STORM, ground: "#3a4a5e", ground2: "#44566c", path: "#7a8aa0", liquid: "#141c2c", obstacle: "cloud", oa: "#5a6a8a", ob: "#9eb0cc", trunk: "#2a3448", sky: "#0a0f1e", icon: "⛈️" },
  dragonfall_castle: { map: M_CASTLE, ground: "#2a1a1a", ground2: "#341f1f", path: "#5a3a3a", liquid: "#e83a0a", obstacle: "pillar", oa: "#4a2a2a", ob: "#8a5a5a", trunk: "#1a0a0a", sky: "#1a0505", icon: "🏰" },
};
export const BLOCKED = new Set(["T", "w", "r"]);
export function findTile(map, ch) {
  for (let y = 0; y < map.length; y++) { const x = map[y].indexOf(ch); if (x >= 0) return { x, y }; }
  return { x: 2, y: 2 };
}

/* ── Battle core (supports multiple targetable enemies) ────────────────── */
export function makeFighter(def, isBoss) {
  return { id: def.id, name: def.name, element: def.element, lv: def.level || def.lv || 1,
    hp: def.hp, maxHp: def.hp, atk: def.attack ?? def.atk, def: def.defense ?? def.def,
    mag: def.magic ?? def.mag, res: def.res ?? 5, spd: def.speed ?? def.spd ?? 6,
    statuses: [], boss: !!isBoss, sid: def.id + ":" + Math.floor(Math.random() * 1e6) };
}

export function newBattle(wizard, enemyDef, companion, seed, isBoss) {
  const multi = isBoss && enemyDef.multi_phase;
  const b = { seq: seed, rng: mulberry(seed), round: 1, over: null, phase: multi ? 1 : 0,
    kingDef: multi ? enemyDef : null, channel: 0, ti: 0,
    foes: multi ? enemyDef.supports.map((s) => makeFighter(s, true)) : [makeFighter(enemyDef, isBoss)],
    wiz: { ...wizard, statuses: [], cds: {} },
    comp: companion ? makeFighter(companion) : null,
    bossStep: 0,
    log: [multi ? "👑 The DRAGON KING sends his Royal Guard! Two heads block your path!"
      : "A wild " + enemyDef.name + " appears!" + (isBoss ? " The ground trembles…" : "")] };
  b.foes.forEach((f) => { f.intent = null; });
  return b;
}
export const aliveFoes = (b) => b.foes.filter((f) => f.hp > 0);
export const target = (b) => aliveFoes(b)[Math.min(b.ti, aliveFoes(b).length - 1)] || b.foes[0];

const has = (f, s) => f.statuses.some((x) => x.id === s);
const addStatus = (f, id, turns, val) => { f.statuses = f.statuses.filter((x) => x.id !== id); f.statuses.push({ id, turns, val }); };
const rmStatus = (f, ids) => { f.statuses = f.statuses.filter((x) => !ids.includes(x.id)); };

function dmgCalc(b, atkStat, power, atkElem, tgt, events, isSpell) {
  if (isSpell && has(tgt, "reflect")) {
    const back = Math.max(2, Math.round(power * 0.6));
    b.wiz.hp = Math.max(0, b.wiz.hp - back);
    events.push({ t: "msg", m: "🪞 Reflect Magic bounces your spell back! -" + back }, { t: "dmg", who: "wiz", amount: back });
    return 0;
  }
  const varc = 0.9 + b.rng() * 0.2;
  const crit = b.rng() < 0.1;
  const mult = elemMult(atkElem, tgt.element);
  let dmg = Math.max(1, Math.round((power + atkStat * 1.1 - tgt.def * 0.7) * mult * varc * (crit ? 1.5 : 1)));
  if (has(tgt, "shield")) dmg = Math.max(1, Math.round(dmg * 0.5));
  const ward = tgt.statuses.find((s) => s.id === "ward");
  if (ward) {
    if (atkElem === ward.val || (ward.val === "physical" && !isSpell)) {
      rmStatus(tgt, ["ward"]); events.push({ t: "msg", m: "💥 The ward shatters!" });
    } else { dmg = Math.max(1, Math.round(dmg * 0.25)); events.push({ t: "msg", m: "The ward absorbs the blow…" }); }
  }
  tgt.hp = Math.max(0, tgt.hp - dmg);
  const who = tgt === b.wiz ? "wiz" : tgt === b.comp ? "comp" : "foe" + b.foes.indexOf(tgt);
  events.push({ t: "dmg", who, amount: dmg, crit, eff: mult > 1 ? "weak" : mult < 1 ? "resist" : null });
  if (b.phase === 3 && b.channel > 0 && tgt.id === "dragon_king" && dmg >= 18) {
    b.channel = 0; events.push({ t: "msg", m: "⛓️ You INTERRUPT the Ultimate Cataclysm!" });
  }
  return dmg;
}

/* Boss move scripts. Each entry: (b, f, events) => plays one move + sets intent. */
const hitWiz = (b, f, e, pow, el, m) => { dmgCalc(b, f.atk, pow, el, b.wiz, e); e.push({ t: "msg", m }); };
const BOSS_SCRIPTS = {
  thornbeast(b, f, e) {
    const moves = ["Thorn Shield", "Poison Spikes", "Vine Whip", f.hp < f.maxHp * 0.6 ? "Forest Regeneration" : "Vine Whip", "Root Prison"];
    const mv = f.intent || moves[0];
    if (mv === "Thorn Shield") { addStatus(f, "ward", 99, "fire"); e.push({ t: "msg", m: "🌵 Thorn Shield raised! (fire breaks it)" }); }
    else if (mv === "Poison Spikes") { hitWiz(b, f, e, 8, "nature", "☠️ Poison Spikes! You are poisoned."); addStatus(b.wiz, "poison", 3, 4); }
    else if (mv === "Forest Regeneration") { addStatus(f, "regen", 3, 12); e.push({ t: "msg", m: "🌿 Forest Regeneration! (interrupt with fire)" }); }
    else if (mv === "Root Prison") { addStatus(b.wiz, "root", 1); e.push({ t: "msg", m: "🪢 Root Prison! Only Defend or Item next turn." }); }
    else hitWiz(b, f, e, 14, "nature", "🌿 Vine Whip lashes out!");
    f.intent = moves[(b.bossStep + 1) % moves.length];
  },
  gemnasher(b, f, e) {
    const moves = ["Reflect Magic", "Crystal Barrage", "Summon Crystals", "Prism Beam", "Shattering Roar"];
    const mv = f.intent || moves[0];
    if (mv === "Reflect Magic") { addStatus(f, "reflect", 1); e.push({ t: "msg", m: "🪞 Reflect Magic! Spells will bounce — strike physically!" }); }
    else if (mv === "Summon Crystals") { addStatus(f, "ward", 99, "physical"); e.push({ t: "msg", m: "💎 Summoned crystals ward the beast! (break with Fight)" }); }
    else if (mv === "Prism Beam") hitWiz(b, f, e, 18, "light", "🌈 Prism Beam sears you!");
    else if (mv === "Shattering Roar") { hitWiz(b, f, e, 10, "crystal", "📢 Shattering Roar!"); addStatus(b.wiz, "def_down", 2, 2); }
    else hitWiz(b, f, e, 14, "crystal", "💠 Crystal Barrage!");
    f.intent = moves[(b.bossStep + 1) % moves.length];
  },
  duneblaze(b, f, e) {
    const moves = ["Burning Ground", "Fire Breath", "Solar Charge", "Sandstorm", "Lava Eruption"];
    const mv = f.intent || moves[0];
    if (mv === "Burning Ground") { hitWiz(b, f, e, 8, "fire", "🔥 Burning Ground! You are burned."); addStatus(b.wiz, "burn", 3, 4); }
    else if (mv === "Solar Charge") { addStatus(f, "charge", 1, 30); e.push({ t: "msg", m: "☀️ SOLAR CHARGE! Defend now or take massive damage!" }); }
    else if (mv === "Sandstorm") { hitWiz(b, f, e, 10, "earth", "🌪️ Sandstorm scours the arena!"); addStatus(b.wiz, "blind", 2); }
    else if (mv === "Lava Eruption") hitWiz(b, f, e, 20, "fire", "🌋 Lava Eruption!");
    else hitWiz(b, f, e, 15, "fire", "🔥 Fire Breath!");
    f.intent = moves[(b.bossStep + 1) % moves.length];
  },
  frostwyrm(b, f, e) {
    const moves = ["Frozen Armor", "Ice Breath", "Freeze Player", "Icicle Barrage", "Blizzard"];
    const mv = f.intent || moves[0];
    if (mv === "Frozen Armor") { addStatus(f, "ward", 99, "fire"); e.push({ t: "msg", m: "🧊 Frozen Armor! (melt it with fire)" }); }
    else if (mv === "Freeze Player") { addStatus(b.wiz, "stun", 1); e.push({ t: "msg", m: "🥶 You are FROZEN solid!" }); }
    else if (mv === "Icicle Barrage") hitWiz(b, f, e, 17, "ice", "🗡️ Icicle Barrage!");
    else if (mv === "Blizzard") { hitWiz(b, f, e, 12, "ice", "🌨️ Blizzard howls!"); if (b.comp && b.comp.hp > 0) dmgCalc(b, f.mag, 8, "ice", b.comp, e); }
    else hitWiz(b, f, e, 15, "ice", "❄️ Ice Breath!");
    f.intent = moves[(b.bossStep + 1) % moves.length];
  },
  skytitan(b, f, e) {
    const moves = ["Call Storm Clouds", "Lightning Strike", "Chain Lightning", "Thunder Roar", "Skyfall", "Cyclone"];
    const mv = f.intent || moves[0];
    if (mv === "Call Storm Clouds") { addStatus(f, "atk_up", 3, 4); e.push({ t: "msg", m: "☁️ Storm clouds gather — its power grows!" }); }
    else if (mv === "Chain Lightning") { hitWiz(b, f, e, 14, "lightning", "⛓️⚡ Chain Lightning arcs to everyone!"); if (b.comp && b.comp.hp > 0) dmgCalc(b, f.mag, 10, "lightning", b.comp, e); }
    else if (mv === "Skyfall") { addStatus(f, "charge", 1, 34); e.push({ t: "msg", m: "☄️ SKYFALL incoming! DEFEND!" }); }
    else if (mv === "Thunder Roar") { hitWiz(b, f, e, 12, "lightning", "📢 Thunder Roar!"); addStatus(b.wiz, "def_down", 2, 2); }
    else if (mv === "Cyclone") hitWiz(b, f, e, 18, "air", "🌀 Cyclone hurls you about!");
    else hitWiz(b, f, e, 16, "lightning", "⚡ Lightning Strike!");
    f.intent = moves[(b.bossStep + 1) % moves.length];
  },
  inferno_head(b, f, e) {
    const moves = ["Fire Breath", "Explosive Mark", "Raise Flames"];
    const mv = f.intent || moves[0];
    if (mv === "Explosive Mark") { hitWiz(b, f, e, 10, "fire", "💣 Explosive marks sear the floor!"); addStatus(b.wiz, "burn", 2, 5); }
    else if (mv === "Raise Flames") { addStatus(f, "atk_up", 3, 4); e.push({ t: "msg", m: "🔥 Inferno Head raises the fire's fury!" }); }
    else hitWiz(b, f, e, 15, "fire", "🔥 Inferno Head breathes fire!");
    f.intent = moves[(b.bossStep + 1) % moves.length];
  },
  shadow_head(b, f, e) {
    const moves = ["Shadow Bite", "Veil of Darkness", "Summon Shades"];
    const mv = f.intent || moves[0];
    if (mv === "Veil of Darkness") { addStatus(b.wiz, "blind", 2); e.push({ t: "msg", m: "🌑 Darkness falls — your accuracy drops!" }); }
    else if (mv === "Summon Shades") { hitWiz(b, f, e, 9, "shadow", "👥 Shadow creatures claw at you!"); }
    else hitWiz(b, f, e, 14, "shadow", "🦷 Shadow Head strikes from the dark!");
    f.intent = moves[(b.bossStep + 1) % moves.length];
  },
  dragon_king(b, f, e) {
    if (b.phase === 3 && b.channel > 0) {
      b.channel -= 1;
      if (b.channel === 0) {
        const dmg = has(b.wiz, "shield") ? 24 : 48;
        b.wiz.hp = Math.max(0, b.wiz.hp - dmg);
        e.push({ t: "msg", m: "☄️👑 ULTIMATE CATACLYSM ERUPTS! -" + dmg + (has(b.wiz, "shield") ? " (shielded!)" : "") }, { t: "dmg", who: "wiz", amount: dmg });
        f.intent = "Royal Flame";
      } else { e.push({ t: "msg", m: "👑 The King channels… " + b.channel + " turn(s) to interrupt (18+ damage) or Defend!" }); f.intent = "ULTIMATE CATACLYSM"; }
      return;
    }
    const moves = b.phase === 3
      ? ["Multi-Head Attack", "Shadow Inferno", "Royal Flame", "Summon Minions", "ULTIMATE CATACLYSM"]
      : ["Royal Flame", "Elemental Breath", "Multi-Head Attack"];
    const mv = f.intent || moves[0];
    if (mv === "ULTIMATE CATACLYSM") { b.channel = 2; e.push({ t: "msg", m: "⚠️👑 The King begins the ULTIMATE CATACLYSM! Interrupt it (deal 18+ damage) or Defend!" }); }
    else if (mv === "Multi-Head Attack") { hitWiz(b, f, e, 13, "shadow", "🐲🐲 Multi-Head Attack!"); if (b.comp && b.comp.hp > 0) dmgCalc(b, f.atk, 10, "fire", b.comp, e); }
    else if (mv === "Shadow Inferno") { hitWiz(b, f, e, 16, "shadow", "🌑🔥 Shadow Inferno!"); addStatus(b.wiz, "burn", 2, 5); }
    else if (mv === "Summon Minions") { addStatus(f, "regen", 2, 10); e.push({ t: "msg", m: "👥 Minions shield the King, mending his wounds! (burn them with fire)" }); }
    else if (mv === "Elemental Breath") hitWiz(b, f, e, 15, ["fire", "ice", "lightning"][b.bossStep % 3], "🌈 Elemental Breath!");
    else hitWiz(b, f, e, 17, "fire", "👑🔥 Royal Flame!");
    f.intent = moves[(b.bossStep + 1) % moves.length];
  },
};

function foeActs(b, events) {
  aliveFoes(b).forEach((f) => {
    if (b.over) return;
    if (has(f, "stun")) { events.push({ t: "msg", m: f.name + " is stunned!" }); return; }
    if (BOSS_SCRIPTS[f.id]) { BOSS_SCRIPTS[f.id](b, f, events); return; }
    const charge = f.statuses.find((s) => s.id === "charge");
    if (charge) { rmStatus(f, ["charge"]); const pw = has(b.wiz, "shield") ? charge.val / 2 : charge.val; dmgCalc(b, f.atk, pw, f.element, b.wiz, events); events.push({ t: "msg", m: "💥 The charged attack lands!" }); return; }
    const r = b.rng();
    if (r < 0.75) { dmgCalc(b, f.atk, 9, f.element, b.wiz, events); events.push({ t: "msg", m: f.name + " attacks!" }); }
    else { dmgCalc(b, f.mag, 12, f.element, b.wiz, events); events.push({ t: "msg", m: f.name + " breathes " + f.element + "!" }); }
  });
  b.bossStep += 1;
}

function kingPhases(b, events) {
  if (!b.kingDef) return;
  const king = b.foes.find((f) => f.id === "dragon_king");
  if (b.phase === 1 && (b.round >= 3 || b.foes.some((f) => f.hp < f.maxHp * 0.5))) {
    b.phase = 2;
    b.foes.push(Object.assign(makeFighter(b.kingDef, true), { intent: "Royal Flame" }));
    events.push({ t: "phase", p: 2 }, { t: "msg", m: "👑 PHASE 2 — THE DRAGON KING JOINS THE BATTLE! Three dragons loom before you!" });
  }
  if (b.phase === 2 && king && b.foes.filter((f) => f.id !== "dragon_king").every((f) => f.hp <= 0)) {
    b.phase = 3;
    king.maxHp += 80; king.hp = Math.min(king.maxHp, king.hp + 80); king.atk += 4; king.mag += 4;
    king.intent = "ULTIMATE CATACLYSM";
    events.push({ t: "phase", p: 3 }, { t: "msg", m: "👑🔥 PHASE 3 — THE KING ABSORBS HIS FALLEN HEADS AND TRANSFORMS! Red cracks split his hide!" });
  }
  if (b.phase === 3 && king && king.hp > 0 && king.hp <= king.maxHp * 0.15) {
    b.phase = 4; b.over = "finale";
    events.push({ t: "phase", p: 4 }, { t: "msg", m: "⚔️ PHASE 4 — The King staggers… NOW, WARDEN! Choose your finishing spell!" });
  }
}

function tickStatuses(b, events) {
  [b.wiz, ...aliveFoes(b)].forEach((f) => {
    f.statuses.forEach((s) => {
      if (s.id === "poison" || s.id === "burn") {
        f.hp = Math.max(0, f.hp - s.val);
        events.push({ t: "dmg", who: f === b.wiz ? "wiz" : "foe" + b.foes.indexOf(f), amount: s.val, dot: s.id });
      }
      if (s.id === "regen") { f.hp = Math.min(f.maxHp, f.hp + s.val); events.push({ t: "heal", who: f === b.wiz ? "wiz" : "foe" + b.foes.indexOf(f), amount: s.val }); }
      s.turns -= 1;
    });
    f.statuses = f.statuses.filter((s) => s.turns > 0 || s.id === "ward");
  });
  Object.keys(b.wiz.cds).forEach((k) => { if (b.wiz.cds[k] > 0) b.wiz.cds[k] -= 1; });
}

function endCheck(b, events) {
  if (b.over) return;
  if (aliveFoes(b).length === 0) {
    if (b.kingDef && b.phase < 3) return; // supports down pre-transform — phases handle it
    b.over = "win"; events.push({ t: "msg", m: "🏆 Victory!" });
  }
  if (b.wiz.hp <= 0) { b.over = "loss"; events.push({ t: "msg", m: "💫 You black out…" }); }
}

/* Executes one full round for a player action. Returns structured events. */
export function act(b, action) {
  const events = [];
  if (b.over === "finale" && action.kind === "finisher") {
    const king = b.foes.find((f) => f.id === "dragon_king");
    if (king) king.hp = 0;
    b.over = "win";
    events.push({ t: "msg", m: "🌟 FINAL WARDEN STRIKE — " + (SPELLS[action.spell]?.name || "your magic") + " and every bonded dragon strike as one! The Dragon King falls!" });
    return events;
  }
  if (b.over) return events;
  const rooted = has(b.wiz, "root") || has(b.wiz, "stun");
  const w = b.wiz;
  const tgt = target(b);
  const blindMiss = has(w, "blind") && b.rng() < 0.3;
  if (action.kind === "target") { b.ti = action.i; events.push({ t: "msg", m: "🎯 Targeting " + (aliveFoes(b)[action.i] || tgt).name }); return events; }
  if (action.kind === "fight") {
    if (rooted) { events.push({ t: "msg", m: "You cannot act! Only Defend or Item." }); return events; }
    if (blindMiss) events.push({ t: "msg", m: "🌫️ You swing wide — blinded!" });
    else { dmgCalc(b, w.atk, 8, "light", tgt, events, false); events.push({ t: "msg", m: "You strike with your " + (w.equip?.staff || "staff") + "!" }); }
  } else if (action.kind === "spell") {
    if (rooted) { events.push({ t: "msg", m: "You cannot act! Only Defend or Item." }); return events; }
    const sp = SPELLS[action.spell];
    if (!sp || w.mp < sp.mp) { events.push({ t: "msg", m: "Not enough MP!" }); return events; }
    if ((w.cds[sp.id] || 0) > 0) { events.push({ t: "msg", m: sp.name + " is cooling down." }); return events; }
    w.mp -= sp.mp; if (sp.cd) w.cds[sp.id] = sp.cd + 1;
    if (sp.id === "heal") { const amt = 18 + w.mag; w.hp = Math.min(w.maxHp, w.hp + amt); events.push({ t: "heal", who: "wiz", amount: amt }, { t: "msg", m: "💚 Healed " + amt + " HP." }); }
    else if (sp.id === "shield") { addStatus(w, "shield", 3); events.push({ t: "msg", m: "🛡️ A shimmering shield surrounds you." }); }
    else if (sp.id === "cleanse") { rmStatus(w, ["poison", "burn", "root", "blind", "stun"]); events.push({ t: "msg", m: "💧 Ailments washed away." }); }
    else if (blindMiss && sp.id !== "teleport_strike") events.push({ t: "msg", m: "🌫️ The spell fizzles into the dark — blinded!" });
    else {
      dmgCalc(b, w.mag, sp.power, sp.element, tgt, events, true);
      if (sp.element === "fire" && has(tgt, "regen")) { rmStatus(tgt, ["regen"]); events.push({ t: "msg", m: "🔥 The regeneration is scorched away!" }); }
      if (sp.id === "lightning_bolt" && b.rng() < 0.25 && !tgt.boss) { addStatus(tgt, "stun", 1); events.push({ t: "msg", m: "⚡ " + tgt.name + " is stunned!" }); }
      events.push({ t: "msg", m: "✨ " + sp.name + "!" });
    }
  } else if (action.kind === "item") {
    const it = ITEMS[action.item];
    if (it.heal) { w.hp = Math.min(w.maxHp, w.hp + it.heal); events.push({ t: "heal", who: "wiz", amount: it.heal }); }
    if (it.mp) { w.mp = Math.min(w.maxMp, w.mp + it.mp); }
    if (it.cure) rmStatus(w, it.cure);
    events.push({ t: "msg", m: it.icon + " Used " + it.name + "." });
  } else if (action.kind === "defend") {
    addStatus(w, "shield", 1); w.mp = Math.min(w.maxMp, w.mp + 2);
    events.push({ t: "msg", m: "🛡️ You brace yourself (+2 MP)." });
  } else if (action.kind === "befriend") {
    if (tgt.boss) { events.push({ t: "msg", m: "A boss cannot be befriended!" }); return events; }
    if (tgt.hp > tgt.maxHp * 0.35) { events.push({ t: "msg", m: tgt.name + " is too fierce — weaken it first (below 35% HP)." }); }
    else if (b.rng() < 0.5 + (1 - tgt.hp / tgt.maxHp) * 0.5) { b.over = "befriend"; events.push({ t: "msg", m: "💖 " + tgt.name + " calms down and bonds with you!" }); return events; }
    else events.push({ t: "msg", m: tgt.name + " isn't convinced yet…" });
  } else if (action.kind === "run") {
    if (b.foes.some((f) => f.boss)) { events.push({ t: "msg", m: "You cannot flee from a boss!" }); }
    else if (b.rng() < 0.75) { b.over = "run"; events.push({ t: "msg", m: "🏃 You slipped away safely." }); return events; }
    else events.push({ t: "msg", m: "Couldn't escape!" });
  } else if (action.kind === "swap") {
    b.comp = action.dragon ? makeFighter(action.dragon) : null;
    events.push({ t: "msg", m: action.dragon ? "🐉 " + action.dragon.name + " joins the fight!" : "Your dragon returns." });
  } else if (action.kind === "finisher") {
    const king = b.foes.find((f) => f.id === "dragon_king");
    if (king) king.hp = 0;
    b.over = "win";
    events.push({ t: "msg", m: "🌟 FINAL WARDEN STRIKE — " + (SPELLS[action.spell]?.name || "your magic") + " and every bonded dragon strike as one! The Dragon King falls!" });
    return events;
  }
  kingPhases(b, events); endCheck(b, events);
  if (b.over) return events;
  if (b.comp && b.comp.hp > 0 && !["item", "swap"].includes(action.kind)) {
    dmgCalc(b, b.comp.atk, 7, b.comp.element, target(b), events, false);
    events.push({ t: "msg", m: "🐉 " + b.comp.name + " attacks!" });
    kingPhases(b, events); endCheck(b, events);
    if (b.over) return events;
  }
  foeActs(b, events);
  tickStatuses(b, events);
  kingPhases(b, events); endCheck(b, events);
  if (!b.over) b.round += 1;
  return events;
}

export function turnOrder(b) {
  const list = [{ id: "wiz", name: "You", spd: b.wiz.spd }];
  if (b.comp) list.push({ id: "comp", name: b.comp.name, spd: b.comp.spd });
  aliveFoes(b).forEach((f, i) => list.push({ id: "foe" + i, name: f.name, spd: f.spd }));
  return list.sort((a, c) => c.spd - a.spd);
}

/* ── Tiny WebAudio SFX + per-region chiptune loops ─────────────────────── */
let AC = null;
const ac = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)());
export function sfx(kind) {
  try {
    const o = ac().createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    const t = AC.currentTime;
    const P = { click: [520, 0.05, "square", 0.04], hit: [140, 0.12, "sawtooth", 0.08], heal: [660, 0.2, "sine", 0.05],
      spell: [880, 0.15, "triangle", 0.06], roar: [90, 0.35, "sawtooth", 0.1], win: [784, 0.3, "triangle", 0.07],
      claim: [988, 0.35, "sine", 0.08], step: [300, 0.03, "square", 0.02], lose: [120, 0.4, "sine", 0.08] }[kind] || [440, 0.1, "sine", 0.04];
    o.type = P[2]; o.frequency.setValueAtTime(P[0], t);
    if (kind === "win" || kind === "claim") o.frequency.exponentialRampToValueAtTime(P[0] * 1.5, t + P[1]);
    if (kind === "roar" || kind === "lose") o.frequency.exponentialRampToValueAtTime(P[0] * 0.5, t + P[1]);
    g.gain.setValueAtTime(P[3], t); g.gain.exponentialRampToValueAtTime(0.001, t + P[1]);
    o.start(t); o.stop(t + P[1] + 0.02);
  } catch { /* audio unavailable */ }
}

// Melody degrees over a base freq; -1 = rest. Each region has its own key/mood.
const MUSIC = {
  enchanted_forest: { base: 220, bpm: 132, wave: "square", scale: [0, 2, 4, 7, 9], mel: [0, 2, 4, 2, 3, 2, 1, -1, 0, 2, 4, 7, 4, 2, 1, -1], bass: [0, -1, 0, -1, 3, -1, 2, -1] },
  crystal_caverns: { base: 196, bpm: 108, wave: "triangle", scale: [0, 3, 5, 7, 10], mel: [4, -1, 3, -1, 2, 3, 4, -1, 1, -1, 2, -1, 0, -1, -1, -1], bass: [0, -1, -1, 2, -1, -1, 1, -1] },
  sandsear_desert: { base: 233, bpm: 120, wave: "sawtooth", scale: [0, 1, 4, 5, 7], mel: [0, 1, 2, 1, 0, -1, 4, 3, 2, 1, 2, -1, 1, 0, -1, -1], bass: [0, 0, -1, 0, 2, 2, -1, 2] },
  frozen_peaks: { base: 262, bpm: 96, wave: "sine", scale: [0, 2, 3, 7, 8], mel: [4, -1, 3, -1, 2, -1, 3, -1, 4, -1, 2, -1, 0, -1, -1, -1], bass: [0, -1, -1, -1, 1, -1, -1, -1] },
  storm_isles: { base: 208, bpm: 144, wave: "square", scale: [0, 3, 5, 6, 10], mel: [0, 4, 3, 4, 0, 4, 2, 4, 1, 4, 3, 4, 0, 2, 1, -1], bass: [0, 0, 2, 0, 1, 1, 2, 0] },
  dragonfall_castle: { base: 175, bpm: 100, wave: "sawtooth", scale: [0, 1, 3, 6, 8], mel: [0, -1, 1, -1, 2, -1, 1, 0, 3, -1, 2, -1, 1, -1, 0, -1], bass: [0, 0, -1, 1, 0, 0, -1, 2] },
};
let musicTimer = null, musicStep = 0;
export function startMusic(regionId) {
  stopMusic();
  const M = MUSIC[regionId] || MUSIC.enchanted_forest;
  const stepMs = 60000 / M.bpm / 2;
  musicStep = 0;
  const note = (deg, base, wave, vol, dur) => {
    if (deg < 0) return;
    try {
      const o = ac().createOscillator(), g = AC.createGain();
      o.connect(g); g.connect(AC.destination);
      const semis = M.scale[deg % M.scale.length] + 12 * Math.floor(deg / M.scale.length);
      o.type = wave; o.frequency.value = base * Math.pow(2, semis / 12);
      const t = AC.currentTime;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    } catch { /* ignore */ }
  };
  musicTimer = setInterval(() => {
    note(M.mel[musicStep % M.mel.length], M.base * 2, M.wave, 0.022, stepMs / 1000 * 0.9);
    if (musicStep % 2 === 0) note(M.bass[(musicStep / 2) % M.bass.length], M.base / 2, "triangle", 0.03, stepMs / 500);
    musicStep += 1;
  }, stepMs);
}
export function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
