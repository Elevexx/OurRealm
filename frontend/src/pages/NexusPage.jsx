/* /nexus — public presentation + signed-in world entry. */
import { useEffect, useState } from "react";
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

  const enter = async () => {
    if (!user) { nav("/signin"); return; }
    const r = await apiClient.get("/nexus/world");
    setWorld(r.data.world);
    setPlaying(true);
  };
  const onPortal = (e) => {
    if (e.props?.action === "game" && e.props?.game_id) nav(`/games?play=${e.props.game_id}`);
    else if (e.type === "npc") toast.message(e.props?.label || "NPC", { description: e.props?.dialog || "..." });
    else toast.message(e.props?.label || "Portal", { description: "This expansion zone opens in a future update." });
  };

  if (playing && world) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#0a0f1e]" data-testid="nexus-play-shell">
        <NexusWorld mode="play" world={world} username={user?.username} onPortal={onPortal} />
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
          Multiplayer is in Beta — positions sync through server-validated presence. Online counts are real database values.
        </div>
      </div>
    </div>
  );
}
