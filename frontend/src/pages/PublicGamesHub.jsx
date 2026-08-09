import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Gamepad2, Loader2, UserPlus, LogIn, ShieldCheck } from "lucide-react";
import axios from "axios";
import { GameCover, resolveCover } from "@/components/games/GameCover";
import { GameMakerCTA } from "@/components/games/GameMakerCTA";
import { ContinuePlaying } from "@/components/games/ContinuePlaying";

const API = process.env.REACT_APP_BACKEND_URL;
const AGE_KEY = "or_guest_13_ok";
const HIST_KEY = "or_guest_played";

const readGuestHistory = () => {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
};
const recordGuestPlay = (g) => {
  const rows = readGuestHistory().filter((r) => r.game_id !== g.id);
  rows.unshift({ game_id: g.id, game_title: g.title, canonical: g.canonical,
                 last_played: new Date().toISOString() });
  localStorage.setItem(HIST_KEY, JSON.stringify(rows.slice(0, 30)));
};

export default function PublicGamesHub() {
  const navigate = useNavigate();
  const [games, setGames] = useState(null);
  const [err, setErr] = useState(null);
  const [pending, setPending] = useState(null);
  const [history, setHistory] = useState(readGuestHistory);

  useEffect(() => {
    document.title = "OurRealm Games";
    axios.get(`${API}/api/public/game-path/hub`)
      .then((r) => setGames(r.data.games || []))
      .catch(() => setErr("Games are not available right now."));
  }, []);

  const launch = (g) => { recordGuestPlay(g); setHistory(readGuestHistory()); navigate(g.canonical); };
  const openGame = (g) => {
    if (localStorage.getItem(AGE_KEY) === "1") launch(g);
    else setPending(g);
  };
  const resumeFromHistory = (p) => {
    const live = (games || []).find((x) => x.id === p.game_id);
    if (!live) {
      const rows = readGuestHistory().filter((r) => r.game_id !== p.game_id);
      localStorage.setItem(HIST_KEY, JSON.stringify(rows));
      setHistory(rows);
      setErr(null);
      return;
    }
    openGame(live);
  };

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: "#070c18", color: "#EAF2FF" }}
      data-testid="public-games-hub">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Gamepad2 size={24} style={{ color: "#C26BFF" }} />
          <h1 className="text-xl sm:text-2xl font-black flex-1" style={{ fontFamily: "var(--font-display, inherit)" }}>
            OurRealm Games</h1>
          <GameMakerCTA />
          <button className="px-4 py-1.5 rounded-full font-bold text-xs" data-testid="public-hub-signup-btn"
            style={{ background: "#10E670", color: "#0a0a0a" }}
            onClick={() => navigate("/signup?next=%2Fgames")}>
            <UserPlus size={12} className="inline mr-1" /> Create Account</button>
          <button className="px-4 py-1.5 rounded-full text-xs" data-testid="public-hub-signin-btn"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(46,230,255,0.4)" }}
            onClick={() => navigate("/signin?next=%2Fgames")}>
            <LogIn size={12} className="inline mr-1" /> Sign In</button>
        </div>
        <p className="text-[11px] mb-4" style={{ color: "rgba(234,242,255,0.6)" }} data-testid="public-hub-age-line">
          Play free as a guest — create an OurRealm account to save progress and earn Fire Power, Keys and account rewards.
          {" "}<b style={{ color: "#2EE6FF" }}>OurRealm Games and the Game Maker are for ages 13+.</b>
        </p>

        <ContinuePlaying items={history} accent="#2EE6FF" onOpen={resumeFromHistory} />

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
                onClick={() => openGame(g)} data-testid={`public-game-card-${g.id}`}>
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
                        <span className="text-[9px]" style={{ color: "rgba(234,242,255,0.55)" }}>{g.plays || 0} plays · 13+</span>
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
                      {g.plays || 0} plays · 13+ · {g.guest_allowed ? "Guest play" : "Sign in to play"}</div>
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

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(4,8,18,0.85)", backdropFilter: "blur(6px)" }}
          role="dialog" aria-modal="true" aria-label="Age confirmation" data-testid="guest-age-gate">
          <div className="rounded-2xl p-6 max-w-sm w-full text-center"
            style={{ background: "#0b1220", border: "1px solid rgba(46,230,255,0.35)" }}>
            <ShieldCheck size={28} className="mx-auto mb-2" style={{ color: "#2EE6FF" }} aria-hidden="true" />
            <b className="block text-sm mb-1">Ages 13 and up</b>
            <p className="text-xs mb-4" style={{ color: "rgba(234,242,255,0.65)" }}>
              OurRealm Games are for players aged 13 and older. Please confirm you are at least 13 years old to play.
            </p>
            <div className="flex gap-2 justify-center">
              <button className="px-4 py-2 rounded-full font-bold text-xs" data-testid="guest-age-confirm"
                style={{ background: "#10E670", color: "#0a0a0a", minHeight: 44 }}
                onClick={() => { localStorage.setItem(AGE_KEY, "1"); const g = pending; setPending(null); launch(g); }}>
                I'm 13 or older</button>
              <button className="px-4 py-2 rounded-full text-xs" data-testid="guest-age-back"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", minHeight: 44 }}
                onClick={() => setPending(null)}>Go back</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
