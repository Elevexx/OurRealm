/* /nexus — AAA landing (Reference A) + fullscreen world player shell (Reference B).
   All data is real: online count, zones, system statuses from /api/nexus/public. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { useAuth } from "@/contexts/AuthContext";
import apiClient from "@/api/client";
import NexusWorld from "@/components/nexus/NexusWorld";
import { AvatarCollection, AvatarPreview } from "@/components/nexus/AvatarCollection";
import { toast } from "sonner";
import { Users, DoorOpen, MessageCircle, RefreshCw, ChevronRight, Check, Hexagon } from "lucide-react";

const API = process.env.REACT_APP_BACKEND_URL;

const CARD_ART = {
  nexus_central: "/nexus/card_central.webp",
  emerald_gardens: "/nexus/card_gardens.webp",
};
const ZONE_TAG = { nexus_central: "SPAWN ZONE", plaza: "COMMUNITY HUB", emerald_gardens: "PORTAL DESTINATION" };

export default function NexusPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { instanceId: routeInstance, realmSlug: routeRealm } = useParams();
  const [info, setInfo] = useState(null);
  const [instanceId, setInstanceId] = useState("public-1");
  const [friendsIn, setFriendsIn] = useState([]);
  const [world, setWorld] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [entering, setEntering] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [zoneId, setZoneId] = useState("nexus_central");
  const [worldVersion, setWorldVersion] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const syncingRef = useRef(false);
  const travelRef = useRef(null);

  useEffect(() => {
    const load = () => axios.get(`${API}/api/nexus/public`).then((r) => setInfo(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("or3d-css-fs", playing);
    return () => document.body.classList.remove("or3d-css-fs");
  }, [playing]);

  // browser Back leaves the world first, then the page
  useEffect(() => {
    if (!playing) return undefined;
    window.history.pushState({ nexusWorld: true }, "");
    const onPop = () => exitWorld();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const [avInfo, setAvInfo] = useState(null);
  useEffect(() => {
    if (user) apiClient.get("/nexus/avatars").then((r) => {
      setAvInfo(r.data); setGlowPick(r.data.my_glow || "lime");
      if (String(r.data.my_id || "").startsWith("av_ninja")) setBodyPick(r.data.my_id);
      try {
        if (!localStorage.getItem("nexus_gfx5")) {
          const t = ["low", "bal", "high", "ultra", "max"].includes(r.data.my_gfx) ? r.data.my_gfx : "bal";
          setGfxPick(t); localStorage.setItem("nexus_gfx5", t);
        }
      } catch { /* private mode */ }
    }).catch(() => {});
  }, [user]);
  const GLOWS = { lime: "#a3ff12", cyan: "#22d3ee", blue: "#3b82f6", violet: "#8b5cf6", magenta: "#ec4899", red: "#ef4444", orange: "#f97316", yellow: "#eab308", white: "#f8fafc" };
  const GFX_TIERS = [["low", "LOW"], ["bal", "BALANCED"], ["high", "HIGH"], ["ultra", "ULTRA"], ["max", "MAX"]];
  const [gfxPick, setGfxPick] = useState(() => { try { return localStorage.getItem("nexus_gfx5") || "bal"; } catch { return "bal"; } });
  const pickGfx = (t) => {
    setGfxPick(t);
    try { localStorage.setItem("nexus_gfx5", t); } catch { /* private mode */ }
    if (user) apiClient.post("/nexus/prefs", { gfx: t }).catch(() => {});
  };
  const [glowPick, setGlowPick] = useState("lime");
  const [bodyPick, setBodyPick] = useState(null);
  const [glowSaving, setGlowSaving] = useState(false);
  const saveStarter = async () => {
    if (!bodyPick) return;
    setGlowSaving(true);
    try {
      await apiClient.post("/nexus/avatars/starter", { id: bodyPick, color: glowPick });
      toast.success("Starter Ninja saved");
      const r = await apiClient.get("/nexus/avatars"); setAvInfo(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save avatar"); }
    finally { setGlowSaving(false); }
  };
  const saveGlow = async () => {
    setGlowSaving(true);
    try { await apiClient.post("/nexus/avatars/glow", { color: glowPick }); toast.success("Glow color saved"); }
    catch { toast.error("Could not save glow color"); }
    finally { setGlowSaving(false); }
  };
  const pickAvatar = async (id) => {
    await apiClient.post("/nexus/avatars/select", { id });
    setAvInfo((p) => ({ ...p, my_id: id }));
    toast.success("Avatar saved to your account");
  };
  const myAvatar = avInfo?.avatars?.find((a) => a.id === avInfo.my_id) || null;
  // equipped-avatar thumbnail: optimized derivative > catalog thumb > bundled art (id already carries av_ prefix)
  const myThumb = myAvatar?.thumbs?.w512 || myAvatar?.thumb || (avInfo?.my_id ? `/nexus/${avInfo.my_id}.webp` : null);
  const myThumbSet = myAvatar?.thumbs ? `${myAvatar.thumbs.w512} 512w, ${myAvatar.thumbs.w1024} 1024w` : undefined;
  const isTouch = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0);
  // mobile boots with the optimized LOD so the equipped avatar appears before city decoration
  const myAvatarUrl = (isTouch && (myAvatar?.lod_urls?.lod1 || myAvatar?.lod_urls?.lod2))
    || myAvatar?.rigged_base_url || myAvatar?.url || null;
  const myAvatarMotion = myAvatar?.animation_urls || null;

  const enter = async (targetZone) => {
    if (!user) { nav("/signin"); return; }
    if (entering) return;
    setEntering(true); setLoadError(null);
    try {
      const wr = await apiClient.get("/nexus/world");
      const nextWorld = wr.data.world;
      const wanted = targetZone && nextWorld.zones?.some((z) => z.id === targetZone)
        ? targetZone
        : (nextWorld.meta?.default_zone && nextWorld.zones?.some((z) => z.id === nextWorld.meta.default_zone)
          ? nextWorld.meta.default_zone : (nextWorld.zones?.[0]?.id || "nexus_central"));
      setZoneId(wanted);
      setWorld(nextWorld);
      setWorldVersion(Number(wr.data.version || 0));
      setPlaying(true);
    } catch (err) {
      setLoadError(err?.response?.data?.detail || "Could not load the Nexus world.");
    } finally {
      setEntering(false);
    }
  };
  const exitWorld = () => {
    document.exitPointerLock?.();
    if (document.fullscreenElement) document.exitFullscreen?.();
    setPlaying(false);
  };
  const onPortal = (e) => {
    if (e.props?.action === "zone" && e.props?.target_zone) {
      const target = world?.zones?.find((z) => z.id === e.props.target_zone);
      if (!target) { toast.error("That Nexus zone is unavailable."); return; }
      travelRef.current = { zone_id: target.id, x: target.spawn?.x ?? 0, z: target.spawn?.z ?? 0 };
      setZoneId(target.id);
      toast.success(`Entering ${target.name}`);
    } else if (e.props?.action === "game" && e.props?.game_id) nav(`/games?play=${e.props.game_id}`);
    else if (e.type === "npc") toast.message(e.props?.label || "NPC", { description: e.props?.dialog || "..." });
    else toast.message(e.props?.label || "Portal", { description: "This expansion zone opens in a future update." });
  };

  const refreshPublished = useCallback(async (nextVersion) => {
    if (!nextVersion || nextVersion === worldVersion || syncingRef.current) return;
    syncingRef.current = true;
    try {
      const r = await apiClient.get("/nexus/world");
      const nextWorld = r.data.world;
      const version = Number(r.data.version || nextVersion);
      if (version === worldVersion) return;
      const zoneStillExists = nextWorld.zones?.some((z) => z.id === zoneId);
      setWorld(nextWorld);
      setWorldVersion(version);
      if (!zoneStillExists) setZoneId(nextWorld.meta?.default_zone || nextWorld.zones?.[0]?.id || "nexus_central");
      toast.success("World Updated");
    } catch {
      // keep last complete world; retried on next presence poll
    } finally {
      syncingRef.current = false;
    }
  }, [worldVersion, zoneId]);

  if (playing && world) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#060a16] touch-none overscroll-none select-none"
        style={{ height: "100dvh" }} data-testid="nexus-play-shell">
        <NexusWorld key={`${zoneId}:${worldVersion}:${instanceId}`} mode="play" world={world}
          zoneId={zoneId} username={user?.username} avatarUrl={myAvatarUrl} instanceId={instanceId}
          avatarMotion={myAvatarMotion} avatarGlow={myAvatar?.glow_channel ? glowPick : null} onPortal={onPortal} onExit={exitWorld}
          onPublishedVersion={refreshPublished} travelRef={travelRef} />
        <button onClick={exitWorld} data-testid="nexus-exit-btn" className="sr-only">Leave World</button>
      </div>
    );
  }

  const online = info?.online ?? null;
  const sys = info?.systems || {};
  const live = (k) => sys[k] === "live";
  const feats = [
    { k: "multiplayer", label: "MULTIPLAYER", Icon: Users, on: live("multiplayer") },
    { k: "portal_worlds", label: "PORTAL WORLDS", Icon: DoorOpen, on: live("world") },
    { k: "proximity_chat", label: "PROXIMITY CHAT", Icon: MessageCircle, on: live("proximity_chat") },
    { k: "live_sync", label: "LIVE WORLD SYNC", Icon: RefreshCw, on: live("live_publish_sync") },
  ];

  return (
    <div className="min-h-screen bg-[#060a16] text-white overflow-x-hidden" data-testid="nexus-page">
      {/* HERO */}
      <div className="relative" style={{ background: "radial-gradient(120% 90% at 50% 0%, #14224a 0%, #0a1226 55%, #060a16 100%)" }}>
        <picture>
          <source type="image/webp"
            srcSet="/nexus/hero_480.webp 480w, /nexus/hero_960.webp 960w, /nexus/hero_1440.webp 1440w"
            sizes="100vw" />
          <img src="/nexus/hero_960.jpg" alt="Nexus Central Spawn Zone"
            className="w-full h-[54vh] landscape:h-[44vh] min-h-[340px] landscape:min-h-[200px] max-h-[620px] object-cover object-top"
            fetchPriority="high" loading="eager" decoding="async" data-testid="nexus-hero-img"
            onError={(ev) => { ev.currentTarget.onerror = null; ev.currentTarget.src = "/nexus/hero_480.webp"; }} />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-b from-[#060a16]/35 via-transparent to-[#060a16]" />
        <div className="absolute top-0 left-0 right-0 flex items-center gap-2.5 px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 14px)" }}>
          <Hexagon className="w-7 h-7 text-cyan-300" strokeWidth={2.4} />
          <div className="leading-tight">
            <div className="text-[10px] tracking-[0.34em] text-white/85 font-bold">OURREALM</div>
            <div className="text-lg font-black tracking-[0.14em]">NEXUS</div>
          </div>
          <div className="ml-auto text-[10px] tracking-[0.3em] font-bold text-cyan-300/90 bg-black/40 border border-cyan-400/25 rounded-full px-3 py-1.5">
            SPAWN ZONE
          </div>
        </div>
      </div>

      <div className="max-w-xl lg:max-w-5xl mx-auto px-5 -mt-24 relative z-10 pb-14">
        <div className="lg:grid lg:grid-cols-[1.25fr_1fr] lg:gap-10 lg:items-start landscape:-mt-6 lg:landscape:mt-0">
          <div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl landscape:max-lg:text-3xl font-black leading-[1.02]">
              ONE PROFILE.<br />
              <span className="bg-gradient-to-r from-cyan-300 to-emerald-400 bg-clip-text text-transparent">INFINITE REALMS.</span>
            </h1>
            <p className="mt-4 landscape:max-lg:mt-2 text-base text-white/70 max-w-md">
              Enter Nexus Central. Meet, explore and travel through living worlds—together.
            </p>
            <div className="mt-5 landscape:max-lg:mt-3 flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-2 text-[11px] font-bold bg-white/[0.07] border border-white/10 rounded-full px-3.5 py-2" data-testid="nexus-live-badge">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                NEXUS CENTRAL <span className="text-emerald-400">· LIVE</span>
              </span>
              <span className="inline-flex items-center text-[11px] font-bold bg-white/[0.07] border border-white/10 rounded-full px-3.5 py-2" data-testid="nexus-online-badge">
                {online === null ? "…" : `${online} ONLINE`}
              </span>
            </div>
            <button onClick={() => enter()} disabled={entering} data-testid="nexus-enter-btn"
              className="mt-6 landscape:max-lg:mt-3 w-full lg:max-w-md h-16 landscape:max-lg:h-14 rounded-2xl font-black text-xl tracking-[0.12em] text-white
                bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500 border border-cyan-300/40
                shadow-[0_0_34px_rgba(34,211,238,0.35)] active:scale-[0.985] transition-transform
                disabled:opacity-60 flex items-center justify-center gap-3">
              {entering ? <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
              {entering ? "ENTERING…" : (user ? "ENTER NEXUS" : "SIGN IN TO ENTER")}
            </button>
            {friendsIn.length > 0 && (
              <button onClick={() => enter(null, { friend: friendsIn[0].username })} disabled={entering}
                data-testid="nexus-join-friends-btn"
                className="mt-3 w-full lg:max-w-md h-12 rounded-2xl font-bold text-sm tracking-[0.1em] text-emerald-200 bg-emerald-500/15 border border-emerald-400/40 active:scale-[0.985] transition-transform">
                JOIN FRIENDS — {friendsIn[0].username}{friendsIn.length > 1 ? ` +${friendsIn.length - 1}` : ""} · {friendsIn[0].instance_name || friendsIn[0].instance_id}
              </button>
            )}
            <div className="mt-3 w-full lg:max-w-md grid grid-cols-2 gap-3">
              <button onClick={() => nav("/games")} data-testid="nexus-games-btn"
                className="h-12 rounded-2xl font-black text-sm tracking-[0.1em] text-white bg-white/[0.07] border border-white/15 active:scale-[0.985] transition-transform">
                🎮 GAMES
              </button>
              <button onClick={() => nav("/realmlife")} data-testid="nexus-realmlife-btn"
                className="h-12 rounded-2xl font-black text-sm tracking-[0.1em] text-orange-100 bg-orange-500/15 border border-orange-400/40 active:scale-[0.985] transition-transform">
                🏠 REALMLIFE
              </button>
            </div>
            {loadError && (
              <div className="mt-3 flex items-center gap-3 text-sm text-red-200 bg-red-950/60 border border-red-500/30 rounded-xl px-4 py-3" data-testid="nexus-load-error">
                <span className="flex-1">{loadError}</span>
                <button onClick={() => enter()} className="font-bold text-white bg-red-500/40 rounded-lg px-3 py-1.5" data-testid="nexus-retry-btn">RETRY</button>
              </div>
            )}

            {/* GRAPHICS QUALITY — saved to account + localStorage, applied when entering the world */}
            <div className="mt-4 w-full lg:max-w-md rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-md p-4" data-testid="nexus-landing-gfx">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] tracking-[0.28em] font-bold text-cyan-300">GRAPHICS QUALITY</span>
                <span className="text-[10px] font-black text-emerald-300" data-testid="nexus-landing-gfx-current">
                  {(GFX_TIERS.find(([t]) => t === gfxPick) || [])[1] || "BALANCED"}
                </span>
              </div>
              <div className="mt-2.5 flex gap-1" role="radiogroup" aria-label="Graphics quality" data-testid="nexus-landing-gfx-slider">
                {GFX_TIERS.map(([t, label]) => (
                  <button key={t} role="radio" aria-checked={gfxPick === t} aria-label={`Graphics quality ${label}`}
                    onClick={() => pickGfx(t)} data-testid={`nexus-landing-gfx-${t}`}
                    className={`flex-1 min-h-[44px] rounded-lg text-[9px] font-black tracking-wider uppercase border transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400 outline-none ${gfxPick === t
                      ? "bg-cyan-500/25 border-cyan-300 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.5)]"
                      : "bg-white/5 border-white/15 text-white/60"}`}>
                    {t === "bal" ? "BAL" : t}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[9px] text-white/40 font-bold tracking-wider">
                {user ? "SAVED TO YOUR ACCOUNT · APPLIES WHEN YOU ENTER THE NEXUS" : "SAVED ON THIS DEVICE · APPLIES WHEN YOU ENTER THE NEXUS"}
              </p>
            </div>
          </div>

          {/* YOUR AVATAR */}
          <div className="mt-8 lg:mt-2 rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-md p-5" data-testid="nexus-avatar-card">
            <div className="text-xs tracking-[0.3em] font-bold text-cyan-300">YOUR AVATAR</div>
            {user ? (
              <>
                <div className="mt-3 flex items-center gap-4">
                  <div className="w-20 h-24 rounded-xl bg-gradient-to-b from-[#12203f] to-[#0a1226] border border-cyan-400/20 overflow-hidden isolate flex items-end justify-center">
                    {myThumb && (
                      <img key={`${avInfo.my_id}:${myThumb}`} src={myThumb} srcSet={myThumbSet} sizes="80px" alt=""
                        className="w-full h-full object-cover object-top" data-testid="nexus-my-avatar-img"
                        onError={(ev) => { ev.currentTarget.style.display = "none"; ev.currentTarget.nextSibling.style.display = "flex"; }} />
                    )}
                    <div className={`${myThumb ? "hidden" : "flex"} w-full h-full items-end justify-center`} data-testid="nexus-my-avatar-silhouette" aria-hidden="true">
                      <svg viewBox="0 0 64 80" className="w-14 h-[70px] text-[#1c3564]" fill="currentColor">
                        <circle cx="32" cy="22" r="12" />
                        <path d="M10 80c0-14 10-24 22-24s22 10 22 24z" />
                      </svg>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      </span>
                      <span className="font-black text-lg truncate" data-testid="nexus-avatar-name">
                        {(myAvatar?.label || user.username || "").toUpperCase()}
                      </span>
                    </div>
                    <div className="text-[11px] text-white/50 mt-1">{myAvatar ? "Equipped" : "Default profile avatar"}</div>
                    <button onClick={() => setShowPicker(!showPicker)} data-testid="nexus-avatar-change-btn"
                      className="mt-2.5 text-xs font-bold tracking-[0.2em] text-cyan-300 border border-cyan-400/40 rounded-lg px-4 py-2.5 hover:bg-cyan-400/10">
                      CHANGE
                    </button>
                  </div>
                </div>
                {showPicker && (
                  <div className="mt-4 flex items-center gap-2 flex-wrap" data-testid="nexus-avatar-picker">
                    {(avInfo?.avatars || []).map((a) => (
                      <button key={a.id} onClick={() => pickAvatar(a.id)} data-testid={`nexus-avatar-pick-${a.id}`}
                        className={`text-xs font-bold rounded-lg px-3 py-2 min-h-[44px] ${avInfo.my_id === a.id ? "bg-cyan-500 text-black" : "bg-white/10 text-white/75 hover:bg-white/20"}`}>
                        {a.label}
                      </button>
                    ))}
                    {(avInfo?.avatars || []).length === 0 && <span className="text-xs text-white/50">No avatars available yet.</span>}
                  </div>
                )}
                {(avInfo?.avatars || []).some((a) => a.id === "av_ninja") && (
                  <div className="mt-5 rounded-2xl bg-white/[0.04] border border-white/10 p-4" data-testid="nexus-starter-chooser">
                    <div className="text-xs font-black tracking-[0.22em] text-cyan-300">FREE STARTER NINJAS</div>
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      {[["av_ninja", "MALE NINJA"], ["av_ninja_f", "FEMALE NINJA"]].map(([bid, blabel]) => {
                        const avail = (avInfo?.avatars || []).some((a) => a.id === bid);
                        return (
                          <button key={bid} disabled={!avail} onClick={() => setBodyPick(bid)} data-testid={`nexus-starter-${bid}`}
                            role="radio" aria-checked={bodyPick === bid} aria-label={blabel}
                            className={`rounded-2xl border p-2.5 min-h-[44px] text-left transition-colors ${bodyPick === bid
                              ? "border-lime-300/80 bg-lime-400/10 shadow-[0_0_14px_rgba(163,255,18,0.25)]"
                              : "border-white/12 bg-white/[0.04]"} ${avail ? "" : "opacity-40"}`}>
                            <img src={`/nexus/${bid}.webp`} alt={blabel} loading="lazy" className="w-full h-28 object-cover object-top rounded-xl bg-black/40" />
                            <div className="mt-2 text-[11px] font-black tracking-widest">{blabel}</div>
                            <div className="text-[10px] font-black text-lime-300">{avail ? "FREE" : "COMING ONLINE"}</div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 text-[10px] font-black tracking-[0.22em] text-white/70">LIVE PREVIEW</div>
                    <div className="mt-2">
                      {(() => {
                        // previewAvatarId (bodyPick) is separate from equippedAvatarId (my_id):
                        // with no explicit starter pick, preview the EQUIPPED avatar — never default to Ninja
                        const pid = bodyPick || avInfo?.my_id;
                        const bavRaw = (avInfo?.avatars || []).find((a) => a.id === pid);
                        const burl = bavRaw && (bavRaw.lod_urls?.lod1 || bavRaw.rigged_base_url);
                        const plabel = bodyPick
                          ? (bodyPick === "av_ninja_f" ? "FEMALE NINJA" : "MALE NINJA")
                          : ((bavRaw?.label || "").toUpperCase());
                        const pglow = bavRaw?.glow_channel ? GLOWS[glowPick] : null;
                        return burl ? <AvatarPreview url={burl} glow={pglow} label={plabel} /> : null;
                      })()}
                    </div>
                    <div className="mt-4 text-[10px] font-black tracking-[0.22em] text-white/70">CHOOSE YOUR GLOW <span className="text-cyan-300">— {glowPick.toUpperCase()}</span></div>
                    <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar glow color" data-testid="nexus-glow-picker">
                      {Object.entries(GLOWS).map(([name, hex]) => (
                        <button key={name} role="radio" aria-checked={glowPick === name} aria-label={`Glow color ${name}`}
                          onClick={() => setGlowPick(name)} data-testid={`nexus-glow-${name}`}
                          className={`flex items-center gap-1.5 min-h-[44px] rounded-xl px-3 text-[10px] font-black tracking-widest uppercase border transition-colors ${glowPick === name
                            ? "border-cyan-300 bg-cyan-500/15 text-white shadow-[0_0_10px_rgba(34,211,238,0.4)]"
                            : "border-white/15 bg-white/5 text-white/65"}`}>
                          <span className="w-3.5 h-3.5 rounded-full border border-white/40" style={{ background: hex, boxShadow: `0 0 8px ${hex}` }} aria-hidden="true" />
                          {name}
                        </button>
                      ))}
                    </div>
                    <button onClick={saveStarter} disabled={glowSaving} data-testid="nexus-starter-save"
                      className="mt-4 min-h-[44px] rounded-xl px-6 font-black text-xs tracking-[0.2em] text-black bg-gradient-to-r from-lime-400 to-emerald-400 shadow-[0_0_16px_rgba(163,255,18,0.35)] disabled:opacity-60">
                      {glowSaving ? "SAVING…" : "SAVE AVATAR"}
                    </button>
                    <p className="mt-2 text-[9px] text-white/40 font-bold tracking-wider">ONE GLOW COLOR AT A TIME · FREE FOR ALL USERS</p>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-3">
                <p className="text-sm text-white/60">Sign in to equip your Nexus avatar.</p>
                <button onClick={() => nav("/signin")} className="mt-3 text-xs font-bold tracking-[0.2em] text-cyan-300 border border-cyan-400/40 rounded-lg px-4 py-2.5" data-testid="nexus-avatar-signin-btn">SIGN IN</button>
              </div>
            )}
          </div>
        </div>

        {/* FEATURE STATUS (real backend statuses) */}
        <div className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {feats.map((f) => (
            <div key={f.k} className="flex items-center gap-2.5 rounded-xl bg-white/[0.05] border border-white/10 px-3.5 py-3" data-testid={`nexus-feature-${f.k}`}>
              <f.Icon className="w-4 h-4 text-cyan-300 shrink-0" />
              <span className="text-[11px] font-bold tracking-wide flex-1 truncate">{f.label}</span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${f.on ? "bg-emerald-400" : "bg-white/25"}`} title={f.on ? "LIVE" : "offline"} />
            </div>
          ))}
        </div>

        {user && <AvatarCollection onEquipped={(id) => {
          setBodyPick(String(id || "").startsWith("av_ninja") ? id : null);
          apiClient.get("/nexus/avatars").then((r) => setAvInfo(r.data)).catch(() => {});
        }} />}

        {/* EXPLORE — real zones from the published world */}
        <div className="mt-9">
          <div className="flex items-center justify-between">
            <h2 className="text-base md:text-lg font-black tracking-[0.18em] text-cyan-300">EXPLORE THE NEXUS</h2>
            <ChevronRight className="w-5 h-5 text-cyan-300/60" />
          </div>
          <div className="mt-4 flex gap-3.5 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 lg:overflow-visible snap-x" data-testid="nexus-explore-row">
            {(info?.zones || []).map((zz) => (
              <button key={zz.id} onClick={() => enter(zz.id)} data-testid={`nexus-explore-${zz.id}`}
                className="relative shrink-0 w-[76vw] max-w-[330px] lg:w-auto lg:max-w-none h-44 rounded-2xl overflow-hidden border border-white/10 text-left snap-start group">
                {CARD_ART[zz.id]
                  ? <img src={CARD_ART[zz.id]} alt="" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500" />
                  : <div className="absolute inset-0 bg-gradient-to-br from-[#123a5e] via-[#0d1e42] to-[#0a1226]" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                <div className="absolute bottom-3.5 left-4 right-4 flex items-end justify-between gap-2">
                  <div>
                    <div className="font-black text-base leading-tight">{zz.name.replace(" — Spawn Zone", "").toUpperCase()}</div>
                    <div className="text-[10px] tracking-[0.22em] font-bold text-emerald-300 mt-1">{ZONE_TAG[zz.id] || "NEXUS ZONE"}</div>
                  </div>
                  <span className="w-9 h-9 rounded-full bg-cyan-500/25 border border-cyan-300/50 flex items-center justify-center shrink-0">
                    <ChevronRight className="w-4 h-4 text-cyan-200" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-9 flex items-center justify-center gap-2 text-[11px] text-white/50 pb-2" data-testid="nexus-footer-status">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live world
          <span className="text-white/25">·</span> Synced presence
          <span className="text-white/25">·</span> Mobile + PC
        </div>
      </div>
    </div>
  );
}
