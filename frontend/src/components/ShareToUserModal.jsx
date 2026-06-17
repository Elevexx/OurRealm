/**
 * ShareToUserModal — pick a friend, send the post as a DM.
 *
 * The message body carries ONLY `{kind: 'post_share', post_id}` — never
 * a copy of the post. The recipient renders the SAME post document from
 * /api/posts/{id}, so likes/comments/visibility stay consistent everywhere.
 *
 * Reuses /api/friends/list to source candidate recipients (per the
 * existing app rule that only friends are valid DM targets).
 */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Share2, X, Search, Loader2, Check, Send } from "lucide-react";
import apiClient from "@/api/client";
import UserAvatar from "@/components/UserAvatar";

function MiniAvatar({ user }) {
  return <UserAvatar user={user} size={32} />;
}

export default function ShareToUserModal({
  open,
  postId,
  postPreview,    // optional small string used as the message text fallback
  onClose,
  testid = "share-to-user",
}) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(new Set());
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery(""); setSelected(new Set()); setSentTo(new Set()); setErr("");
    setLoading(true);
    apiClient.get("/friends/list")
      .then((r) => setFriends(r.data?.friends || []))
      .catch(() => setErr("Could not load friends"))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) =>
      (f.username || "").toLowerCase().includes(q) ||
      (f.name || "").toLowerCase().includes(q));
  }, [friends, query]);

  if (!open) return null;

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const send = async () => {
    if (selected.size === 0 || !postId) return;
    setSending(true); setErr("");
    const targets = friends.filter((f) => selected.has(f.id));
    const text = postPreview
      ? `Shared a post: ${postPreview.slice(0, 100)}`
      : "Shared a post";
    const succeeded = new Set();
    for (const f of targets) {
      try {
        await apiClient.post("/messages", {
          to_username: f.username,
          text,
          media: { kind: "post_share", post_id: postId },
        });
        succeeded.add(f.id);
      } catch (e) {
        // Continue with the rest. We surface the last error only.
        setErr(e?.response?.data?.detail || "Some shares failed");
      }
    }
    setSentTo((prev) => new Set([...prev, ...succeeded]));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of succeeded) next.delete(id);
      return next;
    });
    setSending(false);
    // Auto-close if everything went through and nothing remains selected.
    if (succeeded.size === targets.length) setTimeout(() => onClose?.(), 1500);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[230] flex items-end sm:items-center justify-center px-2 sm:px-4 py-4 sm:py-10"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      onClick={() => !sending && onClose?.()}
      data-testid={`${testid}-overlay`}
    >
      <div
        className="or-surface w-full sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
        role="dialog" aria-modal="true"
      >
        <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid var(--border-col)" }}>
          <div className="flex items-center gap-2">
            <Share2 size={16} style={{ color: "var(--primary)" }} />
            <h3 className="text-base" style={{ fontFamily: "var(--font-display)" }}>Share with…</h3>
          </div>
          <button
            onClick={onClose} className="starbar-icon"
            style={{ width: 32, height: 32 }} aria-label="Close"
            data-testid={`${testid}-close`}
          ><X size={14} /></button>
        </div>

        <div className="p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
          <div className="flex items-center gap-2 or-input" style={{ padding: "0.45rem 0.7rem" }}>
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search friends…"
              className="bg-transparent outline-none flex-1 text-sm"
              data-testid={`${testid}-search`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2" data-testid={`${testid}-list`}>
          {loading ? (
            <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-center py-8" style={{ color: "var(--text-muted)" }} data-testid={`${testid}-empty`}>
              {friends.length === 0 ? "Add friends to share posts." : "No friends match that search."}
            </div>
          ) : (
            <ul>
              {filtered.map((f) => {
                const isSelected = selected.has(f.id);
                const wasSent = sentTo.has(f.id);
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 p-2.5 cursor-pointer"
                    style={{
                      borderRadius: "var(--radius)",
                      background: isSelected ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent",
                    }}
                    onClick={() => !wasSent && toggle(f.id)}
                    data-testid={`${testid}-friend-${f.username}`}
                  >
                    <MiniAvatar user={f} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>
                        {f.name || f.username}
                      </div>
                      <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                        @{f.username}
                      </div>
                    </div>
                    {wasSent ? (
                      <span
                        className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1"
                        style={{ color: "var(--primary)", background: "color-mix(in srgb, var(--primary) 18%, transparent)" }}
                        data-testid={`${testid}-sent-${f.username}`}
                      ><Check size={10} /> Sent</span>
                    ) : (
                      <span
                        className="rounded-full"
                        style={{
                          width: 18, height: 18,
                          border: `2px solid ${isSelected ? "var(--primary)" : "var(--border-col)"}`,
                          background: isSelected ? "var(--primary)" : "transparent",
                        }}
                        aria-hidden="true"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 p-3"
          style={{ borderTop: "1px solid var(--border-col)" }}
        >
          {err && <div className="text-[11px] flex-1 truncate" style={{ color: "#FF8080" }} data-testid={`${testid}-error`}>{err}</div>}
          <button
            onClick={onClose}
            disabled={sending}
            className="or-btn or-btn-ghost"
            data-testid={`${testid}-cancel`}
          >Cancel</button>
          <button
            onClick={send}
            disabled={sending || selected.size === 0}
            className="or-btn"
            data-testid={`${testid}-submit`}
          >
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Share ({selected.size})
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
