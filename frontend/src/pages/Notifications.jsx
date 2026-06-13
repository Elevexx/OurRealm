import React, { useMemo, useState } from "react";
import { Heart, MessageCircle, UserPlus, AtSign, Mail, Share2, Users, Bell, Calendar, Megaphone, Wallet as WalletIcon, Check, CheckCheck } from "lucide-react";
import { NOTIFICATIONS, NOTIFICATION_CATEGORIES } from "@/data/mockData";

const ICONS = {
  like: Heart,
  comment: MessageCircle,
  follow: UserPlus,
  mention: AtSign,
  message: Mail,
  share: Share2,
  friend_request: Users,
  realm_post: Users,
  realm_join: Users,
  event_reminder: Calendar,
  ad_payout: Megaphone,
  tip: WalletIcon,
};

export default function Notifications() {
  const [cat, setCat] = useState("All");
  const [items, setItems] = useState(NOTIFICATIONS);
  const unreadCount = items.filter((n) => n.unread).length;

  const filtered = useMemo(
    () => cat === "All" ? items : items.filter((n) => n.category === cat),
    [cat, items]
  );

  const markAllRead = () => setItems((arr) => arr.map((n) => ({ ...n, unread: false })));
  const markOne = (id) => setItems((arr) => arr.map((n) => n.id === id ? { ...n, unread: false } : n));

  return (
    <div className="max-w-3xl mx-auto" data-testid="notifications-page">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Recent</div>
          <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
            <Bell size={28} style={{ color: "var(--primary)" }} />
            Notifications
            {unreadCount > 0 && (
              <span className="text-sm font-bold rounded-full px-2 py-0.5" style={{ background: "#FF3344", color: "#fff" }}>{unreadCount}</span>
            )}
          </h1>
        </div>
        <button
          className="or-chip"
          onClick={markAllRead}
          disabled={unreadCount === 0}
          style={{ opacity: unreadCount === 0 ? 0.5 : 1 }}
          data-testid="notifications-mark-all-read"
        >
          <CheckCheck size={14} /> Mark all read
        </button>
      </div>

      {/* Category filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar" data-testid="notifications-filter-bar">
        {NOTIFICATION_CATEGORIES.map((c) => {
          const count = c === "All" ? items.length : items.filter((n) => n.category === c).length;
          if (c !== "All" && count === 0) return null;
          return (
            <button
              key={c}
              className="or-chip shrink-0"
              data-active={cat === c}
              onClick={() => setCat(c)}
              data-testid={`notifications-cat-${c.replace(/\s+/g, "-")}`}
            >
              {c} <span style={{ opacity: 0.7 }}>· {count}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }}>
            Nothing in this category yet.
          </div>
        )}
        {filtered.map((n) => {
          const Icon = ICONS[n.type] || Bell;
          return (
            <div
              key={n.id}
              className="or-surface p-4 flex items-center gap-3"
              data-testid={`notification-${n.id}`}
              style={{ outline: n.unread ? "1px solid var(--primary)" : "1px solid transparent" }}
            >
              <div className="p-2 rounded-full" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)" }}>
                <Icon size={18} style={{ color: "var(--primary)" }} />
              </div>
              <div className="flex-1 text-sm" style={{ color: "var(--text-main)" }}>
                <span className="font-semibold">@{n.actor}</span>{" "}
                <span style={{ color: "var(--text-muted)" }}>
                  {n.type === "like" && "liked"}
                  {n.type === "comment" && "commented on"}
                  {n.type === "follow" && "started following you"}
                  {n.type === "mention" && "mentioned you"}
                  {n.type === "message" && "messaged you"}
                  {n.type === "share" && "shared"}
                  {n.type === "friend_request" && "sent a friend request"}
                  {n.type === "realm_post" && "posted in"}
                  {n.type === "realm_join" && "—"}
                  {n.type === "event_reminder" && "—"}
                  {n.type === "ad_payout" && "—"}
                  {n.type === "tip" && "—"}
                </span>
                {n.target && <span> {n.target}</span>}
                <span className="text-[10px] uppercase tracking-widest ml-2 px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}>{n.category}</span>
              </div>
              <div className="text-xs whitespace-nowrap shrink-0" style={{ color: "var(--text-muted)" }}>{n.when}</div>
              {n.unread && (
                <button onClick={() => markOne(n.id)} className="or-chip" style={{ padding: "0.2rem 0.5rem", fontSize: 11 }} data-testid={`notification-read-${n.id}`}>
                  <Check size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
