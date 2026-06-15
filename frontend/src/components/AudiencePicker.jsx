import React, { useEffect, useState } from "react";
import { Globe2, Users as UsersIcon, Lock, UserCheck, X, Check } from "lucide-react";
import apiClient from "@/api/client";

/**
 * AudiencePicker — modal that returns an audience object:
 *   { visibility: "public"|"friends"|"private"|"custom", user_ids: string[] }
 *
 * The data shape is designed to accept a future `friend_group_ids` field
 * without a migration; the picker shows a "Friend Groups — Coming Soon"
 * placeholder so users discover the upcoming feature.
 */
const OPTIONS = [
  { key: "public",  label: "Public",  Icon: Globe2,    desc: "Anyone on OurRealm can see this." },
  { key: "friends", label: "Friends", Icon: UsersIcon, desc: "Only your friends can see this." },
  { key: "private", label: "Private", Icon: Lock,      desc: "Only you can see this." },
  { key: "custom",  label: "Custom",  Icon: UserCheck, desc: "Pick specific friends." },
];

export default function AudiencePicker({ open, value, onChange, onClose }) {
  const [vis, setVis] = useState(value?.visibility || "public");
  const [ids, setIds] = useState(value?.user_ids || []);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVis(value?.visibility || "public");
    setIds(value?.user_ids || []);
  }, [open, value]);

  useEffect(() => {
    if (!open || vis !== "custom") return;
    setLoading(true);
    (async () => {
      try {
        const { data } = await apiClient.get("/friends/list");
        setFriends(data.friends || []);
      } catch { setFriends([]); }
      finally { setLoading(false); }
    })();
  }, [open, vis]);

  if (!open) return null;

  const toggleId = (id) => {
    setIds((arr) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  };

  const apply = () => {
    onChange({
      visibility: vis,
      user_ids: vis === "custom" ? ids : [],
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center px-3 pb-24 sm:pb-0"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid="audience-picker"
    >
      <div className="or-surface w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid var(--border-col)" }}>
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Who can see this?</h3>
          <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={onClose} data-testid="audience-close">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2 overflow-y-auto">
          {OPTIONS.map(({ key, label, Icon, desc }) => (
            <button
              key={key}
              onClick={() => setVis(key)}
              className="or-surface w-full p-3 text-left flex items-center gap-3"
              data-testid={`audience-${key}`}
              style={{
                background: vis === key ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "var(--surface-2)",
                outline: vis === key ? "1px solid var(--primary)" : "none",
              }}
            >
              <Icon size={18} style={{ color: vis === key ? "var(--primary)" : "var(--text-muted)" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{label}</div>
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{desc}</div>
              </div>
              {vis === key && <Check size={16} style={{ color: "var(--primary)" }} />}
            </button>
          ))}

          {vis === "custom" && (
            <div className="mt-3" data-testid="audience-custom-picker">
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
                Select friends
              </div>
              {loading ? (
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>
              ) : friends.length === 0 ? (
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>You have no friends yet — add some first.</div>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {friends.map((f) => {
                    const selected = ids.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        onClick={() => toggleId(f.id)}
                        className="w-full flex items-center gap-3 p-2 text-left"
                        data-testid={`audience-friend-${f.username}`}
                        style={{
                          background: selected ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent",
                          borderRadius: "var(--radius)",
                          border: selected ? "1px solid var(--primary)" : "1px solid transparent",
                        }}
                      >
                        <img
                          src={f.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(f.name || f.username)}`}
                          alt=""
                          className="rounded-full"
                          style={{ width: 32, height: 32 }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate" style={{ color: "var(--text-main)" }}>@{f.username}</div>
                          <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{f.name}</div>
                        </div>
                        {selected && <Check size={14} style={{ color: "var(--primary)" }} />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Reserved slot for the future Friend Groups feature */}
              <div className="mt-3 p-3 or-surface" style={{ background: "var(--surface-2)", borderStyle: "dashed" }} data-testid="audience-friend-groups-soon">
                <div className="text-xs font-semibold flex items-center gap-2" style={{ color: "var(--text-main)" }}>
                  <UsersIcon size={12} /> Friend Groups
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Coming soon — create curated audiences for music drops, close friends, work, and more.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-3 flex gap-2" style={{ borderTop: "1px solid var(--border-col)" }}>
          <button className="or-btn flex-1" onClick={apply} data-testid="audience-apply">Apply</button>
          <button className="or-btn or-btn-ghost" onClick={onClose} data-testid="audience-cancel">Cancel</button>
        </div>
      </div>
    </div>
  );
}
