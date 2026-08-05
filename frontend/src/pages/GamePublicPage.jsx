import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Gamepad2, Play, Loader2, UserPlus, X } from "lucide-react";
import axios from "axios";
import { useAuth } from "@/contexts/AuthContext";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import GameRuntime from "@/components/games/GameRuntime";
import { GameCover } from "@/components/games/GameCover";

const API = process.env.REACT_APP_BACKEND_URL;
const GUEST_MSG = "Guest Preview — create an OurRealm account to save progress and receive Fire Power, Keys and account rewards.";

export default function GamePublicPage() {
  const { parent, slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [prompt, setPrompt] = useState(false);
  const [guestPlay, setGuestPlay] = useState(false);
  const [finalScore, setFinalScore] = useState(null);
  const [convDismissed, setConvDismissed] = useState(false);
  const path = `/games/${parent}${slug ? `/${slug}` : ""}`;

  useEffect(() => {
    if (!slug) {
      // /games/{gameId} → canonical custom URL, else internal play route
      axios.get(`${API}/api/public/game-path/id/${parent}`)
        .then((r) => navigate(r.data.canonical || `/games?play=${parent}`, { replace: true }))
        .catch(() => navigate(`/games?play=${parent}`, { replace: true }));
      return;
    }
    axios.get(`${API}/api/public/game-path/${parent}/${slug}`)
      .then((r) => {
        if (r.data.redirect) { navigate(r.data.redirect, { replace: true }); return; }
        const g = r.data.game;
        setMeta(g);
        document.title = `${g.title} — OurRealm Games`;
        [["og:title", `${g.title} — OurRealm Games`], ["og:description", g.description || "Play on OurRealm"],
         ["og:image", g.cover_url || ""], ["og:url", window.location.href], ["og:type", "website"]]
          .forEach(([p, c]) => {
            let el = document.querySelector(`meta[property="${p}"]`);
            if (!el) { el = document.createElement("meta"); el.setAttribute("property", p); document.head.appendChild(el); }
            el.setAttribute("content", c);
          });
        if (!localStorage.getItem("ourrealm.access")) {
          try { if (!sessionStorage.getItem(`or-game-prompt-${g.id}`)) setPrompt(true); } catch { setPrompt(true); }
        }
      })
      .catch((e) => {
        const d = e?.response?.data?.detail;
        setErr((typeof d === "object" ? d.message : d) || "This game URL is not available.");
      });
  }, [parent, slug, navigate]);

  useEffect(() => {
    // authenticated visitors go straight into the real play experience
    if (user && meta) navigate(`/games?play=${meta.id}`, { replace: true });
  }, [user, meta, navigate]);

  const dismissPrompt = () => {
    setPrompt(false);
    try { sessionStorage.setItem(`or-game-prompt-${meta.id}`, "1"); } catch { /* ok */ }
  };

  if (!slug) return null;

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: "#070c18", color: "#EAF2FF" }}
      data-testid="game-public-page">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-3">
          <Gamepad2 size={18} style={{ color: "#C26BFF" }} />
          <b className="text-sm flex-1" data-testid="game-public-title">{meta?.title || "OurRealm Games"}</b>
          {meta && meta.access_mode !== "published" && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
              style={{ background: "rgba(244,167,59,0.15)", color: "#F4A73B", border: "1px solid rgba(244,167,59,0.5)" }}>
              {meta.access_label}</span>)}
        </div>

        {err && (
          <div className="rounded-xl p-6 text-center text-sm" data-testid="game-public-error"
            style={{ background: "rgba(255,61,90,0.08)", border: "1px solid rgba(255,61,90,0.35)" }}>{err}</div>)}
        {!err && !meta && (
          <div className="text-center py-16 text-sm"><Loader2 size={20} className="inline animate-spin" /> Loading…</div>)}

        {meta && !guestPlay && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(46,230,255,0.25)", background: "#0b1220" }}>
            <GameCover game={meta} aspect="16/9" />
            <div className="p-5">
              <p className="text-xs mb-4" style={{ color: "rgba(234,242,255,0.7)" }}>{meta.description}</p>
              {meta.guest_allowed && (
                <div className="rounded-lg p-2.5 mb-3 text-[11px]" data-testid="guest-preview-message"
                  style={{ background: "rgba(244,167,59,0.08)", border: "1px solid rgba(244,167,59,0.45)", color: "#F4A73B" }}>
                  {GUEST_MSG}
                </div>)}
              <div className="flex flex-wrap gap-2">
                <button className="px-5 py-2 rounded-full font-bold text-sm" data-testid="game-public-signup-btn"
                  style={{ background: "#10E670", color: "#0a0a0a" }}
                  onClick={() => navigate(`/signup?next=${encodeURIComponent(path)}`)}>
                  <UserPlus size={13} className="inline mr-1" /> Create Account &amp; Play</button>
                {meta.guest_allowed ? (
                  <button className="px-5 py-2 rounded-full font-bold text-sm" data-testid="game-public-guest-btn"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(46,230,255,0.4)" }}
                    onClick={() => setGuestPlay(true)}>
                    <Play size={13} className="inline mr-1" /> Play as Guest</button>
                ) : (
                  <button className="px-5 py-2 rounded-full text-sm" data-testid="game-public-signin-btn"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)" }}
                    onClick={() => navigate(`/signin?next=${encodeURIComponent(path)}`)}>Sign in to play</button>
                )}
              </div>
            </div>
          </div>
        )}

        {meta && guestPlay && meta.spec && (
          <>
            <div className="rounded-xl p-2.5 mb-2 text-[11px]" data-testid="guest-hud-message"
              style={{ background: "rgba(244,167,59,0.08)", border: "1px solid rgba(244,167,59,0.45)", color: "#F4A73B" }}>
              {GUEST_MSG}
            </div>
            <GameRuntime spec={meta.spec} height={540} gameId={meta.id} controls={meta.controls} guest
              onScore={(ev) => { if (!convDismissed) setFinalScore(ev); }} />
          </>
        )}

        {guestPlay && finalScore && !convDismissed && (
          <div className="fixed inset-0 z-[95] flex items-center justify-center px-4"
            style={{ background: "rgba(4,8,18,0.82)", backdropFilter: "blur(6px)" }} data-testid="guest-score-modal">
            <div className="w-full max-w-sm rounded-2xl p-5 text-center"
              style={{ background: "#0d1526", border: "1px solid rgba(16,230,112,0.4)" }}>
              <div className="text-3xl font-black mb-1" style={{ color: "#10E670" }}
                data-testid="guest-final-score">{Number(finalScore.score || 0).toLocaleString()}</div>
              <b className="text-sm block mb-1.5">
                {finalScore.completed ? "You beat it as a guest!" : "Nice run, guest!"}</b>
              <p className="text-[11.5px] mb-4" style={{ color: "rgba(234,242,255,0.65)" }}>
                Create a free OurRealm account and runs like this will earn Fire Power,
                Keys, leaderboard spots and saved progress.
              </p>
              <button className="or-btn w-full mb-2 font-bold" style={{ background: "#10E670", color: "#0a0a0a" }}
                data-testid="guest-score-signup"
                onClick={() => navigate(`/signup?next=${encodeURIComponent(path)}`)}>
                Create Account &amp; Keep Earning</button>
              <button className="or-btn or-btn-ghost w-full text-xs" data-testid="guest-score-dismiss"
                onClick={() => { setConvDismissed(true); setFinalScore(null); }}>Keep playing as guest</button>
            </div>
          </div>
        )}

        {prompt && meta && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center px-4"
            style={{ background: "rgba(4,8,18,0.8)", backdropFilter: "blur(6px)" }} data-testid="join-prompt-modal">
            <div className="w-full max-w-sm rounded-2xl p-5 relative"
              style={{ background: "#0d1526", border: "1px solid rgba(46,230,255,0.35)" }}>
              <button className="absolute top-3 right-3 opacity-60 hover:opacity-100" onClick={dismissPrompt}
                data-testid="join-prompt-close"><X size={16} /></button>
              <h2 className="text-base font-bold mb-1.5">Join OurRealm to Save Your Progress</h2>
              <p className="text-[11.5px] mb-4" style={{ color: "rgba(234,242,255,0.65)" }}>
                Create an OurRealm account to save progress, collect Fire Power, store Keys,
                join leaderboards and continue across devices.
              </p>
              <button className="or-btn w-full mb-2 font-bold" style={{ background: "#10E670", color: "#0a0a0a" }}
                data-testid="join-prompt-create"
                onClick={() => navigate(`/signup?next=${encodeURIComponent(path)}`)}>Create Account</button>
              <GoogleSignInButton next={path} divider="none" />
              {meta.guest_allowed && (
                <button className="or-btn or-btn-ghost w-full mt-2 text-xs" data-testid="join-prompt-guest"
                  onClick={() => { dismissPrompt(); setGuestPlay(true); }}>Continue as Guest</button>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
