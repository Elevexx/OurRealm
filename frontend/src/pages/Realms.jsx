import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Crown, Users, Radio } from "lucide-react";
import { REALMS } from "@/data/mockData";

export default function Realms() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const list = REALMS.filter((r) =>
    r.name.toLowerCase().includes(q.toLowerCase()) || r.tags.some((t) => t.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="max-w-7xl mx-auto" data-testid="realms-page">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Community system</div>
          <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
            <Crown size={28} style={{ color: "#F4C84A" }} /> Realms
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Communities inside OurRealm — banners, live streams, posts, widgets, and moderators.
          </p>
        </div>
        <button className="or-btn" data-testid="realms-create"><Plus size={14} /> Create Realm</button>
      </div>

      <div className="or-surface p-3 mb-5 flex items-center gap-2">
        <Search size={16} style={{ color: "var(--text-muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search realms or tags…"
          className="bg-transparent border-none outline-none flex-1 text-sm"
          style={{ color: "var(--text-main)" }}
          data-testid="realms-search"
        />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {list.map((r) => (
          <button
            key={r.id}
            onClick={() => navigate(`/realms/${r.id}`)}
            className="or-surface overflow-hidden text-left"
            data-testid={`realm-card-${r.id}`}
          >
            <div className="relative h-40">
              <img src={r.banner} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 30%, ${r.accent}33 70%, rgba(0,0,0,0.6))` }} />
              <span className="absolute top-3 left-3 text-3xl">{r.emoji}</span>
              <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: "#10E670", color: "#000" }}>● {r.online}</span>
              <div className="absolute bottom-3 left-3 right-3">
                <div className="text-lg font-bold" style={{ color: "#fff" }}>{r.name}</div>
                <div className="text-xs" style={{ color: "#cfe3ff" }}>{r.members.toLocaleString()} members</div>
              </div>
            </div>
            <div className="p-3">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>{r.desc}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {r.tags.map((t) => (
                  <span key={t} className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: `${r.accent}22`, color: r.accent }}>{t}</span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
