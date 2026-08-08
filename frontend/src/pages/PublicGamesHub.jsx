import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gamepad2, Loader2, UserPlus, LogIn } from "lucide-react";
import axios from "axios";
import { GameCover, resolveCover } from "@/components/games/GameCover";

const API = process.env.REACT_APP_BACKEND_URL;

export default function PublicGamesHub() {
  const navigate = useNavigate();
  const [games, setGames] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    document.title = "OurRealm Games";
    axios.get(`${API}/api/public/game-path/hub`)
      .then((r) => setGames(r.data.games || []))
      .catch(() => setErr("Games are not available right now."));
  }, []);

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: "#070c18", color: "#EAF2FF" }}
      data-testid="public-games-hub">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Gamepad2 size={24} style={{ color: "#C26BFF" }} />
          <h1 className="text-xl sm:text-2xl font-black flex-1" style={{ fontFamily: "var(--font-display, inherit)" }}>
            OurRealm Games</h1>
          <button className="px-4 py-1.5 rounded-full font-bold text-xs" data-testid="public-hub-signup-btn"
            style={{ background: "#10E670", color: "#0a0a0a" }}
            onClick={() => navigate("/signup?next=%2Fgames")}>
            <UserPlus size={12} className="inline mr-1" /> Create Account</button>
          <button className="px-4 py-1.5 rounded-full text-xs" data-testid="public-hub-signin-btn"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(46,230,255,0.4)" }}
            onClick={() => navigate("/signin?next=%2Fgames")}>
            <LogIn size={12} className="inline mr-1" /> Sign In</button>
        </div>
        <p className="text-[11px] mb-4" style={{ color: "rgba(234,242,255,0.6)" }}>
          Play free as a guest — create an OurRealm account to save progress and earn Fire Power, Keys and account rewards.
        </p>

        {err && (
          <div className="rounded-xl p-6 text-center text-sm" data-testid="public-hub-error"
            style={{ background: "rgba(255,61,90,0.08)", border: "1px solid rgba(255,61,90,0.35)" }}>{err}</div>)}
        {!err && !games && (
          <div className="text-center py-16 text-sm"><Loader2 size={20} className="inline animate-spin" /> Loading…</div>)}

        {games && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="public-games-grid">
            {games.map((g) => (
              <button key={g.id} className="text-left group relative overflow-hidden rounded-2xl transition-transform duration-200 hover:-translate-y-1"
                style={{ border: "1px solid rgba(46,230,255,0.18)", background: "#0b1220" }}
                onClick={() => navigate(g.canonical)} data-testid={`public-game-card-${g.id}`}>
                {resolveCover(g) ? (
                  <GameCover game={g} aspect="4/5" imgClassName="transition-transform duration-500 group-hover:scale-105">
                    <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 35%, rgba(4,8,18,0.55) 68%, rgba(4,8,18,0.96) 100%)" }} />
                    {g.genre && (
                      <span className="absolute top-2 left-2 text-[8.5px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(4,8,18,0.72)", color: "#2EE6FF", border: "1px solid rgba(46,230,255,0.35)", backdropFilter: "blur(6px)" }}>
                        {g.genre}</span>)}
                    <div className="absolute bottom-0 left-0 right-0 p-2.5">
                      <b className="block text-sm leading-tight">{g.title}</b>
                      <div className="flex items-center justify-between mt-1.5 gap-1">
                        <span className="text-[9px]" style={{ color: "rgba(234,242,255,0.55)" }}>{g.plays || 0} plays</span>
                        <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg"
                          style={{ background: "rgba(194,107,255,0.2)", color: "#C26BFF", border: "1px solid rgba(194,107,255,0.4)" }}>
                          ▶ {g.guest_allowed ? "Play" : "Sign in"}</span>
                      </div>
                    </div>
                  </GameCover>
                ) : (
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <Gamepad2 size={16} style={{ color: "#C26BFF" }} />
                      <b className="text-sm flex-1">{g.title}</b>
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: "rgba(234,242,255,0.55)" }}>{g.description}</p>
                    <div className="text-[9px] mt-1.5 uppercase tracking-widest" style={{ color: "#2EE6FF" }}>
                      {g.plays || 0} plays · {g.guest_allowed ? "Guest play" : "Sign in to play"}</div>
                  </div>
                )}
              </button>
            ))}
            {!games.length && (
              <div className="rounded-xl p-6 text-center text-xs col-span-2" style={{ color: "rgba(234,242,255,0.55)" }}
                data-testid="public-hub-empty">No published games yet — check back soon!</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
