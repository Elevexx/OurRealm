import React, { useMemo, useState } from "react";
import { ChevronDown, Play } from "lucide-react";

/* Continue Playing — closed-by-default accessible dropdown shared by the
   member and public /games hubs. Dedupes by game, sorts by last played. */
export const ContinuePlaying = ({ items, onOpen, accent = "#10E670" }) => {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    const map = new Map();
    for (const p of items || []) {
      const prev = map.get(p.game_id);
      if (!prev || (p.last_played || "") > (prev.last_played || "")) map.set(p.game_id, p);
    }
    return [...map.values()].sort((a, b) => (b.last_played || "").localeCompare(a.last_played || ""));
  }, [items]);
  if (!rows.length) return null;
  return (
    <div className="mb-4" data-testid="games-continue">
      <button type="button" aria-expanded={open} aria-controls="continue-playing-list"
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: accent, minHeight: 32 }}
        data-testid="games-continue-toggle"
        onClick={() => setOpen(!open)}>
        Continue Playing ({rows.length})
        <ChevronDown size={14} aria-hidden="true"
          className="transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      {open && (
        <div id="continue-playing-list" role="list"
          className="mt-1.5 flex flex-col gap-1 overflow-y-auto pr-1"
          style={{ maxHeight: 224 }} data-testid="games-continue-list">
          {rows.map((p) => (
            <button key={p.game_id} type="button" role="listitem"
              className="flex items-center gap-2 text-left text-[11px] rounded-xl px-3"
              style={{ minHeight: 44, border: "1px solid var(--border-col, rgba(255,255,255,0.14))",
                       background: "rgba(255,255,255,0.04)" }}
              onClick={() => onOpen(p)} data-testid={`games-continue-${p.game_id}`}
              aria-label={`Resume ${p.game_title || "game"}`}>
              <Play size={11} style={{ color: accent, flex: "none" }} aria-hidden="true" />
              <span className="flex-1 truncate">{p.game_title || "Game"}</span>
              {p.best_score != null && (
                <span className="text-[9.5px]" style={{ opacity: 0.65 }}>best {p.best_score}</span>)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
