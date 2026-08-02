import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Gamepad2, Search, Play, ArrowLeft, Trophy, Flag } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import GameRuntime from "@/components/games/GameRuntime";

export default function GamesHub() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState(null);
  const [denied, setDenied] = useState(null);
  const playId = params.get("play");

  const load = useCallback(() => {
    apiClient.get(`/games`, { params: { q } })
      .then((r) => { setData(r.data); setDenied(null); })
      .catch((e) => setDenied(e?.response?.data?.detail || "Games are not available for you yet"));
  }, [q]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!playId) { setPlaying(null); return; }
    apiClient.get(`/games/${playId}`).then((r) => setPlaying(r.data))
      .catch((e) => toast.error(e?.response?.data?.detail || "Game not found"));
  }, [playId]);

  const onScore = useCallback((ev) => {
    if (!playId) return;
    apiClient.post(`/games/${playId}/progress`, { score: ev.score, completed: ev.completed, title: ev.title }).catch(() => {});
  }, [playId]);

  if (denied) {
    return (
      <div className="max-w-2xl mx-auto pt-10 text-center" data-testid="games-hub-denied">
        <Gamepad2 size={40} className="mx-auto mb-3" style={{ color: "#C26BFF" }} />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>{denied}</p>
      </div>
    );
  }

  const prog = new Map((data?.my_progress || []).map((p) => [p.game_id, p]));

  return (
    <div className="max-w-4xl mx-auto pb-12" data-testid="games-hub-page">
      {!playId && (
        <>
          <h1 className="text-2xl sm:text-3xl mb-1 flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
            <Gamepad2 size={26} style={{ color: "#C26BFF" }} /> OurRealm Games
          </h1>
          <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
            Playable learning games created with ORAi — approved and published by the founder.
          </p>
          <div className="relative mb-4 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input className="or-input w-full pl-9 text-sm" placeholder="Search games…" value={q}
              onChange={(e) => setQ(e.target.value)} data-testid="games-search" />
          </div>

          {(data?.my_progress || []).length > 0 && (
            <div className="mb-4" data-testid="games-continue">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#10E670" }}>Continue playing</div>
              <div className="flex gap-2 flex-wrap">
                {data.my_progress.slice(0, 4).map((p) => (
                  <button key={p.game_id} className="or-btn or-btn-ghost text-[11px]"
                    onClick={() => setParams({ play: p.game_id })} data-testid={`games-continue-${p.game_id}`}>
                    <Play size={11} /> {p.game_title || "Game"} · best {p.best_score}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="games-grid">
            {(data?.games || []).map((g) => (
              <button key={g.id} className="or-surface p-4 text-left" onClick={() => setParams({ play: g.id })}
                data-testid={`games-card-${g.id}`}>
                <div className="flex items-center gap-2">
                  <Gamepad2 size={16} style={{ color: "#C26BFF" }} />
                  <b className="text-sm flex-1">{g.title}</b>
                  {prog.get(g.id) && <Trophy size={13} style={{ color: "#F4A73B" }} />}
                </div>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{g.spec?.description}</p>
                <div className="text-[9px] mt-1.5 uppercase tracking-widest" style={{ color: "#2EE6FF" }}>
                  {g.spec?.subject || "General"} · {g.spec?.grade_level || "All ages"} · {g.plays || 0} plays
                </div>
              </button>
            ))}
            {data && !data.games.length && (
              <div className="or-surface p-6 text-center text-xs col-span-2" style={{ color: "var(--text-muted)" }} data-testid="games-hub-empty">
                No published games yet — check back soon!
              </div>
            )}
          </div>
        </>
      )}

      {playId && playing && (
        <div data-testid="game-play-view">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <button className="or-btn or-btn-ghost text-xs" onClick={() => setParams({})} data-testid="game-play-back">
              <ArrowLeft size={13} /> All games</button>
            <b className="text-sm flex-1">{playing.game.title}</b>
            {playing.progress && (
              <span className="text-[10px]" style={{ color: "#F4A73B" }} data-testid="game-best-score">
                <Trophy size={11} className="inline mr-0.5" />Best: {playing.progress.best_score}
              </span>
            )}
            <button className="or-btn or-btn-ghost text-[10px]" data-testid="game-report"
              onClick={() => { const r = window.prompt("What's wrong with this game?"); if (r) { apiClient.post(`/games/${playId}/report`, { reason: r }); toast.success("Reported — thank you"); } }}>
              <Flag size={11} /> Report
            </button>
          </div>
          <div className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
            {playing.game.spec?.description} · <b>Objective:</b> {playing.game.spec?.learning_objective} ·
            <b> Controls:</b> {playing.game.spec?.controls}
          </div>
          <GameRuntime spec={playing.game.spec} onScore={onScore} height={520} />
        </div>
      )}
    </div>
  );
}
