import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Gamepad2, Play, Loader2 } from "lucide-react";
import axios from "axios";
import GameRuntime from "@/components/games/GameRuntime";
import { GameCover } from "@/components/games/GameCover";

const API = process.env.REACT_APP_BACKEND_URL;

export default function PublicGamePreview() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [started, setStarted] = useState(false);
  const [finalScore, setFinalScore] = useState(null);
  const [convDismissed, setConvDismissed] = useState(false);

  useEffect(() => {
    axios.get(`${API}/api/public/game-preview/${token}`)
      .then((r) => setData(r.data))
      .catch((e) => {
        const d = e?.response?.data?.detail;
        setErr((typeof d === "object" ? d.message : d) || "This preview link is not available.");
      });
  }, [token]);

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: "#070c18", color: "#EAF2FF" }}
      data-testid="public-game-preview-page">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-3">
          <Gamepad2 size={18} style={{ color: "#C26BFF" }} />
          <b className="text-sm flex-1">{data?.game?.title || "OurRealm Game Preview"}</b>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
            style={{ background: "rgba(244,167,59,0.15)", color: "#F4A73B", border: "1px solid rgba(244,167,59,0.5)" }}
            data-testid="public-preview-badge">Public Preview</span>
        </div>

        {err && (
          <div className="rounded-xl p-6 text-center text-sm" data-testid="public-preview-error"
            style={{ background: "rgba(255,61,90,0.08)", border: "1px solid rgba(255,61,90,0.35)" }}>{err}</div>
        )}
        {!err && !data && (
          <div className="text-center py-16 text-sm" data-testid="public-preview-loading">
            <Loader2 size={20} className="inline animate-spin" /> Loading preview…</div>
        )}

        {data && (
          <>
            <div className="rounded-xl p-3 mb-3 text-[12px]" data-testid="public-preview-disclaimer"
              style={{ background: "rgba(244,167,59,0.08)", border: "1px solid rgba(244,167,59,0.45)", color: "#F4A73B" }}>
              {data.message}
            </div>
            {!started ? (
              <div className="rounded-xl p-8 text-center" style={{ border: "1px solid rgba(46,230,255,0.25)", background: "#0b1220" }}>
                <GameCover game={data.game} aspect="16/9" className="rounded-xl mb-4" />
                <p className="text-xs mb-4" style={{ color: "rgba(234,242,255,0.65)" }}>
                  {data.game.spec?.description}
                </p>
                <button className="px-6 py-2.5 rounded-full font-bold text-sm" data-testid="public-preview-play-btn"
                  style={{ background: "#10E670", color: "#0a0a0a" }} onClick={() => setStarted(true)}>
                  <Play size={13} className="inline mr-1" /> Play Guest Preview
                </button>
              </div>
            ) : (
              <GameRuntime spec={data.game.spec} height={540} gameId={data.game.id}
                controls={data.game.controls} guest
                onScore={(ev) => { if (!convDismissed) setFinalScore(ev); }} />
            )}
            {finalScore && !convDismissed && (
              <div className="fixed inset-0 z-[95] flex items-center justify-center px-4"
                style={{ background: "rgba(4,8,18,0.82)", backdropFilter: "blur(6px)" }} data-testid="guest-score-modal">
                <div className="w-full max-w-sm rounded-2xl p-5 text-center"
                  style={{ background: "#0d1526", border: "1px solid rgba(16,230,112,0.4)" }}>
                  <div className="text-3xl font-black mb-1" style={{ color: "#10E670" }}
                    data-testid="guest-final-score">{Number(finalScore.score || 0).toLocaleString()}</div>
                  <b className="text-sm block mb-1.5">{finalScore.completed ? "You beat it as a guest!" : "Nice run, guest!"}</b>
                  <p className="text-[11.5px] mb-4" style={{ color: "rgba(234,242,255,0.65)" }}>
                    Create a free OurRealm account and runs like this will earn Fire Power,
                    Keys, leaderboard spots and saved progress.
                  </p>
                  <a className="or-btn w-full mb-2 font-bold block" style={{ background: "#10E670", color: "#0a0a0a" }}
                    href="/signup" data-testid="guest-score-signup">Create Account &amp; Keep Earning</a>
                  <button className="or-btn or-btn-ghost w-full text-xs" data-testid="guest-score-dismiss"
                    onClick={() => { setConvDismissed(true); setFinalScore(null); }}>Keep playing as guest</button>
                </div>
              </div>
            )}
            <div className="text-center text-[10px] mt-4" style={{ color: "rgba(234,242,255,0.45)" }}>
              Want Fire Power, Keys and saved progress? <a href="/signup" style={{ color: "#2EE6FF" }}>Join OurRealm free</a>.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
