import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gamepad2, Play, Globe, EyeOff, Pencil, Archive, Share2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { GameCover, resolveCover } from "@/components/games/GameCover";

export default function GameMakerSaved() {
  const [games, setGames] = useState(null);
  const load = useCallback(() => {
    apiClient.get("/gamemaker/saved").then((r) => setGames(r.data.games)).catch(() => setGames([]));
  }, []);
  useEffect(() => { document.title = "Saved Games — OurRealm Game Maker"; load(); }, [load]);

  const publish = async (g, foryou) => {
    try {
      const r = await apiClient.post(`/gamemaker/${g.id}/publish`, { foryou_post: foryou, request_id: `pub-${g.id}-${foryou}-${Date.now()}` });
      toast.success("Publishing started — it will appear on /games when validated");
      const poll = setInterval(async () => {
        const j = await apiClient.get(`/jobs/${r.data.job_id}`).catch(() => null);
        if (!j) return;
        if (j.data.job.phase === "completed") { clearInterval(poll); toast.success("Published! 🎉"); load(); }
        if (j.data.job.phase === "failed") { clearInterval(poll); toast.error(j.data.job.error || "Publish failed"); load(); }
      }, 2500);
    } catch (e) { toast.error(e?.response?.data?.detail || "Publish failed"); }
  };

  return (
    <div className="max-w-4xl mx-auto pb-12" data-testid="gamemaker-saved-page">
      <h1 className="text-xl sm:text-2xl font-black mb-1 flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
        <Gamepad2 size={20} style={{ color: "#C26BFF" }} /> Saved Games</h1>
      <p className="text-[11px] mb-4" style={{ color: "var(--text-muted)" }}>
        Everything you've built with OurRealm Game Maker. <Link to="/gamemaker" className="underline">Create a new game →</Link></p>
      <div className="space-y-2">
        {(games || []).map((g) => (
          <div key={g.id} className="or-surface p-3 rounded-xl flex items-center gap-3 flex-wrap" data-testid={`gm-saved-${g.id}`}>
            {resolveCover(g) && <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0"><GameCover game={g} aspect="1/1" /></div>}
            <div className="flex-1 min-w-[140px]">
              <b className="text-sm block">{g.title}</b>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {g.runtime} · v{g.version || 1} · <span className="uppercase">{g.status}</span>
                {g.gamemaker?.style && <> · {g.gamemaker.style.replace(/_/g, " ")}</>}</span>
            </div>
            <Link to={`/games?play=${g.id}`} className="or-btn or-btn-ghost text-[10px]"><Play size={11} /> Play</Link>
            {g.status === "published" ? (
              <button className="or-btn or-btn-ghost text-[10px]" onClick={async () => { await apiClient.post(`/gamemaker/${g.id}/unpublish`); toast.success("Now private"); load(); }}
                data-testid={`gm-unpublish-${g.id}`}><EyeOff size={11} /> Make private</button>
            ) : g.status === "approved" || g.status === "pending_approval" ? (
              <>
                <button className="or-btn text-[10px]" onClick={() => publish(g, false)} data-testid={`gm-publish-${g.id}`}>
                  <Globe size={11} /> Publish</button>
                <button className="or-btn text-[10px]" onClick={() => publish(g, true)} data-testid={`gm-publish-post-${g.id}`}>
                  <Share2 size={11} /> Publish + For You post</button>
              </>
            ) : null}
            <button className="or-btn or-btn-ghost text-[10px]" data-testid={`gm-rename-${g.id}`}
              onClick={async () => { const t = window.prompt("New title:", g.title); if (!t) return;
                await apiClient.post(`/gamemaker/${g.id}/rename`, { title: t }); load(); }}><Pencil size={11} /> Rename</button>
            {g.status !== "published" && (
              <button className="or-btn or-btn-ghost text-[10px]" data-testid={`gm-archive-${g.id}`}
                onClick={async () => { await apiClient.post(`/gamemaker/${g.id}/archive`).catch((e) => toast.error(e?.response?.data?.detail || "Failed")); load(); }}>
                <Archive size={11} /> Archive</button>)}
          </div>
        ))}
        {games && !games.length && (
          <p className="text-xs or-surface p-6 text-center rounded-xl" style={{ color: "var(--text-muted)" }} data-testid="gm-saved-empty">
            No saved games yet — build your first one in the Game Maker!</p>)}
      </div>
    </div>
  );
}
