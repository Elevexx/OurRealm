/**
 * FriendMultiPicker — modal that lets the user pick MULTIPLE friends.
 * Used by the Home Dashboard custom-visibility widget setting.
 *
 * Props:
 *   open, onClose
 *   initialSelectedIds : string[]   ids of friends already selected
 *   onConfirm(ids[], users[])       called with final selection
 */
import React, { useEffect, useMemo, useState } from "react";
import { X, Search, Loader2, Check } from "lucide-react";
import apiClient from "@/api/client";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
const abs = (u) => (!u ? "" : (/^https?:\/\//i.test(u) ? u : (u.startsWith("/") ? `${BACKEND}${u}` : u)));

import UserAvatar from "@/components/UserAvatar";

function Avatar({ user, size = 32 }) {
  return <UserAvatar user={user} size={size} className="shrink-0" />;
}

export default function FriendMultiPicker({
  open,
  onClose,
  onConfirm,
  initialSelectedIds = [],
  title = "Choose friends",
  testid = "friend-multi-picker",
}) {
  const [friends, setFriends] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set(initialSelectedIds));

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initialSelectedIds));
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await apiClient.get("/friends/list");
        if (mounted) setFriends(data?.friends || []);
      } catch { if (mounted) setFriends([]); }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return friends;
    return friends.filter((f) =>
      (f.username || "").toLowerCase().includes(term)
      || (f.name || "").toLowerCase().includes(term));
  }, [q, friends]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirm = () => {
    const ids = Array.from(selected);
    const users = friends.filter((f) => selected.has(f.id));
    onConfirm?.(ids, users);
    onClose?.();
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[230] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid={testid}
    >
      <div className="or-surface w-full max-w-md p-4 flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxHeight: "85vh" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
            {title}
            <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
              {selected.size} selected
            </span>
          </h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose} aria-label="Close" data-testid={`${testid}-close`}>
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
            {friends.length === 0 ? "Add some friends first." : "No matches."}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto" data-testid={`${testid}-list`}>
            {filtered.map((f) => {
              const isOn = selected.has(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggle(f.id)}
                  className="w-full flex items-center gap-3 py-2 px-2 text-left"
                  style={{ borderBottom: "1px solid var(--border-col)" }}
                  data-testid={`${testid}-toggle-${f.username}`}
                >
                  <Avatar user={f} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{f.name || f.username}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>@{f.username}</div>
                  </div>
                  <span
                    className="flex items-center justify-center"
                    style={{
                      width: 22, height: 22, borderRadius: 6,
                      background: isOn ? "var(--primary)" : "transparent",
                      color: isOn ? "var(--surface)" : "var(--text-muted)",
                      border: isOn ? "none" : "1px solid var(--border-col)",
                    }}
                  >
                    {isOn ? <Check size={12} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: "1px solid var(--border-col)" }}>
          <button className="or-btn or-btn-ghost" onClick={onClose} data-testid={`${testid}-cancel`}>Cancel</button>
          <button className="or-btn" onClick={confirm} data-testid={`${testid}-confirm`}>Save selection</button>
        </div>
      </div>
    </div>
  );
}
