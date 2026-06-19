/**
 * CommunityMembersPanel — right-side member list with realtime presence.
 *
 *   • Avatar + username + (status-coloured pulse dot ONLY on the bottom-
 *     right of the profile image, per product spec — no other dots).
 *   • Search by name.
 *   • Sort by presence priority (online → messenger → live → away → offline)
 *     then alphabetical.
 *   • Click → contextual menu (Friend / Chat / Cancel) handled by parent
 *     via the `onMemberClick(member)` callback.
 *
 * Presence is overlaid client-side from the existing /api/presence/state
 * snapshot — the backend already returns `is_online` per member, which
 * keeps this component network-light.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Search, Users, Loader2 } from "lucide-react";
import apiClient from "@/api/client";

const ORDER = { live: 0, online: 1, messenger: 2, away: 3, offline: 4 };

export default function CommunityMembersPanel({
  communityType,
  communityId,
  onMemberClick,
}) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("presence"); // presence | alpha

  const load = async () => {
    if (!communityId) return;
    setLoading(true); setErr("");
    try {
      const { data } = await apiClient.get(
        `/communities/${communityType}/${communityId}/members`,
        { params: { limit: 100 } },
      );
      setMembers(data.members || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load members");
    } finally { setLoading(false); }
  };

  // Refresh every 20s so presence stays roughly live without a dedicated WS.
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [communityType, communityId]);

  const sorted = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = members;
    if (ql) {
      out = out.filter((m) =>
        (m.username || "").toLowerCase().includes(ql) ||
        (m.display_name || "").toLowerCase().includes(ql),
      );
    }
    out = [...out];
    if (sortKey === "alpha") {
      out.sort((a, b) => (a.username || "").localeCompare(b.username || ""));
    } else {
      out.sort((a, b) => {
        const sa = ORDER[statusOf(a)] ?? 9;
        const sb = ORDER[statusOf(b)] ?? 9;
        if (sa !== sb) return sa - sb;
        return (a.username || "").localeCompare(b.username || "");
      });
    }
    return out;
  }, [members, q, sortKey]);

  const onlineCount = members.filter((m) => m.is_online).length;

  return (
    <aside className="or-surface overflow-hidden flex flex-col" style={{ minHeight: 520, maxHeight: "calc(100dvh - 280px)" }} data-testid="community-members-panel">
      <header className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor: "var(--border-col)" }}>
        <Users size={14} style={{ color: "var(--brand-green)" }} />
        <h3 className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>People</h3>
        <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--brand-green)" }}>{onlineCount}</span> online · {members.length}
        </span>
      </header>
      <div className="px-3 py-2 flex items-center gap-1.5">
        <div className="flex-1 relative">
          <Search size={12} style={{ position: "absolute", left: 8, top: 8, color: "var(--text-muted)" }} />
          <input
            className="or-input text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            style={{ paddingLeft: 26, height: 28 }}
            data-testid="community-members-search"
          />
        </div>
        <button
          className="or-chip text-[10px]"
          data-active={sortKey === "presence"}
          onClick={() => setSortKey("presence")}
          data-testid="community-members-sort-presence"
        >Online</button>
        <button
          className="or-chip text-[10px]"
          data-active={sortKey === "alpha"}
          onClick={() => setSortKey("alpha")}
          data-testid="community-members-sort-alpha"
        >A-Z</button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2" data-testid="community-members-list">
        {loading ? (
          <div className="text-center py-6" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="inline animate-spin" /></div>
        ) : err ? (
          <div className="text-sm text-center py-6" style={{ color: "#ff8080" }}>{err}</div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }} data-testid="community-members-empty">
            {q ? "No matching members." : "No members yet."}
          </div>
        ) : sorted.map((m) => (
          <MemberRow key={m.user_id} member={m} onClick={() => onMemberClick && onMemberClick(m)} />
        ))}
      </div>
    </aside>
  );
}

function statusOf(m) {
  if (!m.is_online) return "offline";
  return (m.presence_choice || "online").toLowerCase();
}

function MemberRow({ member, onClick }) {
  const s = statusOf(member);
  const colour = {
    online:    "var(--brand-green)",
    messenger: "#2EA0FF",
    live:      "#FF3F5A",
    away:      "#F4C84A",
    offline:   "transparent",
  }[s];
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left"
      style={{ background: "transparent" }}
      data-testid={`community-member-${member.username || member.user_id}`}
      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--primary) 8%, transparent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div className="relative shrink-0">
        <img src={member.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full" style={{ width: 26, height: 26 }} />
        {s !== "offline" && (
          <span
            aria-label={`Status: ${s}`}
            data-testid={`community-member-status-${member.username}-${s}`}
            style={{
              position: "absolute", right: -1, bottom: -1, width: 9, height: 9,
              borderRadius: "50%", background: colour,
              border: "2px solid var(--surface)",
              animation: "or-pulse-soft 3s ease-out infinite",
              "--orp-color": colour,
            }}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{member.display_name || member.username}</div>
        <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{member.username || "—"}</div>
      </div>
      {member.role && member.role !== "member" && (
        <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--primary)" }}>{member.role}</span>
      )}
    </button>
  );
}
