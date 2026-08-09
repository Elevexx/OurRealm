import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Gamepad2, Search, Play, ArrowLeft, Trophy, Flag } from "lucide-react";
import { GameMakerCTA } from "@/components/games/GameMakerCTA";
import { ContinuePlaying } from "@/components/games/ContinuePlaying";
import { GameGate } from "@/components/games/GameGate";
import { toast } from "sonner";
import apiClient from "@/api/client";
import GameRuntime from "@/components/games/GameRuntime";
import { GameCover, resolveCover } from "@/components/games/GameCover";
import DragonRealmRuntime from "@/components/games/dragonrealm/DragonRealmRuntime";
import { GameLeaderboard, AudioSettings } from "@/components/games/GameSocial";

export default function GamesHub() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState(null);
  const [fireInfo, setFireInfo] = useState(null);
  const [gate, setGate] = useState(null);
  const [denied, setDenied] = useState(null);
  const playId = params.get("play");

  const load = useCallback(() => {
    apiClient.get(`/games`, { params: { q } })
      .then((r) => { setData(r.data); setDenied(null); })
      .catch((e) => {
        const d = e?.response?.data?.detail;
        setDenied((typeof d === "object" ? (d.message || d.reason) : d) || "Games are not available for you yet");
      });
  }, [q]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    document.body.classList.toggle("or-game-playing", !!(playId && playing));
    return () => document.body.classList.remove("or-game-playing");
  }, [playId, playing]);

  useEffect(() => {
    if (!playId) { setPlaying(null); setFireInfo(null); return; }
    apiClient.get(`/games/${playId}`).then((r) => setPlaying(r.data))
      .catch((e) => {
        const d = e?.response?.data?.detail;
        setPlaying({ blocked: true, message: (typeof d === "object" ? (d.message || d.reason) : d) || "Game not available" });
      });
    apiClient.get(`/games/${playId}/fire-info`).then((r) => setFireInfo(r.data)).catch(() => setFireInfo(null));
    setGate(null);
    apiClient.get(`/resources/gates/${playId}`).then((r) => setGate(r.data)).catch(() => setGate({ gate: null, satisfied: true }));
  }, [playId]);

  const onScore = useCallback((ev) => {
    if (!playId) return;
    apiClient.post(`/games/${playId}/progress`, { score: ev.score, completed: ev.completed, title: ev.title }).catch(() => {});
    if (ev.completed) {
      apiClient.post(`/games/${playId}/score`, {
        score: ev.score, completed: true, time_s: ev.time_s, stage_reached: ev.stage_reached,
        achievements: ev.achievements || [], no_damage: ev.no_damage, max_combo: ev.max_combo,
      }).then((r) => {
        (r.data.fire_rewards || []).forEach((f) => toast.success(`🔥 +${f.amount} Fire Power — ${f.label} (claim in your Fire Vault)`));
        (r.data.new_achievements || []).forEach((a) => toast.success(`★ Achievement unlocked: ${a}`));
      }).catch(() => {});
    }
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
          <div className="flex items-start gap-2 flex-wrap mb-1">
            <h1 className="text-2xl sm:text-3xl flex items-center gap-2 flex-1 min-w-0" style={{ fontFamily: "var(--font-display)" }}>
              <Gamepad2 size={26} style={{ color: "#C26BFF" }} /> OurRealm Games
            </h1>
            <GameMakerCTA />
          </div>
          <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
            A curated library of playable demos built with ORAi — every title a different genre, world and playstyle. Fully editable Living Projects. <b>Rated 13+.</b>
          </p>
          <div className="relative mb-4 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input className="or-input w-full pl-9 text-sm" placeholder="Search games…" value={q}
              onChange={(e) => setQ(e.target.value)} data-testid="games-search" />
          </div>

          {(data?.my_progress || []).length > 0 && (
            <ContinuePlaying items={data.my_progress} onOpen={(p) => setParams({ play: p.game_id })} />
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3" data-testid="games-grid">
            {(data?.games || []).map((g) => (
              <button key={g.id} className="text-left group relative overflow-hidden rounded-2xl transition-transform duration-200 hover:-translate-y-1"
                style={{ border: "1px solid var(--border-col)", background: "var(--bgc)" }}
                onClick={() => setParams({ play: g.id })} data-testid={`games-card-${g.id}`}>
                {resolveCover(g) ? (
                  <GameCover game={g} aspect="4/5" imgClassName="transition-transform duration-500 group-hover:scale-105">
                    <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 35%, rgba(4,8,18,0.55) 68%, rgba(4,8,18,0.96) 100%)" }} />
                    {g.genre && (
                      <span className="absolute top-2 left-2 text-[8.5px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(4,8,18,0.72)", color: "#2EE6FF", border: "1px solid rgba(46,230,255,0.35)", backdropFilter: "blur(6px)" }}>
                        {g.genre}
                      </span>
                    )}
                    {prog.get(g.id) && <Trophy size={13} className="absolute top-2.5 right-2.5" style={{ color: "#F4A73B", filter: "drop-shadow(0 0 5px #F4A73B)" }} />}
                    <div className="absolute bottom-0 left-0 right-0 p-2.5">
                      <b className="block text-sm leading-tight" style={{ fontFamily: "var(--font-display)" }}>{g.title}</b>
                      <div className="flex items-center justify-between mt-1.5 gap-1">
                        {g.fire_max > 0 ? (
                          <span className="text-[9.5px] font-bold" style={{ color: "#FF8A5A" }} data-testid={`games-card-fire-${g.id}`}>
                            🔥 up to {g.fire_max}
                          </span>
                        ) : <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{g.plays || 0} plays</span>}
                        <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg transition-colors"
                          style={{ background: "rgba(194,107,255,0.2)", color: "#C26BFF", border: "1px solid rgba(194,107,255,0.4)" }}>
                          ▶ Play
                        </span>
                      </div>
                    </div>
                  </GameCover>
                ) : (
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <Gamepad2 size={16} style={{ color: "#C26BFF" }} />
                      <b className="text-sm flex-1">{g.title}</b>
                      {g.access?.mode && g.access.mode !== "published" && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase" data-testid={`game-card-access-${g.id}`}
                          style={{ background: "rgba(244,167,59,0.15)", color: "#F4A73B" }}>{g.access.label}</span>
                      )}
                      {prog.get(g.id) && <Trophy size={13} style={{ color: "#F4A73B" }} />}
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{g.spec?.description}</p>
                    <div className="text-[9px] mt-1.5 uppercase tracking-widest" style={{ color: "#2EE6FF" }}>
                      {g.spec?.subject || "General"} · {g.plays || 0} plays{g.fire_max > 0 && <> · <span style={{ color: "#FF8A5A" }}>🔥 up to {g.fire_max}</span></>}
                    </div>
                  </div>
                )}
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

      {playId && playing?.blocked && (
        <div className="or-surface p-8 text-center" data-testid="game-play-blocked">
          <Gamepad2 size={32} className="mx-auto mb-3" style={{ color: "#FF8A5A" }} />
          <p className="text-sm mb-4" data-testid="game-play-blocked-message">{playing.message}</p>
          <button className="or-btn or-btn-ghost text-xs" onClick={() => setParams({})} data-testid="game-blocked-back">
            <ArrowLeft size={13} /> All games</button>
        </div>
      )}

      {playId && playing && !playing.blocked && (
        <div data-testid="game-play-view">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <button className="or-btn or-btn-ghost text-xs" onClick={() => setParams({})} data-testid="game-play-back">
              <ArrowLeft size={13} /> All games</button>
            <b className="text-sm flex-1">{playing.game.title}</b>
            {playing.access?.label && playing.access.mode !== "published" && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" data-testid="game-access-label"
                style={{ background: "rgba(244,167,59,0.15)", color: "#F4A73B", border: "1px solid rgba(244,167,59,0.45)" }}>
                {playing.access.label}</span>
            )}
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
          {playing.access?.message && (
            <div className="rounded-xl p-2.5 mb-2 text-[11px]" data-testid="game-access-message"
              style={{ background: "rgba(244,167,59,0.08)", border: "1px solid rgba(244,167,59,0.4)", color: "#F4A73B" }}>
              {playing.access.message}
            </div>
          )}
          {fireInfo && playing.game.spec?.runtime !== "turn_based_creature_rpg" && (
            <div className="rounded-xl p-2.5 mb-2 text-[11px]" data-testid="game-fire-info"
              style={{ background: "rgba(255,138,90,0.07)", border: "1px solid rgba(255,138,90,0.3)" }}>
              {fireInfo.enabled ? (
                <>
                  <b style={{ color: "#FF8A5A" }}>🔥 {fireInfo.pool_remaining.toLocaleString()} Fire available</b>
                  <span style={{ color: "var(--text-muted)" }}>
                    {" "}· Stage clear +{fireInfo.rewards.completion} · Finish +{fireInfo.rewards.final_completion}
                    {fireInfo.rewards.perfect > 0 && <> · Perfect +{fireInfo.rewards.perfect}</>}
                    {fireInfo.rewards.speed > 0 && <> · Speed +{fireInfo.rewards.speed}</>}
                    {fireInfo.rewards.achievement > 0 && <> · Achievements +{fireInfo.rewards.achievement}</>}
                    {" "}· up to <b style={{ color: "#FF8A5A" }}>{fireInfo.max_per_player} 🔥</b> per player
                    · community pool {fireInfo.pool_pct}% remaining
                  </span>
                </>
              ) : (
                <span style={{ color: "var(--text-muted)" }} data-testid="game-fire-disabled">🔥 Fire Rewards Currently Disabled</span>
              )}
            </div>
          )}
          {gate?.gate && !gate.satisfied ? (
            <GameGate gameId={playId} status={gate}
              onUnlocked={() => apiClient.get(`/resources/gates/${playId}`).then((r) => setGate(r.data))} />
          ) : playing.game.spec?.runtime === "turn_based_creature_rpg" ? (
            <DragonRealmRuntime />
          ) : (<>
          <div className="relative">
            <GameRuntime spec={playing.game.spec} onScore={onScore} height={520} gameId={playing.game.id}
              controls={playing.game.controls} />
            {playing.access?.view_only && (
              <div className="absolute inset-0 z-10 flex items-end justify-center pb-4" data-testid="game-viewonly-overlay"
                style={{ cursor: "not-allowed" }}>
                <span className="text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider"
                  style={{ background: "rgba(255,138,90,0.92)", color: "#0a0a0a" }}>View Only — input disabled</span>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-1"><AudioSettings /></div>
          <GameLeaderboard gameId={playing.game.id} />
          </>)}
        </div>
      )}
    </div>
  );
}
