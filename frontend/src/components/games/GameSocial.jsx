import React, { useEffect, useState } from "react";
import { Trophy, Star, Volume2, VolumeX } from "lucide-react";
import apiClient from "@/api/client";

const WINDOWS = [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["all", "All Time"]];
const SCOPES = [["global", "Global"], ["friends", "Friends"], ["realm", "Realm"]];

export function GameLeaderboard({ gameId }) {
  const [win, setWin] = useState("all");
  const [scope, setScope] = useState("global");
  const [lb, setLb] = useState(null);
  const [ach, setAch] = useState(null);
  useEffect(() => {
    apiClient.get(`/games/${gameId}/leaderboard`, { params: { window: win, scope } })
      .then((r) => setLb(r.data)).catch(() => setLb({ entries: [] }));
  }, [gameId, win, scope]);
  useEffect(() => {
    apiClient.get(`/games/${gameId}/achievements`).then((r) => setAch(r.data)).catch(() => null);
  }, [gameId]);
  return (
    <div className="mt-3" data-testid="game-leaderboard">
      <div className="flex items-center gap-1 flex-wrap mb-1.5">
        <Trophy size={12} style={{ color: "#F4A73B" }} />
        <b className="text-[11px] uppercase tracking-wider mr-1" style={{ color: "#F4A73B" }}>Leaderboard</b>
        {SCOPES.map(([k, l]) => (
          <button key={k} className="text-[9.5px] px-2 py-0.5 rounded-full"
            style={{ border: `1px solid ${scope === k ? "#2EE6FF" : "rgba(255,255,255,0.15)"}`, color: scope === k ? "#2EE6FF" : "var(--text-muted)" }}
            onClick={() => setScope(k)} data-testid={`lb-scope-${k}`}>{l}</button>
        ))}
        <span className="mx-1 opacity-30">|</span>
        {WINDOWS.map(([k, l]) => (
          <button key={k} className="text-[9.5px] px-2 py-0.5 rounded-full"
            style={{ border: `1px solid ${win === k ? "#C26BFF" : "rgba(255,255,255,0.15)"}`, color: win === k ? "#C26BFF" : "var(--text-muted)" }}
            onClick={() => setWin(k)} data-testid={`lb-window-${k}`}>{l}</button>
        ))}
      </div>
      {(lb?.entries || []).length === 0 ? (
        <div className="text-[10px] py-1" style={{ color: "var(--text-muted)" }}>No scores yet — be the first!</div>
      ) : (
        <div className="space-y-0.5">
          {lb.entries.map((e, i) => (
            <div key={e.id} className="flex items-center gap-2 text-[11px] rounded-lg px-2 py-1"
              style={{ background: i === 0 ? "rgba(244,167,59,0.08)" : "rgba(255,255,255,0.03)" }}>
              <b className="w-5" style={{ color: i < 3 ? "#F4A73B" : "var(--text-muted)" }}>#{i + 1}</b>
              <span className="flex-1 truncate">{e.username}</span>
              <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>stage {e.stage_reached || 0}</span>
              <b style={{ color: "#2EE6FF" }}>{e.score}</b>
            </div>
          ))}
        </div>
      )}
      {lb?.my_rank && <div className="text-[10px] mt-1" style={{ color: "#10E670" }}>Your rank: #{lb.my_rank}</div>}
      {ach && (ach.defined || []).length > 0 && (
        <div className="mt-2" data-testid="game-achievements">
          <b className="text-[11px] uppercase tracking-wider" style={{ color: "#C26BFF" }}><Star size={11} className="inline mr-1" />Achievements</b>
          <div className="flex flex-wrap gap-1 mt-1">
            {ach.defined.map((a, i) => {
              const got = (ach.earned || []).some((e) => e.label === a.label);
              return (
                <span key={i} className="text-[9.5px] px-2 py-0.5 rounded-full"
                  style={{ border: `1px solid ${got ? "#F4A73B" : "rgba(255,255,255,0.12)"}`, color: got ? "#F4A73B" : "var(--text-muted)", background: got ? "rgba(244,167,59,0.1)" : "transparent" }}>
                  {got ? "★ " : "☆ "}{a.label}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function AudioSettings() {
  const [cfg, setCfg] = useState(() => {
    try { return { master: 0.8, music: 0.5, effects: 0.8, muted: false, ...JSON.parse(localStorage.getItem("or-game-audio") || "{}") }; }
    catch { return { master: 0.8, music: 0.5, effects: 0.8, muted: false }; }
  });
  const [open, setOpen] = useState(false);
  const save = (c) => { setCfg(c); try { localStorage.setItem("or-game-audio", JSON.stringify(c)); } catch { /* full */ } };
  return (
    <div className="relative" data-testid="game-audio-settings">
      <button className="or-btn or-btn-ghost text-[10px]" onClick={() => setOpen(!open)} data-testid="game-audio-toggle">
        {cfg.muted ? <VolumeX size={12} /> : <Volume2 size={12} />} Sound
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-40 rounded-xl p-3 w-52"
          style={{ background: "#0d1526", border: "1px solid rgba(46,230,255,0.3)" }}>
          {["master", "music", "effects"].map((k) => (
            <div key={k} className="mb-1.5">
              <div className="flex justify-between text-[10px]"><span className="capitalize">{k}</span><span>{Math.round((cfg[k] ?? 0.8) * 100)}%</span></div>
              <input type="range" min={0} max={100} value={(cfg[k] ?? 0.8) * 100} className="w-full accent-[#2EE6FF]"
                onChange={(e) => save({ ...cfg, [k]: Number(e.target.value) / 100 })} data-testid={`audio-${k}`} />
            </div>
          ))}
          <button className="or-btn or-btn-ghost text-[10px] w-full justify-center" onClick={() => save({ ...cfg, muted: !cfg.muted })}
            data-testid="audio-mute">{cfg.muted ? "Unmute" : "Mute all"}</button>
          <p className="text-[9px] mt-1" style={{ color: "var(--text-muted)" }}>Applies when a game (re)starts.</p>
        </div>
      )}
    </div>
  );
}
