/* /nexus — public presentation + signed-in world entry. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "@/contexts/AuthContext";
import apiClient from "@/api/client";
import NexusWorld from "@/components/nexus/NexusWorld";
import { toast } from "sonner";

const API = process.env.REACT_APP_BACKEND_URL;
const BADGE = { live: ["LIVE", "#2ee87a"], beta: ["BETA", "#ffb35c"], phase_b_pending: ["PHASE B", "#8a93b0"], phase_c_pending: ["PHASE C", "#8a93b0"] };

export default function NexusPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState(null);
  const [world, setWorld] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [zoneId, setZoneId] = useState("plaza");
  const [worldVersion, setWorldVersion] = useState(0);
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

  const [avInfo, setAvInfo] = useState(null);
  useEffect(() => {
    if (user) apiClient.get("/nexus/avatars").then((r) => setAvInfo(r.data)).catch(() => {});
  }, [user]);
  const pickAvatar = async (id) => {
    await apiClient.post("/nexus/avatars/select", { id });
    setAvInfo((p) => ({ ...p, my_id: id }));
    toast.success("Avatar saved to your account");
  };
  const myAvatarUrl = avInfo?.avatars?.find((a) => a.id === avInfo.my_id)?.url || null;

  const enter = async () => {
    if (!user) { nav("/signin"); return; }
    const [wr, pr] = await Promise.all([
      apiClient.get("/nexus/world"),
      apiClient.get("/nexus/position").catch(() => ({ data: {} })),
    ]);
    const nextWorld = wr.data.world;
    const savedZone = pr.data?.position?.zone_id;
    const validZone = nextWorld.zones?.some((z) => z.id === savedZone);
    const defZone = nextWorld.meta?.default_zone;
    const defValid = nextWorld.zones?.some((z) => z.id === defZone);
    setZoneId(validZone ? savedZone : (defValid ? defZone : (nextWorld.zones?.[0]?.id || "plaza")));
    setWorld(nextWorld);
    setWorldVersion(Number(wr.data.version || 0));
    setPlaying(true);
  };
  const onPortal = (e) => {
    if (e.props?.action === "zone" && e.props?.target_zone) {
      const target = world?.zones?.find((z) => z.id === e.props.target_zone);
      if (!target) {
        toast.error("That Nexus zone is unavailable.");
        return;
      }
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
      if (!zoneStillExists) setZoneId(nextWorld.zones?.[0]?.id || "plaza");
      toast.success("World Updated");
    } catch {
      // Keep the last complete published world and retry on the next presence poll.
    } finally {
      syncingRef.current = false;
    }
  }, [worldVersion, zoneId]);

  if (playing && world) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#0a0f1e]" data-testid="nexus-play-shell">
        <NexusWorld key={`${zoneId}:${worldVersion}`} mode="play" world={world}
          zoneId={zoneId} username={user?.username} avatarUrl={myAvatarUrl} onPortal={onPortal}
          onPublishedVersion={refreshPublished} travelRef={travelRef} />
        <button onClick={() => setPlaying(false)} data-testid="nexus-exit-btn"
          className="absolute top-2 left-1/2 -translate-x-1/2 text-xs font-semibold text-white/90 bg-black/50 rounded-lg px-3 py-1.5">✕ Leave World</button>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white" data-testid="nexus-page">
      <div className="max-w-5xl mx-auto px-6 py-14">
        <div className="text-xs tracking-[0.3em] text-cyan-300/80 font-bold">OURREALM</div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black mt-2" style={{ fontFamily: "inherit" }}>
          NEXUS <span className="text-cyan-300">V1</span>
        </h1>
        <p className="mt-3 text-base text-white/70 max-w-2xl">
          One continuously expanding shared world. Explore the Community Plaza, meet other members in
          real time, and step through portals into OurRealm games and future districts.
        </p>
        <div className="mt-6 flex items-center gap-4 flex-wrap">
          <button onClick={enter} data-testid="nexus-enter-btn"
            className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm">
            {user ? "Enter World" : "Sign in to Enter"}
          </button>
          <div className="text-sm text-white/80 bg-white/5 rounded-xl px-4 py-3" data-testid="nexus-public-online">
            <b className="text-cyan-300">{info?.online ?? 0}</b> member{(info?.online ?? 0) === 1 ? "" : "s"} online now
          </div>
        </div>
        {user && avInfo?.avatars?.length > 0 && (
          <div className="mt-5 flex items-center gap-2 flex-wrap" data-testid="nexus-avatar-picker">
            <span className="text-xs text-white/60 font-bold">YOUR AVATAR:</span>
            {avInfo.avatars.map((a) => (
              <button key={a.id} onClick={() => pickAvatar(a.id)} data-testid={`nexus-avatar-pick-${a.id}`}
                className={`text-xs font-bold rounded-lg px-3 py-1.5 ${avInfo.my_id === a.id ? "bg-cyan-500 text-black" : "bg-white/10 text-white/75 hover:bg-white/20"}`}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(info?.systems || {}).map(([k, v]) => (
            <div key={k} className="bg-white/5 rounded-xl p-4 flex items-center justify-between" data-testid={`nexus-system-${k}`}>
              <span className="text-sm capitalize text-white/85">{k.replaceAll("_", " ")}</span>
              <span className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: (BADGE[v] || BADGE.beta)[1] + "22", color: (BADGE[v] || BADGE.beta)[1] }}>
                {(BADGE[v] || BADGE.beta)[0]}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-8 text-xs text-white/45">
          Multiplayer is live — positions, avatars and chat sync through server-validated presence. Online counts are real database values.
        </div>
      </div>
    </div>
  );
}
