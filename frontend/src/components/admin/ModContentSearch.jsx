/**
 * ModContentSearch — Moderation Center "All Content" tab.
 * Platform-wide post search with moderation filters + inline actions.
 */
import React, { useState } from "react";
import { Loader2, Search } from "lucide-react";
import apiClient from "@/api/client";
import ModPostRow from "@/components/admin/ModPostRow";

export default function ModContentSearch({ onOpenCase }) {
  const [q, setQ] = useState("");
  const [username, setUsername] = useState("");
  const [mediaType, setMediaType] = useState("");
  const [status, setStatus] = useState("");
  const [severityMin, setSeverityMin] = useState("");
  const [blurred, setBlurred] = useState(false);
  const [locked, setLocked] = useState(false);
  const [posts, setPosts] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const buildQuery = (skip = 0) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (username.trim()) params.set("username", username.trim());
    if (mediaType) params.set("media_type", mediaType);
    if (status) params.set("status", status);
    if (severityMin) params.set("severity_min", severityMin);
    if (blurred) params.set("blurred", "true");
    if (locked) params.set("locked", "true");
    params.set("skip", String(skip));
    params.set("limit", "25");
    return params.toString();
  };

  const run = async (skip = 0, append = false) => {
    setLoading(true);
    try {
      const r = await apiClient.get(`/admin/moderation/content/search?${buildQuery(skip)}`);
      setTotal(r.data?.total || 0);
      setPosts((prev) => (append ? [...(prev || []), ...(r.data?.posts || [])] : (r.data?.posts || [])));
    } catch { setPosts([]); }
    setLoading(false);
  };

  const sel = { background: "transparent", border: "1px solid var(--border-col)", borderRadius: 8, color: "var(--text-main)", padding: "8px 10px", fontSize: 12 };

  return (
    <div data-testid="mod-content-search">
      <form onSubmit={(e) => { e.preventDefault(); run(0); }} className="or-surface p-3 mb-4 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input style={{ ...sel, flex: 2 }} placeholder="Caption text or post ID…" value={q}
            onChange={(e) => setQ(e.target.value)} data-testid="mod-search-q" />
          <input style={{ ...sel, flex: 1 }} placeholder="@username" value={username}
            onChange={(e) => setUsername(e.target.value)} data-testid="mod-search-username" />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select style={sel} value={mediaType} onChange={(e) => setMediaType(e.target.value)} data-testid="mod-search-type">
            <option value="">Any type</option>
            <option value="thought">Text</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="sound">Sound</option>
          </select>
          <select style={sel} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="mod-search-status">
            <option value="">Any status</option>
            <option value="approved">Approved</option>
            <option value="pending_review">Under review</option>
            <option value="hidden">Hidden</option>
            <option value="rejected">Removed</option>
          </select>
          <select style={sel} value={severityMin} onChange={(e) => setSeverityMin(e.target.value)} data-testid="mod-search-severity">
            <option value="">Any severity</option>
            <option value="1">L1+</option>
            <option value="2">L2+</option>
            <option value="3">L3+</option>
            <option value="4">L4</option>
          </select>
          <label className="or-chip text-[11px] cursor-pointer">
            <input type="checkbox" checked={blurred} onChange={(e) => setBlurred(e.target.checked)} data-testid="mod-search-blurred" /> Blurred
          </label>
          <label className="or-chip text-[11px] cursor-pointer">
            <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} data-testid="mod-search-locked" /> Private review
          </label>
          <button type="submit" className="or-btn ml-auto" data-testid="mod-search-btn">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search
          </button>
        </div>
      </form>

      {posts && (
        <div className="space-y-2" data-testid="mod-search-results">
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{total} matching posts</div>
          {posts.length === 0 ? (
            <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="mod-search-empty">No content matches.</div>
          ) : posts.map((p) => (
            <ModPostRow key={p.id} post={p} source="moderation_center"
              onChanged={() => run(0)} onOpenCase={onOpenCase} />
          ))}
          {posts.length < total && (
            <button className="or-btn or-btn-ghost w-full" onClick={() => run(posts.length, true)} data-testid="mod-search-more">
              Load more ({posts.length}/{total})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
