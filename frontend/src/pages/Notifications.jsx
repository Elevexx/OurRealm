import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, UserPlus, AtSign, Mail, Share2, Users, Bell, Calendar, Megaphone, Wallet as WalletIcon, Check, CheckCheck, Bookmark } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { NOTIFICATIONS, NOTIFICATION_CATEGORIES } from "@/data/mockData";
import { openPostPopupById } from "@/lib/postPopupController";

const ICONS = {
  like: Heart,
  comment: MessageCircle,
  follow: UserPlus,
  mention: AtSign,
  message: Mail,
  share: Share2,
  save: Bookmark,
  friend_request: Users,
  realm_post: Users,
  realm_join: Users,
  event_reminder: Calendar,
  ad_payout: Megaphone,
  tip: WalletIcon,
};

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cat, setCat] = useState("All");
  const [items, setItems] = useState(NOTIFICATIONS);
  const [serverItems, setServerItems] = useState([]);

  // Load real notifications + mark all as seen as soon as the page opens
  // (this is what clears the red badge in the top bar).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/notifications/list");
        if (!cancelled) setServerItems(data?.notifications || []);
        await apiClient.post("/notifications/mark-seen");
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Merge real + mock and sort by created_at desc (most recent first).
  const merged = useMemo(() => {
    const mapped = serverItems.map((n) => ({
      id: n.id,
      type: n.kind,
      category: n.kind === "friend_request" ? "Friends" :
                n.kind === "message" ? "Messages" :
                n.kind === "like" ? "Likes" :
                n.kind === "comment" ? "Comments" :
                n.kind === "share" ? "Shares" :
                n.kind === "save" ? "Saves" :
                n.kind === "realm_activity" ? "Realms" : "All",
      title: n.kind === "realm_activity"
        ? `${n.payload?.realm_avatar || "🌐"} ${n.payload?.realm_name || "Realm"}`
        : n.actor_username ? `@${n.actor_username}` : "Someone",
      actor: n.actor_username || "someone",
      body: n.kind === "realm_activity"
        ? `${n.payload?.unread_count || 0} new activity${(n.payload?.unread_count || 0) === 1 ? "" : ""}`
        : n.payload?.preview || "",
      unread: !n.seen,
      created_at: n.updated_at || n.created_at,
      // Phase-1 deep-link payload — kept on each item so onSelect() can route.
      post_id: n.payload?.post_id || null,
      actor_username: n.actor_username || null,
      // Realm-activity payload — preserved verbatim so onSelect() can
      // navigate directly to /realms/{slug-or-id}.
      payload: n.payload || null,
      realm_id: n.realm_id || n.payload?.realm_id || null,
      is_server: true,
    }));
    const all = [...mapped, ...items];
    all.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return all;
  }, [serverItems, items]);

  const unreadCount = merged.filter((n) => n.unread).length;

  const filtered = useMemo(
    () => cat === "All" ? merged : merged.filter((n) => n.category === cat),
    [cat, merged]
  );

  const markAllRead = () => setItems((arr) => arr.map((n) => ({ ...n, unread: false })));
  const markOne = (id) => setItems((arr) => arr.map((n) => n.id === id ? { ...n, unread: false } : n));

  /**
   * Phase-1 deep linking — tapping a notification routes to the most
   * useful surface for its kind. Mock items still get the same routing
   * affordances where the data allows it (e.g. friend_request → /friends).
   */
  const onSelect = (n) => {
    if (n.unread) markOne(n.id);
    switch (n.type) {
      case "message":
        navigate(n.actor_username ? `/messages?user=${n.actor_username}` : "/messages");
        return;
      case "friend_request":
        navigate("/friends");
        return;
      case "like":
      case "comment":
      case "share":
      case "save":
      case "mention":
        if (n.post_id) { openPostPopupById(n.post_id); return; }
        navigate("/feed");
        return;
      case "follow":
        if (n.actor_username) navigate(`/public/${n.actor_username}`);
        return;
      case "realm_activity": {
        // Spec: tap → open that specific realm. Prefer the slug for a
        // clean URL; fall back to id. The clear endpoint is fired by
        // RealmDetail's own mount effect once we land there.
        const target = n.payload?.realm_slug || n.payload?.realm_id || n.realm_id;
        if (target) navigate(`/realms/${target}`);
        else navigate("/realms");
        return;
      }
      default:
        return;
    }
  };

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
              role="button"
              tabIndex={0}
              onClick={() => onSelect(n)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(n); } }}
              className="or-surface p-4 flex items-center gap-3 cursor-pointer"
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
                <button onClick={(e) => { e.stopPropagation(); markOne(n.id); }} className="or-chip" style={{ padding: "0.2rem 0.5rem", fontSize: 11 }} data-testid={`notification-read-${n.id}`}>
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
