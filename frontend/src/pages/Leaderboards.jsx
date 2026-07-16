/**
 * /leaderboards — public rankings. Backend-computed, real members only.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Crown, Loader2, RefreshCw, Search, Trophy } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";

const CATS = [
  ["reputation", "Reputation"], ["level", "Level"], ["achievements", "Achievements"],
  ["posts", "Posts"], ["likes", "Likes"], ["comments", "Comments"],
  ["followers", "Followers"], ["realms", "Realms"],
  ["weekly_activity", "Weekly Activity"], ["alltime_activity", "All-Time Activity"],
];
const PERIODS = [["all", "All Time"], ["month", "This Month"], ["week", "This Week"], ["today", "Today"]];
const AUDIENCES = [["global", "Global"], ["friends", "Friends"], ["realm", "My Realm"]];

export default function Leaderboards() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [category, setCategory] = useState("reputation");
  const [period, setPeriod] = useState("all");
  const [audience, setAudience] = useState("global");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await apiClient.get("/leaderboards", { params: { category, period, audience, q: q || undefined, page } });
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not load leaderboard.");
    } finally { setLoading(false); }
  }, [category, period, audience, q, page]);

  useEffect(() => { load(); }, [load]);

  const scoreLabel = category === "level"
    ? (r) => `${r.level_name || "—"}${r.level_number ? ` (L${r.level_number})` : ""}`
    : (r) => r.score.toLocaleString();

  return (
    <div className="max-w-3xl mx-auto pb-8" data-testid="leaderboards-page">
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <Trophy size={26} style={{ color: "var(--primary)" }} />
        <h1 className="text-3xl flex-1" style={{ fontFamily: "var(--font-display)" }}>Leaderboards</h1>
        <button className="or-chip" onClick={load} aria-label="Refresh" data-testid="leaderboard-refresh"><RefreshCw size={12} /> Refresh</button>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        Rankings count real members and valid activity only — synthetic, deleted, and moderated content is excluded.
        {data?.updated_at && <> Last updated {new Date(data.updated_at).toLocaleTimeString()}.</>}
      </p>

      {data?.me && (
        <div className="or-surface p-3 mb-3 flex items-center gap-3" data-testid="leaderboard-my-rank">
          <Crown size={16} style={{ color: "var(--primary)" }} />
          <span className="text-sm">Your rank: <b>#{data.me.display_rank}</b> of {data.total} — {scoreLabel(data.me)}
            {data.me.hidden && <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>(private — you are hidden from public rankings)</span>}
          </span>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2" data-testid="leaderboard-categories">
        {CATS.map(([k, label]) => (
          <button key={k} className="or-chip shrink-0" data-active={category === k}
            onClick={() => { setCategory(k); setPage(1); }} data-testid={`leaderboard-cat-${k}`}>{label}</button>
        ))}
      </div>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {AUDIENCES.map(([k, label]) => (
          <button key={k} className="or-chip" data-active={audience === k}
            onClick={() => { setAudience(k); setPage(1); }} data-testid={`leaderboard-aud-${k}`}>{label}</button>
        ))}
        <span className="mx-1" />
        {PERIODS.map(([k, label]) => (
          <button key={k} className="or-chip" data-active={period === k}
            onClick={() => { setPeriod(k); setPage(1); }} data-testid={`leaderboard-period-${k}`}>{label}</button>
        ))}
      </div>
      <div className="relative mb-3">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
        <input className="or-input pl-8" placeholder="Search users…" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="leaderboard-search" />
      </div>

      {loading ? (
        <div className="or-surface p-8 flex justify-center" data-testid="leaderboard-loading"><Loader2 className="animate-spin" style={{ color: "var(--primary)" }} /></div>
      ) : err ? (
        <div className="or-surface p-6 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="leaderboard-error">{err}</div>
      ) : (data?.rows || []).length === 0 ? (
        <div className="or-surface p-6 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="leaderboard-empty">No ranked users for this filter yet.</div>
      ) : (
        <div className="space-y-1.5" data-testid="leaderboard-rows">
          {data.rows.map((r) => {
            const isMe = r.user_id === user?.id;
            const top3 = r.display_rank <= 3 && data.settings?.top3_highlight;
            return (
              <button key={r.user_id} type="button"
                onClick={() => navigate(`/profile/${r.username}`)}
                className="w-full or-surface p-2.5 flex items-center gap-3 text-left"
                style={{
                  border: isMe ? "1.5px solid var(--primary)" : undefined,
                  background: top3 ? "color-mix(in srgb, var(--primary) 8%, var(--surface-1, transparent))" : undefined,
                }}
                data-testid={`leaderboard-row-${r.username}`}>
                <span className="w-8 text-center font-bold" style={{ color: top3 ? "var(--primary)" : "var(--text-muted)" }}>
                  {r.display_rank <= 3 ? ["🥇", "🥈", "🥉"][r.display_rank - 1] : `#${r.display_rank}`}
                </span>
                <UserAvatar user={{ username: r.username, name: r.name, avatar_url: r.avatar_url }} size={34} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>
                    {r.name || r.username}{isMe && <span className="text-[10px] ml-1.5" style={{ color: "var(--primary)" }}>(you)</span>}
                  </span>
                  <span className="block text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    @{r.username}
                    {r.level_name && (
                      <span className="ml-1.5 px-1.5 py-px rounded-full text-[10px]"
                        style={{ border: `1px solid ${r.level_accent || "var(--primary)"}`, color: r.level_accent || "var(--primary)" }}>
                        {r.level_name}
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-sm font-bold shrink-0" style={{ color: "var(--text-main)" }}>{scoreLabel(r)}</span>
              </button>
            );
          })}
        </div>
      )}

      {data && data.total > data.page_size && (
        <div className="flex justify-center gap-2 mt-4">
          <button className="or-chip" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="leaderboard-prev">Prev</button>
          <span className="text-xs self-center" style={{ color: "var(--text-muted)" }}>Page {page} / {Math.ceil(data.total / data.page_size)}</span>
          <button className="or-chip" disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage(page + 1)} data-testid="leaderboard-next">Next</button>
        </div>
      )}
    </div>
  );
}
