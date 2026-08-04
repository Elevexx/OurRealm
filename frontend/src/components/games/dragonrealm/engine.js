/* Dragon Realm engine — deterministic turn-based battle core + map + audio.
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

export const ELEMS = ["fire", "water", "earth", "air", "ice", "lightning", "nature", "crystal", "shadow", "light"];
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
  fireball: { id: "fireball", name: "Fireball", element: "fire", power: 14, mp: 4, cd: 0, icon: "🔥", unlock: 1, desc: "A blazing orb. Breaks thorn shields and burns away regeneration." },
  ice_shard: { id: "ice_shard", name: "Ice Shard", element: "ice", power: 12, mp: 3, cd: 0, icon: "❄️", unlock: 2, desc: "A razor shard of frost." },
  lightning_bolt: { id: "lightning_bolt", name: "Lightning Bolt", element: "lightning", power: 16, mp: 5, cd: 1, icon: "⚡", unlock: 3, desc: "A crackling strike from the sky." },
  nature_burst: { id: "nature_burst", name: "Nature Burst", element: "nature", power: 12, mp: 4, cd: 0, icon: "🌿", unlock: 3, desc: "Verdant energy erupts from the ground." },
  heal: { id: "heal", name: "Heal", element: "light", power: -18, mp: 5, cd: 0, icon: "💚", unlock: 1, desc: "Restores your HP." },
  shield: { id: "shield", name: "Shield", element: "crystal", power: 0, mp: 4, cd: 2, icon: "🛡️", unlock: 1, status: "shield", desc: "Halves damage for 3 turns." },
  cleanse: { id: "cleanse", name: "Cleanse", element: "water", power: 0, mp: 3, cd: 1, icon: "💧", unlock: 4, status: "cleanse", desc: "Removes poison, burn and root." },
  teleport_strike: { id: "teleport_strike", name: "Teleport Strike", element: "air", power: 20, mp: 7, cd: 2, icon: "🌀", unlock: 5, desc: "Blink behind the enemy — never misses." },
};
export const spellsFor = (lv) => Object.values(SPELLS).filter((s) => lv >= s.unlock);

export const ITEMS = {
  small_potion: { id: "small_potion", name: "Small Health Potion", icon: "🧪", heal: 20, desc: "+20 HP" },
  large_potion: { id: "large_potion", name: "Large Health Potion", icon: "🍶", heal: 45, desc: "+45 HP" },
  magic_potion: { id: "magic_potion", name: "Magic Potion", icon: "🔮", mp: 12, desc: "+12 MP" },
  antidote: { id: "antidote", name: "Antidote", icon: "🌱", cure: ["poison", "burn"], desc: "Cures poison & burn" },
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

/* ── Map: Enchanted Forest (20 x 14). T tree, w water, r rock, f flower,
   p path, . grass, S start, N elder, C chest, B boss gate, 1-6 dragon spots */
export const FOREST_MAP = [
  "TTTTTTTTTTTTTTTTTTTT",
  "T....f..T..1...f...T",
  "T.S.pppppppppppp.C.T",
  "T...p..T.....T.p...T",
  "TT..p.TT..2..T.p.TTT",
  "T...p.....T....p...T",
  "T.f.ppppNppppppp.3.T",
  "T...p.....T....p...T",
  "T...p..ww.www..p...T",
  "TT..p..r.ww....p.TTT",
  "T...p....f.....ppB.T",
  "T.4.p.......5......T",
  "T......T.....T..6..T",
  "TTTTTTTTTTTTTTTTTTTT",
];
export const SPAWN_DRAGONS = { 1: "emberling", 2: "mossback", 3: "vinewing", 4: "leafscale", 5: "barkhorn", 6: "glowtail" };
export const BLOCKED = new Set(["T", "w", "r"]);
export function findTile(ch) {
  for (let y = 0; y < FOREST_MAP.length; y++) {
    const x = FOREST_MAP[y].indexOf(ch);
    if (x >= 0) return { x, y };
  }
  return { x: 2, y: 2 };
}

/* ── Battle state ──────────────────────────────────────────────────────── */
export function makeFighter(def, isBoss) {
  return { id: def.id, name: def.name, element: def.element, lv: def.level || def.lv || 1,
    hp: def.hp, maxHp: def.hp, atk: def.attack ?? def.atk, def: def.defense ?? def.def,
    mag: def.magic ?? def.mag, res: def.res ?? 5, spd: def.speed ?? def.spd ?? 6,
    statuses: [], boss: !!isBoss };
}

export function newBattle(wizard, enemyDef, companion, seed, isBoss) {
  return { seq: seed, rng: mulberry(seed), round: 1, over: null,
    wiz: { ...wizard, statuses: [], cds: {} },
    foe: makeFighter(enemyDef, isBoss),
    comp: companion ? makeFighter(companion) : null,
    intent: isBoss ? "Thorn Shield" : null, bossStep: 0, regenTurns: 0,
    log: ["A wild " + enemyDef.name + " appears!" + (isBoss ? " The forest itself trembles…" : "")] };
}

const has = (f, s) => f.statuses.some((x) => x.id === s);
const addStatus = (f, id, turns, val) => { f.statuses = f.statuses.filter((x) => x.id !== id); f.statuses.push({ id, turns, val }); };
const rmStatus = (f, ids) => { f.statuses = f.statuses.filter((x) => !ids.includes(x.id)); };

function dmgCalc(b, atkStat, power, atkElem, target, events) {
  const varc = 0.9 + b.rng() * 0.2;
  const crit = b.rng() < 0.1;
  const mult = elemMult(atkElem, target.element);
  let dmg = Math.max(1, Math.round((power + atkStat * 1.1 - target.def * 0.7) * mult * varc * (crit ? 1.5 : 1)));
  if (has(target, "shield")) dmg = Math.max(1, Math.round(dmg * 0.5));
  if (has(target, "thorn_shield")) {
    if (atkElem === "fire") { rmStatus(target, ["thorn_shield"]); events.push({ t: "msg", m: "🔥 The Thorn Shield burns away!" }); }
    else { dmg = Math.max(1, Math.round(dmg * 0.25)); events.push({ t: "msg", m: "The Thorn Shield absorbs the blow…" }); }
  }
  target.hp = Math.max(0, target.hp - dmg);
  events.push({ t: "dmg", who: target === b.foe ? "foe" : target === b.wiz ? "wiz" : "comp", amount: dmg, crit, eff: mult > 1 ? "weak" : mult < 1 ? "resist" : null });
  return dmg;
}

function bossAct(b, events) {
  const moves = ["Thorn Shield", "Poison Spikes", "Vine Whip", b.foe.hp < b.foe.maxHp * 0.6 ? "Forest Regeneration" : "Vine Whip", "Root Prison"];
  const move = b.intent || moves[b.bossStep % moves.length];
  if (has(b.foe, "stun")) { events.push({ t: "msg", m: "THORNBEAST is stunned and skips its turn!" }); }
  else if (move === "Thorn Shield") { addStatus(b.foe, "thorn_shield", 99); events.push({ t: "msg", m: "🌵 THORNBEAST raises a Thorn Shield! (fire breaks it)" }); }
  else if (move === "Poison Spikes") { dmgCalc(b, b.foe.atk, 8, "nature", b.wiz, events); addStatus(b.wiz, "poison", 3, 4); events.push({ t: "msg", m: "☠️ Poison Spikes! You are poisoned." }); }
  else if (move === "Forest Regeneration") { addStatus(b.foe, "regen", 3, 12); events.push({ t: "msg", m: "🌿 THORNBEAST channels Forest Regeneration! (interrupt with fire)" }); }
  else if (move === "Root Prison") { addStatus(b.wiz, "root", 1); events.push({ t: "msg", m: "🪢 Root Prison! You can only Defend or use Items next turn." }); }
  else { dmgCalc(b, b.foe.atk, 14, "nature", b.wiz, events); events.push({ t: "msg", m: "🌿 Vine Whip lashes out!" }); }
  b.bossStep += 1;
  b.intent = moves[b.bossStep % moves.length];
}

function foeAct(b, events) {
  if (b.foe.hp <= 0) return;
  if (b.foe.boss) return bossAct(b, events);
  if (has(b.foe, "stun")) { events.push({ t: "msg", m: b.foe.name + " is stunned!" }); return; }
  const r = b.rng();
  if (r < 0.75) { dmgCalc(b, b.foe.atk, 9, b.foe.element, b.wiz, events); events.push({ t: "msg", m: b.foe.name + " attacks!" }); }
  else { dmgCalc(b, b.foe.mag, 12, b.foe.element, b.wiz, events); events.push({ t: "msg", m: b.foe.name + " breathes " + b.foe.element + "!" }); }
}

function tickStatuses(b, events) {
  [b.wiz, b.foe].forEach((f) => {
    f.statuses.forEach((s) => {
      if (s.id === "poison" || s.id === "burn") {
        f.hp = Math.max(0, f.hp - s.val);
        events.push({ t: "dmg", who: f === b.foe ? "foe" : "wiz", amount: s.val, dot: s.id });
      }
      if (s.id === "regen") { f.hp = Math.min(f.maxHp, f.hp + s.val); events.push({ t: "heal", who: f === b.foe ? "foe" : "wiz", amount: s.val }); }
      s.turns -= 1;
    });
    f.statuses = f.statuses.filter((s) => s.turns > 0 || s.id === "thorn_shield");
  });
  Object.keys(b.wiz.cds).forEach((k) => { if (b.wiz.cds[k] > 0) b.wiz.cds[k] -= 1; });
}

function endCheck(b, events) {
  if (b.foe.hp <= 0 && !b.over) { b.over = "win"; events.push({ t: "msg", m: "🏆 " + b.foe.name + " is defeated!" }); }
  if (b.wiz.hp <= 0 && !b.over) { b.over = "loss"; events.push({ t: "msg", m: "💫 You black out…" }); }
}

/* Executes one full round for a player action. Returns structured events. */
export function act(b, action) {
  const events = [];
  if (b.over) return events;
  const rooted = has(b.wiz, "root");
  const w = b.wiz;
  if (action.kind === "fight") {
    if (rooted) { events.push({ t: "msg", m: "You are rooted! Only Defend or Item." }); return events; }
    dmgCalc(b, w.atk, 8, "light", b.foe, events);
    events.push({ t: "anim", a: "staff" }, { t: "msg", m: "You strike with your " + (w.equip?.staff || "staff") + "!" });
  } else if (action.kind === "spell") {
    if (rooted) { events.push({ t: "msg", m: "You are rooted! Only Defend or Item." }); return events; }
    const sp = SPELLS[action.spell];
    if (!sp || w.mp < sp.mp) { events.push({ t: "msg", m: "Not enough MP!" }); return events; }
    if ((w.cds[sp.id] || 0) > 0) { events.push({ t: "msg", m: sp.name + " is cooling down." }); return events; }
    w.mp -= sp.mp; if (sp.cd) w.cds[sp.id] = sp.cd + 1;
    if (sp.id === "heal") { const amt = 18 + w.mag; w.hp = Math.min(w.maxHp, w.hp + amt); events.push({ t: "heal", who: "wiz", amount: amt }, { t: "anim", a: "heal" }, { t: "msg", m: "💚 Healed " + amt + " HP." }); }
    else if (sp.id === "shield") { addStatus(w, "shield", 3); events.push({ t: "anim", a: "shield" }, { t: "msg", m: "🛡️ A shimmering shield surrounds you." }); }
    else if (sp.id === "cleanse") { rmStatus(w, ["poison", "burn", "root", "blind"]); events.push({ t: "anim", a: "heal" }, { t: "msg", m: "💧 Ailments washed away." }); }
    else {
      dmgCalc(b, w.mag, sp.power, sp.element, b.foe, events);
      if (sp.element === "fire" && has(b.foe, "regen")) { rmStatus(b.foe, ["regen"]); events.push({ t: "msg", m: "🔥 The regeneration is scorched away!" }); }
      if (sp.id === "lightning_bolt" && b.rng() < 0.25 && !b.foe.boss) { addStatus(b.foe, "stun", 1); events.push({ t: "msg", m: "⚡ " + b.foe.name + " is stunned!" }); }
      events.push({ t: "anim", a: sp.element }, { t: "msg", m: "✨ " + sp.name + "!" });
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
    if (b.foe.boss) { events.push({ t: "msg", m: "The boss cannot be befriended!" }); return events; }
    if (b.foe.hp > b.foe.maxHp * 0.35) { events.push({ t: "msg", m: b.foe.name + " is too fierce — weaken it first (below 35% HP)." }); }
    else if (b.rng() < 0.5 + (1 - b.foe.hp / b.foe.maxHp) * 0.5) { b.over = "befriend"; events.push({ t: "msg", m: "💖 " + b.foe.name + " calms down and bonds with you!" }); return events; }
    else events.push({ t: "msg", m: b.foe.name + " isn't convinced yet…" });
  } else if (action.kind === "run") {
    if (b.foe.boss) { events.push({ t: "msg", m: "You cannot flee from THORNBEAST!" }); }
    else if (b.rng() < 0.75) { b.over = "run"; events.push({ t: "msg", m: "🏃 You slipped away safely." }); return events; }
    else events.push({ t: "msg", m: "Couldn't escape!" });
  } else if (action.kind === "swap") {
    b.comp = action.dragon ? makeFighter(action.dragon) : null;
    events.push({ t: "msg", m: action.dragon ? "🐉 " + action.dragon.name + " joins the fight!" : "Your dragon returns." });
  }
  endCheck(b, events);
  if (b.over) return events;
  if (b.comp && b.comp.hp > 0 && !["item", "swap"].includes(action.kind)) {
    dmgCalc(b, b.comp.atk, 7, b.comp.element, b.foe, events);
    events.push({ t: "msg", m: "🐉 " + b.comp.name + " attacks!" });
    endCheck(b, events);
    if (b.over) return events;
  }
  foeAct(b, events);
  tickStatuses(b, events);
  endCheck(b, events);
  if (!b.over) b.round += 1;
  return events;
}

export function turnOrder(b) {
  const list = [{ id: "wiz", name: "You", spd: b.wiz.spd }];
  if (b.comp) list.push({ id: "comp", name: b.comp.name, spd: b.comp.spd });
  list.push({ id: "foe", name: b.foe.name, spd: b.foe.spd });
  return list.sort((a, c) => c.spd - a.spd);
}

/* ── Tiny WebAudio SFX ─────────────────────────────────────────────────── */
let AC = null;
export function sfx(kind) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
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
