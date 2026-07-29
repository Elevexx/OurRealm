/**
 * ModUserPanel — Moderation Center "Users" tab.
 * Global user search → moderation profile → 25 most-recent posts with
 * filters + inline moderation actions.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, UserRound, Gavel } from "lucide-react";
import apiClient from "@/api/client";
import ModPostRow from "@/components/admin/ModPostRow";
import EnforceModal from "@/components/admin/EnforceModal";

const POST_FILTERS = ["all", "images", "videos", "sounds", "text", "blurred",
  "under_review", "locked", "hidden", "ai_flagged", "reported"];

const COUNT_LABELS = [
  ["posts", "Posts"], ["removed_posts", "Removed"], ["flagged_posts", "AI flagged"],
  ["locked_posts", "Private review"], ["reports_received", "Reports received"],
  ["reports_made", "Reports made"], ["moderation_actions", "Mod actions"],
];

export default function ModUserPanel({ onOpenCase }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [enforce, setEnforce] = useState(null); // action string

  const search = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setLoading(true); setProfile(null);
    try {
      const r = await apiClient.get(`/admin/moderation/users/search?q=${encodeURIComponent(q.trim())}`);
      setResults(r.data?.users || []);
    } catch { setResults([]); }
    setLoading(false);
  };

  const loadPosts = async (userId, f = filter, skip = 0, append = false) => {
    const r = await apiClient.get(`/admin/moderation/users/${userId}/posts?filter=${f}&skip=${skip}&limit=25`);
    setTotal(r.data?.total || 0);
    setPosts((prev) => (append ? [...prev, ...(r.data?.posts || [])] : (r.data?.posts || [])));
  };

  const openProfile = async (u) => {
    setLoading(true);
    try {
      const r = await apiClient.get(`/admin/moderation/users/${u.id}`);
      setProfile(r.data);
      setFilter("all");
      await loadPosts(u.id, "all", 0);
    } catch { /* toast handled globally */ }
    setLoading(false);
  };

  const switchFilter = async (f) => {
    setFilter(f);
    if (profile) await loadPosts(profile.user.id, f, 0);
  };

  return (
    <div data-testid="mod-user-panel">
      <form onSubmit={search} className="flex gap-2 mb-4">
        <input
          className="flex-1 text-sm px-3 py-2.5"
          style={{ background: "transparent", border: "1px solid var(--border-col)", borderRadius: 8, color: "var(--text-main)" }}
          placeholder="Search username, display name, user ID (partial ok)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="mod-user-search-input"
        />
        <button type="submit" className="or-btn" data-testid="mod-user-search-btn">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </button>
      </form>

      {!profile && results && (
        <div className="space-y-2" data-testid="mod-user-results">
          {results.length === 0 ? (
            <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="mod-user-results-empty">
              No users match "{q}".
            </div>
          ) : results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => openProfile(u)}
              className="or-surface p-3 w-full flex items-center gap-3 text-left"
              data-testid={`mod-user-result-${u.username}`}
            >
              {u.avatar_url ? (
                <img src={u.avatar_url} alt="" className="rounded-full object-cover" style={{ width: 36, height: 36 }} />
              ) : (
                <div className="rounded-full flex items-center justify-center" style={{ width: 36, height: 36, border: "1px solid var(--border-col)" }}>
                  <UserRound size={16} style={{ color: "var(--text-muted)" }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>
                  @{u.username} <span className="font-normal" style={{ color: "var(--text-muted)" }}>{u.name}</span>
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {u.status} · joined {String(u.created_at || "").slice(0, 10)} · {u.admin_role || "member"}
                  {u.email ? ` · ${u.email}` : ""}
                </div>
              </div>
              <div className="text-[10px] text-right" style={{ color: "var(--text-muted)" }}>
                {u.removed_posts} removed · {u.flagged_posts} flagged
                <br />{u.moderation_actions} mod actions
              </div>
            </button>
          ))}
        </div>
      )}

      {profile && (
        <div data-testid="mod-user-profile">
          <button className="or-chip mb-3" onClick={() => setProfile(null)} data-testid="mod-user-back">← Back to results</button>
          <div className="or-surface p-4 mb-3">
            <div className="flex items-center gap-3 mb-3">
              {profile.user.avatar_url ? (
                <img src={profile.user.avatar_url} alt="" className="rounded-full object-cover" style={{ width: 48, height: 48 }} />
              ) : (
                <div className="rounded-full flex items-center justify-center" style={{ width: 48, height: 48, border: "1px solid var(--border-col)" }}>
                  <UserRound size={20} style={{ color: "var(--text-muted)" }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-lg" style={{ fontFamily: "var(--font-display)" }}>@{profile.user.username}</div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {profile.user.name} · {profile.user.status} · joined {String(profile.user.created_at || "").slice(0, 10)}
                  {profile.user.email ? ` · ${profile.user.email}` : ""}
                  {profile.user.copyright_strike_count ? ` · ${profile.user.copyright_strike_count} © strikes` : ""}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="mod-user-counts">
              {COUNT_LABELS.map(([k, label]) => (
                <div key={k} className="p-2" style={{ border: "1px solid var(--border-col)", borderRadius: 8 }}>
                  <div className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</div>
                  <div className="text-lg" style={{ color: "var(--primary)", fontFamily: "var(--font-display)" }}>{profile.counts?.[k] ?? 0}</div>
                </div>
              ))}
            </div>
            {/* Enforcement — Trust & Safety Phase 2 */}
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-col)" }} data-testid="mod-user-enforcement">
              <div className="text-[10px] uppercase tracking-widest mb-1.5 flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                <Gavel size={11} /> Account enforcement
                {(profile.user.account_limits || {}).active && (
                  <span className="or-chip text-[10px]" style={{ color: "#FFA94D", borderColor: "#FFA94D" }} data-testid="mod-user-limited-badge">
                    limited: {(profile.user.account_limits.capabilities || []).join(", ")} until {(profile.user.account_limits.expires_at || "").slice(0, 10)}
                  </span>
                )}
                {profile.user.suspended_until && (
                  <span className="or-chip text-[10px]" style={{ color: "#FF8080", borderColor: "#FF8080" }} data-testid="mod-user-suspended-badge">
                    suspended until {String(profile.user.suspended_until).slice(0, 10)}
                  </span>
                )}
                {(profile.user.reporter_abuse_flags || 0) > 0 && (
                  <span className="or-chip text-[10px]">{profile.user.reporter_abuse_flags} abusive-report flags</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button className="or-chip" style={{ minHeight: 32 }} onClick={() => setEnforce("warn")} data-testid="mod-user-warn">Warn</button>
                {(profile.user.account_limits || {}).active ? (
                  <button className="or-chip" style={{ minHeight: 32 }} onClick={() => setEnforce("unlimit")} data-testid="mod-user-unlimit">Lift limits</button>
                ) : (
                  <button className="or-chip" style={{ minHeight: 32 }} onClick={() => setEnforce("limit")} data-testid="mod-user-limit">Limit</button>
                )}
                {profile.user.suspended_until ? (
                  <button className="or-chip" style={{ minHeight: 32 }} onClick={() => setEnforce("unsuspend")} data-testid="mod-user-unsuspend">Lift suspension</button>
                ) : (
                  <button className="or-chip" style={{ minHeight: 32, color: "#FF8080", borderColor: "rgba(255,80,80,0.4)" }} onClick={() => setEnforce("suspend")} data-testid="mod-user-suspend">Suspend</button>
                )}
              </div>
            </div>
          </div>

          {(profile.history || []).length > 0 && (
            <div className="or-surface p-3 mb-3" data-testid="mod-user-history">
              <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Moderation history</div>
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {profile.history.slice(0, 15).map((h) => (
                  <div key={h.id} className="text-[11px]" style={{ color: "var(--text-main)" }}>
                    <b>{h.action}</b> · {h.content_type} · {String(h.created_at || "").slice(0, 16)}{h.reason ? ` · ${h.reason}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-1.5 flex-wrap mb-3" data-testid="mod-user-post-filters">
            {POST_FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => switchFilter(f)}
                className="or-chip text-[10px]"
                style={filter === f ? { color: "var(--primary)", borderColor: "var(--primary)" } : undefined}
                data-testid={`mod-user-filter-${f}`}>
                {f.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <div className="space-y-2" data-testid="mod-user-posts">
            {posts.length === 0 ? (
              <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="mod-user-posts-empty">
                No posts for this filter.
              </div>
            ) : posts.map((p) => (
              <ModPostRow key={p.id} post={p} source="user_profile"
                onChanged={() => loadPosts(profile.user.id, filter, 0)}
                onOpenCase={onOpenCase} />
            ))}
            {posts.length < total && (
              <button className="or-btn or-btn-ghost w-full" data-testid="mod-user-posts-more"
                onClick={() => loadPosts(profile.user.id, filter, posts.length, true)}>
                Load more ({posts.length}/{total})
              </button>
            )}
          </div>
          {enforce && (
            <EnforceModal
              userId={profile.user.id}
              username={profile.user.username}
              action={enforce}
              onClose={() => setEnforce(null)}
              onDone={(a) => { toast.success(`Done: ${a}`); openProfile(profile.user); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
