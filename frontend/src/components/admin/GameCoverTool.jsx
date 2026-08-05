import React, { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { GameCover } from "@/components/games/GameCover";

// Founder tool: ORAi-generated cover via the existing OPC image engine.
export const GameCoverTool = ({ game }) => {
  const [busy, setBusy] = useState(false);
  const [cover, setCover] = useState(null);
  const g = cover ? { ...game, cover_url: cover } : game;
  const generate = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post(`/admin/games/${game.id}/generate-cover`);
      setCover(r.data.cover_url);
      toast.success(`Cover generated with ${r.data.model}`);
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Cover generation failed");
    } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 rounded-xl p-3 flex items-center gap-3"
      style={{ border: "1px solid rgba(244,167,59,0.35)", background: "rgba(244,167,59,0.05)" }}
      data-testid="game-cover-tool">
      <div className="w-16 shrink-0"><GameCover game={g} aspect="4/5" className="rounded-lg" /></div>
      <div className="flex-1 min-w-0">
        <b className="text-[11px] uppercase tracking-widest" style={{ color: "#F4A73B" }}>Game Cover</b>
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {g.cover_url ? "Regenerate with ORAi if you want a fresh look." : "No cover yet — let ORAi create one from the game's title and description."}
        </div>
      </div>
      <button className="or-btn text-xs font-bold shrink-0" style={{ background: "#F4A73B", color: "#0a0a0a" }}
        disabled={busy} onClick={generate} data-testid="generate-cover-btn">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} {busy ? "Generating…" : g.cover_url ? "Regenerate Cover" : "Generate Cover"}
      </button>
    </div>
  );
};
