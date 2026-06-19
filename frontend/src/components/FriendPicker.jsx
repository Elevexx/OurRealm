/**
 * Reusable Friend Picker modal — opens a list of the current user's
 * friends and emits the selected one via `onPick`. Used by the
 * Messenger "New Chat" flow and by the "Share to Chat" action on
 * sounds/posts.
 *
 * Self-contained: fetches /friends/list internally on open.
 */
import React, { useEffect, useMemo, useState } from "react";
import { X, Search, Loader2 } from "lucide-react";
import apiClient from "@/api/client";
import UserAvatar from "@/components/UserAvatar";

function Avatar({ user, size = 36 }) {
  return <UserAvatar user={user} size={size} />;
}

export default function FriendPicker({
  open,
  onClose,
  onPick,
  title = "Pick a friend",
  emptyHelp = "Add some friends first.",
  testid = "friend-picker",
}) {
  const [friends, setFriends] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await apiClient.get("/friends/list");
        if (!mounted) return;
        setFriends(data.friends || data || []);
      } catch {
        if (mounted) setFriends([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return friends;
    return friends.filter((f) =>
      (f.username || "").toLowerCase().includes(term)
      || (f.name || "").toLowerCase().includes(term)
    );
  }, [q, friends]);

  if (!open) return null;

  return (
    <div
      className="or-modal-shell z-[220]"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid={testid}
    >
      <div
        className="or-surface or-modal-card p-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true"
      >
        <div className="or-modal-header flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>{title}</h3>
          <button
            className="starbar-icon"
            style={{ width: 32, height: 32 }}
            onClick={onClose}
            data-testid={`${testid}-close`}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="or-surface mb-3 p-2.5 flex items-center gap-2" style={{ background: "var(--surface-2)" }}>
          <Search size={16} style={{ color: "var(--text-muted)" }} />
          <input
            autoFocus
            placeholder="Search friends…"
            className="bg-transparent flex-1 outline-none border-none text-sm"
            style={{ color: "var(--text-main)" }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid={`${testid}-search`}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
            {friends.length === 0 ? emptyHelp : "No matches."}
          </div>
        ) : (
          <div className="or-modal-body" data-testid={`${testid}-list`}>
            {filtered.map((f) => (
              <button
                key={f.id}
                onClick={() => onPick?.(f)}
                className="w-full flex items-center gap-3 py-2 px-2 text-left"
                style={{ borderBottom: "1px solid var(--border-col)" }}
                data-testid={`${testid}-pick-${f.username}`}
              >
                <Avatar user={f} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{f.name || f.username}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>@{f.username}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
