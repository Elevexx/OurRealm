import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, UserPlus, AtSign, Mail, Share2, Users, Bell, Calendar, Check, CheckCheck, Bookmark, Flame, ShieldAlert, FolderOpen } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { NOTIFICATION_CATEGORIES } from "@/data/mockData";
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
  fire_collectable: Flame,
  fire_up_complete: Flame,
  fire: Flame,
};

// Defensive client-side filter — server already strips these kinds in
// `/api/notifications/list`. Mirrored here so any stale cache or future
// producer added without re-reading the backend list still gets hidden.
const HIDDEN_KINDS = new Set([
  "marketplace", "marketplace_ad", "marketplace_listing",
  "ads", "ad", "ad_payout", "promoted", "promotion",
  "wallet", "tip", "tipped", "payment", "purchase", "sale",
  "transaction", "balance", "transfer", "deposit", "withdrawal",
]);

export default function Notifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cat, setCat] = useState("All");
  const [modFilter, setModFilter] = useState("all"); // all | urgent | unresolved | resolved
  // Real server notifications only (June 2026 audit — mock rows removed).
  const [items, setItems] = useState([]);
  const [serverItems, setServerItems] = useState([]);

  // Admin-only Moderation tab (mirrors backend moderation-access roles).
  const adminRole = user?.admin_role || ((user?.username || "").toLowerCase() === "stealth" ? "founder" : null);
  const isModAdmin = ["founder", "support_admin", "moderator"].includes(adminRole);

  // Load real notifications + mark all as seen as soon as the page opens
  // (this is what clears the red badge in the top bar). The backend
  // excludes admin_moderation from mark-seen so urgent moderation
  // notifications are never auto-cleared by simply opening the page.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/notifications/list");
        if (!cancelled) {
          const rows = (data?.notifications || [])
            .filter((n) => !HIDDEN_KINDS.has(n.kind));
          setServerItems(rows);
        }
        await apiClient.post("/notifications/mark-seen");
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Moderation notifications stay OUT of the social list — they only
  // render inside the admin-only Moderation tab below.
  const modItems = useMemo(
    () => serverItems.filter((n) => n.kind === "admin_moderation"),
    [serverItems]
  );

  // Merge real + mock and sort by created_at desc (most recent first).
  const merged = useMemo(() => {
    const mapped = serverItems.filter((n) => n.kind !== "admin_moderation").map((n) => ({
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
        : ["fire_collectable", "founding_vip_claimed", "fire_up_complete"].includes(n.kind)
        ? (n.payload?.message || "🔥 You have Fire ready to collect.")
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
  const modUnread = modItems.filter((n) => !n.seen).length;

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
      case "fire":
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
      case "fire_collectable":
      case "fire_up_complete":
        // One-shot deep link: own public profile opens with the Fire
        // widget expanded + highlighted. Flag is consumed on arrival so
        // normal visits stay collapsed.
        try { sessionStorage.setItem("ourrealm.fire.deeplink", "1"); } catch { /* ignore */ }
        navigate(user?.username ? `/profile/${user.username}` : "/feed");
        return;
      default:
        return;
    }
  };

  return (
    <div className="max-w-3xl mx-auto" data-testid="notifications-page">
      {/* Header — stacks on small screens so Mark-All-Read never
          collides with the title row. `flex-wrap` keeps the Bell/title
          and the button on separate visual lines below ~480px. */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Recent</div>
          <h1
            className="text-2xl sm:text-3xl md:text-4xl flex items-center gap-2 sm:gap-3 flex-wrap"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Bell size={24} className="sm:hidden" style={{ color: "var(--primary)" }} />
            <Bell size={28} className="hidden sm:inline" style={{ color: "var(--primary)" }} />
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span
                className="text-xs sm:text-sm font-bold rounded-full px-2 py-0.5"
                style={{ background: "#FF3344", color: "#fff" }}
                data-testid="notifications-unread-count"
              >{unreadCount}</span>
            )}
          </h1>
        </div>
        <button
          className="or-chip shrink-0 self-start sm:self-auto"
          onClick={markAllRead}
          disabled={unreadCount === 0}
          style={{ opacity: unreadCount === 0 ? 0.5 : 1 }}
          data-testid="notifications-mark-all-read"
        >
          <CheckCheck size={14} /> <span className="hidden xs:inline sm:inline">Mark all read</span><span className="xs:hidden sm:hidden">Mark read</span>
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
        {isModAdmin && (
          <button
            className="or-chip shrink-0"
            data-active={cat === "Moderation"}
            onClick={() => setCat("Moderation")}
            style={{ color: cat === "Moderation" ? "#FFC94D" : undefined }}
            data-testid="notifications-cat-Moderation"
          >
            <ShieldAlert size={12} /> Moderation
            {modUnread > 0 && (
              <span
                className="text-[10px] font-bold rounded-full px-1.5"
                style={{ background: "#FF3344", color: "#fff" }}
                data-testid="notifications-mod-unread"
              >{modUnread}</span>
            )}
          </button>
        )}
      </div>

      {cat === "Moderation" && isModAdmin ? (
        <ModerationNotifications
          items={modItems}
          filter={modFilter}
          setFilter={setModFilter}
          navigate={navigate}
          onLocalUpdate={(id, patch) => setServerItems((arr) =>
            arr.map((n) => (n.id === id ? { ...n, ...patch, payload: { ...n.payload, ...(patch.payload || {}) } } : n)))}
        />
      ) : (
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
                {n.type === "fire_collectable" || n.type === "founding_vip_claimed" || n.type === "fire_up_complete" ? (
                  <span className="font-semibold" data-testid={`notification-fire-msg-${n.id}`}>
                    {n.body || "🔥 You have Fire ready to collect."}
                  </span>
                ) : (<>
                <span className="font-semibold">@{n.actor}</span>{" "}
                <span style={{ color: "var(--text-muted)" }}>
                  {n.type === "like" && "liked"}
                  {n.type === "comment" && "commented on"}
                  {n.type === "follow" && "started following you"}
                  {n.type === "mention" && "mentioned you"}
                  {n.type === "message" && "messaged you"}
                  {n.type === "share" && "shared"}
                  {n.type === "fire" && "fired your post 🔥"}
                  {n.type === "friend_request" && "sent a friend request"}
                  {n.type === "realm_post" && "posted in"}
                  {n.type === "realm_join" && "—"}
                  {n.type === "event_reminder" && "—"}
                </span>
                {n.target && <span> {n.target}</span>}
                <span className="text-[10px] uppercase tracking-widest ml-2 px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}>{n.category}</span>
                </>)}
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
      )}
    </div>
  );
}

const PRIORITY_COLORS = {
  Critical: "#FF2D55",
  Urgent: "#FF5A5A",
  High: "#FFA94D",
  Standard: "#8A93A6",
};

const MOD_EVENT_LABELS = {
  urgent_case: "Urgent safety case",
  scan_failed: "Safety scan failed — needs review",
  review_lock: "Post locked private for review",
};

function ModerationNotifications({ items, filter, setFilter, navigate, onLocalUpdate }) {
  const filtered = items.filter((n) => {
    const st = n.payload?.status || "unresolved";
    if (filter === "urgent") return ["Critical", "Urgent"].includes(n.payload?.priority) && st !== "resolved";
    if (filter === "unresolved") return st !== "resolved";
    if (filter === "resolved") return st === "resolved";
    return true;
  });

  const ack = async (n, action) => {
    try {
      await apiClient.post(`/admin/moderation/notifications/${n.id}/ack`, { action });
    } catch { /* best-effort */ }
    onLocalUpdate(n.id, {
      seen: true,
      payload: action === "acknowledge" && (n.payload?.status !== "resolved")
        ? { status: "acknowledged" } : {},
    });
  };

  const openCase = async (n) => {
    await ack(n, "open");
    const ct = n.payload?.content_type || "post";
    navigate(`/admin/moderation?case=${ct}:${n.payload?.content_id}`);
  };

  return (
    <div data-testid="mod-notifications">
      <div className="flex gap-1.5 mb-3 overflow-x-auto no-scrollbar">
        {["all", "urgent", "unresolved", "resolved"].map((f) => (
          <button key={f} className="or-chip text-[11px] shrink-0" data-active={filter === f}
            style={filter === f ? { color: "var(--primary)", borderColor: "var(--primary)" } : undefined}
            onClick={() => setFilter(f)} data-testid={`mod-notif-filter-${f}`}>
            {f}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }} data-testid="mod-notifications-empty">
            No moderation notifications in this filter.
          </div>
        )}
        {filtered.map((n) => {
          const p = n.payload || {};
          const prio = p.priority || "Standard";
          const st = p.status || "unresolved";
          return (
            <div key={n.id} className="or-surface p-3 sm:p-4" data-testid={`mod-notification-${n.id}`}
              style={{ outline: !n.seen ? "1px solid #FFC94D" : "1px solid transparent" }}>
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full font-bold"
                  style={{ color: PRIORITY_COLORS[prio] || "#8A93A6", border: `1px solid ${PRIORITY_COLORS[prio] || "#8A93A6"}` }}
                  data-testid={`mod-notif-priority-${n.id}`}>
                  {prio}
                </span>
                {p.category && <span className="or-chip text-[10px]">{p.category}</span>}
                <span className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>{p.content_type || "post"}</span>
                <span className="text-[10px] uppercase tracking-widest ml-auto"
                  style={{ color: st === "resolved" ? "#57D98A" : st === "acknowledged" ? "#8A93A6" : "#FFC94D" }}
                  data-testid={`mod-notif-status-${n.id}`}>
                  {st}
                </span>
              </div>
              <div className="text-sm" style={{ color: "var(--text-main)" }}>
                {MOD_EVENT_LABELS[p.event_type] || "Moderation event"}
                {p.username ? <> · <span className="font-semibold">@{p.username}</span></> : null}
              </div>
              <div className="text-[10px] mt-0.5 mb-2" style={{ color: "var(--text-muted)" }}>
                {p.content_type || "post"}:{String(p.content_id || "").slice(0, 12)}… · {String(n.created_at || "").slice(0, 16).replace("T", " ")}
              </div>
              <div className="flex gap-1.5">
                <button className="or-chip" style={{ minHeight: 32 }} onClick={() => openCase(n)} data-testid={`mod-notif-open-${n.id}`}>
                  <FolderOpen size={11} /> Open Case
                </button>
                {st === "unresolved" && (
                  <button className="or-chip" style={{ minHeight: 32 }} onClick={() => ack(n, "acknowledge")} data-testid={`mod-notif-ack-${n.id}`}>
                    <Check size={11} /> Acknowledge
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
