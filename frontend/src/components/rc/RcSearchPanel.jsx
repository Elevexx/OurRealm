import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import apiClient from "@/api/client";

const TYPE_COLORS = { center: "#F4C84A", item: "#5AB2FF", event: "#C26BFF", unit: "#7BD88F", member: "#FF8A5A" };

// Bundle G — ONE permission-aware search. centerId="" = across my Centers.
export const RcSearchPanel = ({ centerId = "" }) => {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const url = centerId
          ? `/responsibility-center/${centerId}/search`
          : "/responsibility-center/search";
        const r = await apiClient.get(url, { params: { q } });
        setResults(r.data.results);
        setOpen(true);
      } catch (e) { setResults([]); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q, centerId]);

  return (
    <div className="relative" data-testid="rc-search-panel">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
        <input className="or-input w-full pl-8 pr-8" value={q} onChange={(e) => setQ(e.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder={centerId ? "Search this Center…" : "Search my Centers, work, events, groups…"}
          data-testid="rc-search-input" aria-label="Search Responsibility Centers" />
        {q && <button className="absolute right-2.5 top-2.5" onClick={() => { setQ(""); setOpen(false); }} aria-label="Clear search" data-testid="rc-search-clear"><X size={13} /></button>}
      </div>
      {open && results !== null && (
        <div className="absolute z-40 left-0 right-0 mt-1 or-surface p-2 max-h-80 overflow-y-auto" data-testid="rc-search-results">
          {!results.length && <div className="text-xs p-2" style={{ color: "var(--text-muted)" }} data-testid="rc-search-empty">No matches you have access to.</div>}
          {results.map((r) => (
            <button key={`${r.type}-${r.id}`} className="w-full text-left flex items-center gap-2 p-1.5 rounded hover:bg-white/5"
              onClick={() => { setOpen(false); navigate(r.link); }} data-testid={`rc-search-result-${r.type}-${r.id}`}>
              <span className="text-[9px] uppercase font-bold w-12 shrink-0" style={{ color: TYPE_COLORS[r.type] || "#9AA7BD" }}>{r.type}</span>
              <span className="min-w-0 flex-1">
                <span className="text-sm block truncate">{r.title}</span>
                <span className="text-[10px] block truncate" style={{ color: "var(--text-muted)" }}>
                  {r.center_name}{r.status ? ` · ${String(r.status).replace(/_/g, " ")}` : ""}{r.due_at ? ` · ${new Date(r.due_at).toLocaleDateString()}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
