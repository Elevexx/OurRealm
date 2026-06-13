import React, { useState } from "react";
import { UserPlus, MessageCircle, UserCheck, Search } from "lucide-react";
import { FRIENDS } from "@/data/mockData";
import { useNavigate } from "react-router-dom";

const TABS = [
  { id: "friends", label: "Friends" },
  { id: "followers", label: "Followers" },
  { id: "following", label: "Following" },
];

export default function Friends() {
  const [tab, setTab] = useState("friends");
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const filtered = FRIENDS.filter((f) => f.handle.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="max-w-5xl mx-auto" data-testid="friends-page">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Your network</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Friends</h1>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="or-chip"
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
            data-testid={`friends-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="or-surface p-3 mb-5 flex items-center gap-2">
        <Search size={16} style={{ color: "var(--text-muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by handle…"
          className="bg-transparent border-none outline-none flex-1 text-sm"
          style={{ color: "var(--text-main)" }}
          data-testid="friends-search"
        />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((f) => (
          <div key={f.id} className="or-surface p-5 flex flex-col items-center text-center" data-testid={`friend-card-${f.id}`}>
            <div className="relative">
              <img src={f.avatar} alt="" className="rounded-full object-cover" style={{ width: 84, height: 84, border: "2px solid var(--border-col)" }} />
              {f.is_online && (
                <span className="absolute bottom-1 right-1 w-3 h-3 rounded-full" style={{ background: "#10E670", border: "2px solid var(--surface)" }} />
              )}
            </div>
            <div className="mt-3 font-semibold" style={{ color: "var(--text-main)" }}>@{f.handle}</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{f.mutuals} mutual friends</div>
            <div className="mt-3 flex gap-2 w-full">
              <button className="or-btn flex-1" style={{ padding: "0.45rem", fontSize: "0.8rem" }} data-testid={`friend-message-${f.id}`}
                onClick={() => navigate("/messages")}>
                <MessageCircle size={14} /> Message
              </button>
              <button className="or-btn or-btn-ghost flex-1" style={{ padding: "0.45rem", fontSize: "0.8rem" }} data-testid={`friend-follow-${f.id}`}>
                {tab === "following" ? <><UserCheck size={14} /> Following</> : <><UserPlus size={14} /> Follow</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
