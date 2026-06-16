/**
 * PollDisplay — renders a poll attached to a feed post.
 * Vote / change-vote / view results. Polls every 8s for live updates
 * while the poll is open. Tries WebSocket-style realtime later — for
 * now lightweight HTTP polling per the Phase 4B spec.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, CheckCircle2, Lock } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

function expiryLabel(iso, expired) {
  if (!iso) return "Open · no expiration";
  if (expired) return "Closed";
  try {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return "Closed";
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m left`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h left`;
    return `${Math.floor(h / 24)}d left`;
  } catch { return ""; }
}

export default function PollDisplay({ post, onChange }) {
  const { user } = useAuth();
  const [poll, setPoll] = useState(post.poll);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(poll);
  pollRef.current = poll;

  // Live refresh every 8s while open (not expired).
  useEffect(() => {
    if (!post?.id) return;
    if (pollRef.current?.expired) return;
    const tick = async () => {
      try {
        const { data } = await apiClient.get(`/posts/${post.id}`, {
          params: { viewer: user?.username || undefined },
        });
        if (data?.post?.poll) {
          setPoll(data.post.poll);
          if (data.post.poll.expired) return;     // stop polling
        }
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, 8000);
    return () => clearInterval(id);
  }, [post?.id, user?.username]);

  const submitVote = useCallback(async (optId) => {
    if (!user) return;
    if (poll?.expired) return;
    setBusy(true);
    // optimistic update
    const prev = poll;
    setPoll((p) => {
      if (!p) return p;
      const wasMy = p.my_vote;
      const next = { ...p };
      // Apply local tally adjustment
      next.options = p.options.map((o) => {
        let votes = o.votes;
        if (wasMy === o.id) votes -= 1;
        if (optId === o.id) votes += 1;
        return { ...o, votes };
      });
      const total = (wasMy === optId) ? p.total_votes : p.total_votes + (wasMy ? 0 : 1);
      next.total_votes = total;
      next.options = next.options.map((o) => ({ ...o, percent: total ? Math.round((o.votes / total) * 1000) / 10 : 0 }));
      next.my_vote = optId;
      return next;
    });
    try {
      const { data } = await apiClient.post(`/posts/${post.id}/poll/vote`, { option_id: optId });
      if (data?.poll) {
        setPoll(data.poll);
        onChange?.(data.poll);
      }
    } catch (e) {
      // revert
      setPoll(prev);
    } finally { setBusy(false); }
  }, [poll, post.id, user, onChange]);

  if (!poll) return null;
  const totalVotes = poll.total_votes || 0;
  const showResults = Boolean(poll.my_vote) || poll.expired;
  const expiry = expiryLabel(poll.expires_at, poll.expired);

  return (
    <div
      className="or-surface mt-3 p-3"
      style={{ background: "var(--surface-2)" }}
      data-testid={`poll-${post.id}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2 mb-2">
        <BarChart3 size={14} style={{ color: "var(--primary)", marginTop: 3 }} />
        <div className="flex-1">
          <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{poll.question}</div>
          <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: poll.expired ? "#FF8080" : "var(--text-muted)" }}>
            {poll.expired ? <Lock size={9} style={{ display: "inline" }} /> : null} {expiry} · {totalVotes} vote{totalVotes === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        {poll.options.map((o) => {
          const selected = poll.my_vote === o.id;
          const pct = showResults ? (o.percent ?? 0) : 0;
          return (
            <button
              key={o.id}
              onClick={(e) => { e.stopPropagation(); submitVote(o.id); }}
              disabled={busy || poll.expired}
              className="relative w-full text-left px-3 py-2 transition-colors"
              style={{
                borderRadius: "calc(var(--radius) - 4px)",
                background: "var(--surface)",
                border: `1px solid ${selected ? "var(--brand-green)" : "var(--border-col)"}`,
                opacity: poll.expired ? 0.85 : 1,
                cursor: poll.expired ? "default" : "pointer",
                overflow: "hidden",
              }}
              data-testid={`poll-${post.id}-opt-${o.id}`}
              aria-pressed={selected}
            >
              {showResults && (
                <span
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${pct}%`,
                    background: selected
                      ? "color-mix(in srgb, var(--brand-green) 22%, transparent)"
                      : "color-mix(in srgb, var(--primary) 14%, transparent)",
                    transition: "width 220ms ease",
                  }}
                />
              )}
              <span className="relative flex items-center justify-between gap-2 text-sm" style={{ color: "var(--text-main)" }}>
                <span className="flex items-center gap-1.5 truncate">
                  {selected && <CheckCircle2 size={12} style={{ color: "var(--brand-green)" }} />}
                  {o.text}
                </span>
                {showResults && (
                  <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {pct}% · {o.votes}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {!user && (
        <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
          Sign in to vote.
        </div>
      )}
    </div>
  );
}
