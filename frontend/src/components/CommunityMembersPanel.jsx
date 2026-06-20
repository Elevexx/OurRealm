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
import { Search, Users, Loader2, UserPlus, UserMinus, X } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const ORDER = { live: 0, online: 1, messenger: 2, away: 3, offline: 4 };

export default function CommunityMembersPanel({
  communityType,
  communityId,
  onMemberClick,
}) {
  const { user } = useAuth();
  const isFounder = (user?.username || "").toLowerCase() === "stealth";
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("presence"); // presence | alpha
  const [showAdd, setShowAdd] = useState(false);

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

  const onRemove = async (member) => {
    if (!isFounder) return;
    if (!window.confirm(`Remove @${member.username} from this ${communityType}?`)) return;
    try {
      await apiClient.delete(
        `/communities/${communityType}/${communityId}/members/${member.user_id}`,
      );
      setMembers((s) => s.filter((m) => m.user_id !== member.user_id));
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Remove failed");
    }
  };

  const onAdded = (added) => {
    setShowAdd(false);
    // Refresh from server to pick up presence/role columns.
    load();
    void added;
  };

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
        {isFounder && (
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="or-chip"
            data-active={showAdd}
            data-testid="community-members-founder-add-toggle"
            title="Add member (founder)"
            style={{ marginLeft: 4 }}
          >
            <UserPlus size={11} />
          </button>
        )}
      </header>
      {isFounder && showAdd && (
        <FounderAddMemberForm
          communityType={communityType}
          communityId={communityId}
          onClose={() => setShowAdd(false)}
          onAdded={onAdded}
        />
      )}
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
          <MemberRow
            key={m.user_id}
            member={m}
            isSelf={!!user && m.user_id === user.id}
            canRemove={isFounder && (!user || m.user_id !== user.id) && !m.is_protected && !m.is_system}
            onClick={() => onMemberClick && onMemberClick(m)}
            onRemove={() => onRemove(m)}
          />
        ))}
      </div>
    </aside>
  );
}

function statusOf(m) {
  if (!m.is_online) return "offline";
  return (m.presence_choice || "online").toLowerCase();
}

function MemberRow({ member, isSelf, canRemove, onClick, onRemove }) {
  const s = statusOf(member);
  const colour = {
    online:    "var(--brand-green)",
    messenger: "#2EA0FF",
    live:      "#FF3F5A",
    away:      "#F4C84A",
    offline:   "transparent",
  }[s];
  // Self-row is rendered as a static badge so automation can deterministically
  // skip it AND so clicking your own avatar doesn't open the action sheet.
  if (isSelf) {
    return (
      <div
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left"
        style={{ background: "color-mix(in srgb, var(--primary) 4%, transparent)" }}
        data-testid="community-member-self"
      >
        <div className="relative shrink-0">
          <img src={member.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full" style={{ width: 26, height: 26 }} />
          {s !== "offline" && (
            <span
              aria-label={`Status: ${s}`}
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
          <div className="text-[10px] truncate" style={{ color: "var(--primary)" }}>You</div>
        </div>
      </div>
    );
  }
  return (
    <div
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--primary) 8%, transparent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <button
        onClick={onClick}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
        data-testid={`community-member-${member.username || member.user_id}`}
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
      {canRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove && onRemove(); }}
          className="or-chip shrink-0"
          aria-label={`Remove @${member.username}`}
          title="Remove member (founder)"
          data-testid={`community-member-remove-${member.username}`}
          style={{ color: "#FF8080", padding: "0.25rem 0.4rem" }}
        >
          <UserMinus size={11} />
        </button>
      )}
    </div>
  );
}

// ─── Founder-only add-by-username form ──────────────────────────────────
function FounderAddMemberForm({ communityType, communityId, onClose, onAdded }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true); setErr("");
      try {
        const { data } = await apiClient.get("/admin/users/search", { params: { q, limit: 8 } });
        if (!cancelled) setResults(data?.users || []);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.detail || "Search failed");
      } finally { if (!cancelled) setSearching(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const add = async (username) => {
    if (!username || submitting) return;
    setSubmitting(true); setErr("");
    try {
      const { data } = await apiClient.post(
        `/communities/${communityType}/${communityId}/members/add`,
        { username },
      );
      onAdded && onAdded(data);
      setQuery("");
      setResults([]);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Add failed");
    } finally { setSubmitting(false); }
  };

  return (
    <div
      className="px-3 py-2 border-b"
      style={{ borderColor: "var(--border-col)", background: "color-mix(in srgb, var(--primary) 4%, transparent)" }}
      data-testid="community-members-founder-add-panel"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <UserPlus size={12} style={{ color: "var(--primary)" }} />
        <span className="text-[11px] uppercase tracking-widest" style={{ color: "var(--primary)" }}>Founder · Add member</span>
        <button
          type="button"
          onClick={onClose}
          className="or-chip ml-auto"
          aria-label="Close add member"
          data-testid="community-members-founder-add-close"
        >
          <X size={11} />
        </button>
      </div>
      <div className="relative">
        <Search size={12} style={{ position: "absolute", left: 8, top: 8, color: "var(--text-muted)" }} />
        <input
          className="or-input text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username…"
          style={{ paddingLeft: 26, height: 28 }}
          data-testid="community-members-founder-add-search"
          autoFocus
        />
      </div>
      {err && <div className="text-xs mt-1" style={{ color: "#FF8080" }} data-testid="community-members-founder-add-error">{err}</div>}
      <div className="mt-2" data-testid="community-members-founder-add-results">
        {searching ? (
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={11} className="inline animate-spin" /> Searching…
          </div>
        ) : results.length === 0 ? (
          query.trim().length >= 2 ? (
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>No matches.</div>
          ) : null
        ) : (
          <div className="flex flex-col gap-1">
            {results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => add(u.username)}
                disabled={submitting}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-left"
                style={{ background: "var(--surface-2)" }}
                data-testid={`community-members-founder-add-result-${u.username}`}
              >
                <img src={u.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full" style={{ width: 22, height: 22 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{u.display_name || u.username}</div>
                  <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{u.username}</div>
                </div>
                <span className="or-chip" style={{ padding: "0.2rem 0.5rem" }}><UserPlus size={11} /> Add</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
