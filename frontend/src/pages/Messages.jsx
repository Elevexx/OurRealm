// ─────────────────────────────────────────────────────────────────────
// OurRealm Messenger — Phase 3 (Supabase)
// One unified messaging system powers Chats, Groups, and Realms.
// Calls is a UI-only placeholder.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import useHeartbeat from "@/hooks/useHeartbeat";
import { useSearchParams } from "react-router-dom";
import {
  MessagesSquare, Users, Radio, Phone, Plus, Send, X, Search,
  Image as ImageIcon, AlertTriangle, LogOut, Loader2,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  listChats, getOrCreateDirectChat,
  listGroups, createGroup, joinGroup, leaveGroup,
  listRealms, createRealm, joinRealm, leaveRealm,
  fetchMessages, sendMessage, subscribeToConversation,
} from "@/lib/messaging";
import ImageUploadPicker from "@/components/ImageUploadPicker";
import MessageActionMenu from "@/components/MessageActionMenu";
import ReportButton from "@/components/ReportButton";
import SharedPostCard from "@/components/SharedPostCard";
import { usePresence } from "@/contexts/PresenceContext";
import presenceSocket from "@/lib/presenceSocket";
import UserAvatar from "@/components/UserAvatar";

const TABS = [
  { id: "chats",  label: "Chats",  Icon: MessagesSquare },
  { id: "groups", label: "Groups", Icon: Users },
  { id: "realms", label: "Realms", Icon: Radio },
  { id: "calls",  label: "Calls",  Icon: Phone },
];

// ─────────────────────────────────────────────────────────────────────
// Profile cache — resolves sender_id → { username, name, avatar_url }
// from the existing FastAPI/Mongo user store. Used to render avatars/
// names on message bubbles since users do not live in Supabase.
// ─────────────────────────────────────────────────────────────────────
function useProfileCache() {
  const [cache, setCache] = useState({});

  const resolve = useCallback(async (ids) => {
    const missing = (ids || []).filter((id) => id && !cache[id]);
    if (missing.length === 0) return cache;
    try {
      const { data } = await apiClient.post("/profile/by-ids", { ids: missing });
      const next = { ...cache };
      for (const u of data.users || []) next[u.id] = u;
      // Fallback rows for ids the backend couldn't resolve
      for (const id of missing) if (!next[id]) next[id] = { id, username: "unknown", name: "Unknown" };
      setCache(next);
      return next;
    } catch {
      return cache;
    }
  }, [cache]);

  return { cache, resolve };
}

function Avatar({ user, size = 40, ring }) {
  return (
    <UserAvatar
      user={user}
      size={size}
      ring={ring}
      className="shrink-0"
    />
  );
}

function NotConfigured() {
  return (
    <div className="or-surface p-6 max-w-2xl mx-auto" data-testid="supabase-not-configured">
      <div className="flex items-center gap-3 mb-2">
        <AlertTriangle size={20} style={{ color: "#FFB72E" }} />
        <h2 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
          Messenger is not configured yet
        </h2>
      </div>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Set <code>REACT_APP_SUPABASE_URL</code> and <code>REACT_APP_SUPABASE_ANON_KEY</code> in{" "}
        <code>/app/frontend/.env</code>, then run the SQL in <code>/app/supabase/schema.sql</code>{" "}
        in your Supabase project to bring Chats, Groups, and Realms online.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────
export default function Messages() {
  useHeartbeat("messages");
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "chats");

  // Phase C — mark user as "In Messenger" while on this page.
  useEffect(() => {
    presenceSocket.setMessengerFocus(true);
    return () => presenceSocket.setMessengerFocus(false);
  }, []);

  const onTab = (id) => {
    setTab(id);
    const p = new URLSearchParams(searchParams);
    p.set("tab", id);
    setSearchParams(p, { replace: true });
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="max-w-7xl mx-auto" data-testid="messages-page">
        <Header />
        <NotConfigured />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto" data-testid="messages-page">
        <Header />
        <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }}>
          Sign in to use Messenger.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto" data-testid="messages-page">
      <Header />

      <div className="or-surface p-3 mb-4 flex gap-2 overflow-x-auto no-scrollbar" data-testid="messenger-tabs">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            data-testid={`messenger-tab-${id}`}
            data-active={tab === id}
            onClick={() => onTab(id)}
            className="flex items-center gap-2 px-4 py-2.5 transition-colors shrink-0"
            style={{
              borderRadius: "calc(var(--radius) - 4px)",
              background: tab === id ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "transparent",
              color: tab === id ? "var(--primary)" : "var(--text-muted)",
              fontWeight: tab === id ? 700 : 500,
              outline: tab === id ? "1px solid var(--primary)" : "1px solid transparent",
            }}
          >
            <Icon size={16} />
            <span className="text-sm">{label}</span>
          </button>
        ))}
      </div>

      {tab === "chats"  && <ChatsTab  me={user} />}
      {tab === "groups" && <GroupsTab me={user} />}
      {tab === "realms" && <RealmsTab me={user} />}
      {tab === "calls"  && <CallsTab />}
    </div>
  );
}

function Header() {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
        OurRealm <span style={{ color: "var(--brand-green)" }}>Messenger</span>
      </h1>
      <span className="mode-badge hidden sm:inline-flex">Unified</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CHATS TAB — restored to the MongoDB-backed REST system so historical
// 1:1 conversations remain visible. Supabase is still used for groups
// and realms. This keeps `delivered_at` / `read_at` / edit / delete
// available without a schema change.
// ─────────────────────────────────────────────────────────────────────
function ChatsTab({ me }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // a "thread" row from /api/messages/threads
  const [showNew, setShowNew] = useState(false);
  const { cache, resolve } = useProfileCache();
  const { statuses } = usePresence();

  // Phase C — sort priority by peer status.
  const STATUS_PRIORITY = useMemo(() => ({
    live: 0, online: 1, messenger: 2, invisible: 3, offline: 4,
  }), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/messages/threads");
      const rows = data?.threads || [];
      // The endpoint returns one row per FRIEND — empty threads included.
      // Show only the ones with at least one real message OR pinned, so
      // the list reflects existing conversations the user wants to find.
      const visible = rows.filter((t) => t.last_at || t.is_pinned);
      setThreads(visible);
      const peerIds = rows.map((t) => t?.peer?.id).filter(Boolean);
      if (peerIds.length) resolve(peerIds);
    } catch (e) {
      console.error("listThreads failed", e);
    } finally { setLoading(false); }
  }, [resolve]);

  useEffect(() => { load(); }, [load]);

  // Phase B — deep link: /messages?dm=<username> auto-opens the DM
  // overlay with that peer (used by /profile/support → "Create Ticket").
  useEffect(() => {
    const dm = searchParams.get("dm");
    if (!dm || !me?.id || active) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/profile/by-username/${dm}`);
        const peer = data?.user || data;
        if (cancelled || !peer?.id) return;
        setActive({
          conv_id: [me.id, peer.id].sort().join(":"),
          peer,
          last_text: null,
          last_at: null,
          is_pinned: false,
        });
      } catch (e) {
        console.warn("dm deep link failed", e);
      } finally {
        // Strip the param so refreshing doesn't reopen the same modal.
        const p = new URLSearchParams(searchParams);
        p.delete("dm");
        setSearchParams(p, { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, me?.id, active, setSearchParams]);

  const onStartChat = useCallback((friend) => {
    // Synthesise an "active" thread so the DM overlay opens immediately.
    setShowNew(false);
    setActive({
      conv_id: [me.id, friend.id].sort().join(":"),
      peer: friend,
      last_text: null,
      last_at: null,
      is_pinned: false,
    });
  }, [me.id]);

  return (
    <section className="or-surface p-3 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base sm:text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          Direct Chats
        </h3>
        <button
          className="or-btn"
          style={{ padding: "0.5rem 0.9rem" }}
          onClick={() => setShowNew(true)}
          data-testid="chats-new-btn"
        >
          <Plus size={14} /> New Chat
        </button>
      </div>

      {loading ? (
        <Loading />
      ) : threads.length === 0 ? (
        <Empty
          icon={<MessagesSquare size={32} />}
          title="No chats yet"
          body="Start a direct chat with one of your friends."
          testid="chats-empty"
        />
      ) : (
        <div data-testid="chats-list">
          {[...threads].sort((a, b) => {
            const sa = statuses[a?.peer?.id] || "offline";
            const sb = statuses[b?.peer?.id] || "offline";
            const pa = STATUS_PRIORITY[sa] ?? 9;
            const pb = STATUS_PRIORITY[sb] ?? 9;
            if (pa !== pb) return pa - pb;
            // tie-break by last activity (more recent first)
            const ta = a.last_at ? new Date(a.last_at).getTime() : 0;
            const tb = b.last_at ? new Date(b.last_at).getTime() : 0;
            return tb - ta;
          }).map((t) => {
            const peer = t.peer || cache[t?.peer?.id];
            const title = peer ? (peer.name || `@${peer.username}`) : "Loading…";
            const peerStatus = statuses[peer?.id] || "offline";
            return (
              <button
                key={t.conv_id}
                onClick={() => setActive(t)}
                className="w-full flex items-center gap-3 py-2.5 px-2 text-left"
                style={{ borderBottom: "1px solid var(--border-col)" }}
                data-testid={`chat-row-${peer?.username || t.conv_id}`}
              >
                <Avatar user={peer} />
                {/* Keep a hidden marker for tests; visible dot is now
                    rendered by the shared Avatar/UserAvatar component. */}
                {peerStatus !== "offline" && (
                  <span style={{ display: "none" }} data-testid={`chat-row-status-${peer?.username}`} data-status={peerStatus} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: "var(--text-main)" }}>{title}</div>
                  <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {t.last_text || "Tap to open conversation"}
                  </div>
                </div>
                <div className="text-xs whitespace-nowrap shrink-0" style={{ color: "var(--text-muted)" }}>
                  {formatTime(t.last_at)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showNew && (
        <FriendPicker me={me} onClose={() => setShowNew(false)} onPick={onStartChat} testid="chat-friend-picker" />
      )}

      {active && (
        <DMConversationOverlay
          me={me}
          peer={active.peer}
          onClose={() => { setActive(null); load(); }}
        />
      )}
    </section>
  );
}

function chatTitle(chat, me, cache) {
  const peerId = (chat.participants || []).find((id) => id !== me.id);
  const peer = cache[peerId];
  return peer ? (peer.name || `@${peer.username}`) : "Direct chat";
}

// ─────────────────────────────────────────────────────────────────────
// GROUPS TAB
// ─────────────────────────────────────────────────────────────────────
function GroupsTab({ me }) {
  return (
    <ThreadListTab
      me={me}
      kind="group"
      heading="Your Groups"
      emptyTitle="No groups yet"
      emptyBody="Create a group to chat with friends, or get invited to one."
      createLabel="New Group"
      list={listGroups}
      create={createGroup}
      leave={leaveGroup}
      testidPrefix="group"
    />
  );
}

function RealmsTab({ me }) {
  return (
    <ThreadListTab
      me={me}
      kind="realm"
      heading="Your Realms"
      emptyTitle="No realms yet"
      emptyBody="Realms are community rooms. Create one or join an existing realm."
      createLabel="New Realm"
      list={listRealms}
      create={createRealm}
      leave={leaveRealm}
      testidPrefix="realm"
    />
  );
}

function ThreadListTab({
  me, kind, heading, emptyTitle, emptyBody, createLabel,
  list, create, leave, testidPrefix,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await list(me.id)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [me.id, list]);

  useEffect(() => { load(); }, [load]);

  const onCreate = useCallback(async ({ name, memberIds }) => {
    try {
      const row = await create(me.id, name, memberIds);
      setShowCreate(false);
      setItems((s) => [row, ...s]);
      setActive(row);
    } catch (e) { console.error(e); }
  }, [me.id, create]);

  const onLeave = async (row) => {
    try {
      await leave(row.id, me.id);
      setActive(null);
      load();
    } catch (e) { console.error(e); }
  };

  return (
    <section className="or-surface p-3 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base sm:text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          {heading}
        </h3>
        <button
          className="or-btn"
          style={{ padding: "0.5rem 0.9rem" }}
          onClick={() => setShowCreate(true)}
          data-testid={`${testidPrefix}s-new-btn`}
        >
          <Plus size={14} /> {createLabel}
        </button>
      </div>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty
          icon={kind === "group" ? <Users size={32} /> : <Radio size={32} />}
          title={emptyTitle}
          body={emptyBody}
          testid={`${testidPrefix}s-empty`}
        />
      ) : (
        <div className="space-y-2" data-testid={`${testidPrefix}s-list`}>
          {items.map((g) => (
            <button
              key={g.id}
              onClick={() => setActive(g)}
              className="w-full or-surface p-3 text-left flex items-center gap-3"
              style={{ background: "var(--surface-2)" }}
              data-testid={`${testidPrefix}-row-${g.id}`}
            >
              <div
                className="rounded-full flex items-center justify-center shrink-0"
                style={{
                  width: 48, height: 48,
                  background: "color-mix(in srgb, var(--primary) 16%, transparent)",
                  border: "1px solid var(--primary)",
                  color: "var(--primary)",
                  fontWeight: 800,
                }}
              >
                {(g.name || "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate" style={{ color: "var(--text-main)" }}>{g.name}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {(g.members || []).length} member{(g.members || []).length === 1 ? "" : "s"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateThreadModal
          me={me}
          kind={kind}
          onClose={() => setShowCreate(false)}
          onCreate={onCreate}
        />
      )}

      {active && (
        <ConversationOverlay
          me={me}
          contextType={kind}
          contextId={active.id}
          title={active.name}
          subtitle={`${(active.members || []).length} member${(active.members || []).length === 1 ? "" : "s"}`}
          onLeave={() => onLeave(active)}
          onClose={() => { setActive(null); load(); }}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CALLS — UI-only placeholder
// ─────────────────────────────────────────────────────────────────────
function CallsTab() {
  return (
    <section className="or-surface p-6" data-testid="calls-tab">
      <Empty
        icon={<Phone size={32} />}
        title="Voice & video calls — coming soon"
        body="Direct and group calls are on the OurRealm roadmap. We'll light this tab up when the call stack is ready."
        testid="calls-empty"
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DM CONVERSATION OVERLAY (MongoDB REST) — direct messages with edit,
// delete, and delivered/read receipts. Mobile-safe layout per spec.
// ─────────────────────────────────────────────────────────────────────
function DMConversationOverlay({ me, peer, onClose }) {
  const [messages, setMessages] = useState([]);
  const [peerInfo, setPeerInfo] = useState(peer || null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [menuFor, setMenuFor] = useState(null);     // message id of action menu
  const [menuAnchor, setMenuAnchor] = useState(null); // DOMRect for desktop popover
  const [editingId, setEditingId] = useState(null); // currently editing
  const [editDraft, setEditDraft] = useState("");
  const endRef = useRef(null);
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);
  const username = peer?.username;

  const reload = useCallback(async () => {
    if (!username) return;
    try {
      const { data } = await apiClient.get(`/messages/thread/${username}`);
      setMessages(data?.messages || []);
      setPeerInfo(data?.peer || peer);
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to load");
    } finally { setLoading(false); }
  }, [username, peer]);

  // Initial load (also marks unread messages from peer as read server-side)
  useEffect(() => { reload(); }, [reload]);

  // Light polling so delivered/read flips and new inbound messages appear
  // without forcing a full app-wide socket layer. Cleared on unmount.
  useEffect(() => {
    if (!username) return undefined;
    const tick = () => { reload(); };
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [reload, username]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post("/messages", { to_username: username, text });
      setMessages((prev) => [...prev, data.message]);
      setDraft("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to send");
    } finally { setBusy(false); }
  };

  const startEdit = (m) => { setMenuFor(null); setMenuAnchor(null); setEditingId(m.id); setEditDraft(m.text || ""); };
  const cancelEdit = () => { setEditingId(null); setEditDraft(""); };

  const saveEdit = async () => {
    const text = editDraft.trim();
    if (!text || !editingId) return cancelEdit();
    try {
      const { data } = await apiClient.patch(`/messages/${editingId}`, { text });
      setMessages((prev) => prev.map((m) => (m.id === editingId ? { ...m, ...data.message } : m)));
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to edit");
    } finally { cancelEdit(); }
  };

  const doDelete = async (id) => {
    setMenuFor(null); setMenuAnchor(null);
    try {
      await apiClient.delete(`/messages/${id}`);
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || "Failed to delete");
    }
  };

  const closeMenu = () => { setMenuFor(null); setMenuAnchor(null); };

  // Tap or long-press an own bubble to surface the action menu. Capture
  // the bubble rect for the desktop popover anchor.
  const openMenuFor = (id, el) => {
    const rect = el?.getBoundingClientRect?.() || null;
    setMenuAnchor(rect);
    setMenuFor(id);
  };

  // Long-press handlers (mobile) — fire after 450ms hold.
  const onBubbleTouchStart = (m, el) => {
    longPressFired.current = false;
    clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      openMenuFor(m.id, el);
    }, 450);
  };
  const onBubbleTouchEnd = () => { clearTimeout(longPressTimer.current); };
  const onBubbleTouchMove = () => { clearTimeout(longPressTimer.current); };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(10px)",
        // Respect device safe areas (iOS notch + home indicator).
        paddingTop: "max(12px, env(safe-area-inset-top))",
        paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        paddingLeft: 12,
        paddingRight: 12,
      }}
      onClick={onClose}
      data-testid="dm-overlay"
    >
      <div
        className="or-surface flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100vw - 24px, 640px)",
          maxWidth: "100%",
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)",
          overflow: "hidden",
        }}
      >
        <header
          className="flex items-center gap-3 p-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-col)" }}
        >
          <Avatar user={peerInfo || peer} size={36} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate" style={{ color: "var(--text-main)" }} data-testid="dm-title">
              {peerInfo?.name || `@${username}`}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>@{username}</div>
          </div>
          <button
            className="starbar-icon"
            style={{ width: 36, height: 36 }}
            onClick={onClose}
            data-testid="dm-close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-2" data-testid="dm-body">
          {loading ? (
            <Loading />
          ) : messages.length === 0 ? (
            <div className="text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Say something to start the conversation.
            </div>
          ) : messages.map((m) => {
            const mine = m.from_user_id === me.id;
            const isEditing = editingId === m.id;
            const status = m.read_at ? "Read" : m.delivered_at ? "Delivered" : "Sent";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[80%] px-3 py-2 text-sm relative"
                  style={{
                    background: mine ? "var(--primary)" : "var(--surface-2)",
                    color: mine ? "var(--primary-fg)" : "var(--text-main)",
                    borderRadius: "var(--radius)",
                    cursor: mine ? "pointer" : "default",
                    userSelect: mine ? "none" : "auto",
                    WebkitUserSelect: mine ? "none" : "auto",
                    WebkitTouchCallout: "none",
                  }}
                  data-testid={`dm-msg-${m.id}`}
                  onClick={(e) => {
                    // Suppress the click that follows a long-press release.
                    if (longPressFired.current) { longPressFired.current = false; return; }
                    if (mine && !isEditing) openMenuFor(m.id, e.currentTarget);
                  }}
                  onTouchStart={(e) => { if (mine && !isEditing) onBubbleTouchStart(m, e.currentTarget); }}
                  onTouchEnd={onBubbleTouchEnd}
                  onTouchMove={onBubbleTouchMove}
                  onContextMenu={(e) => {
                    // Right-click on desktop also opens the menu.
                    if (mine && !isEditing) { e.preventDefault(); openMenuFor(m.id, e.currentTarget); }
                  }}
                >
                  {isEditing ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={2}
                        autoFocus
                        className="w-full bg-transparent outline-none text-sm"
                        style={{ color: "inherit", resize: "vertical", minHeight: 50 }}
                        data-testid={`dm-edit-input-${m.id}`}
                      />
                      <div className="flex justify-end gap-2 mt-1">
                        <button onClick={cancelEdit} className="or-chip" data-testid={`dm-edit-cancel-${m.id}`}>Cancel</button>
                        <button onClick={saveEdit} className="or-chip" data-testid={`dm-edit-save-${m.id}`}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {m.text && <div className="or-wrap">{renderText(m.text)}</div>}
                      {m.media?.kind === "post_share" && m.media?.post_id && (
                        <SharedPostCard postId={m.media.post_id} testid={`dm-shared-post-${m.id}`} />
                      )}
                      {m.media?.url && (
                        <a href={m.media.url} target="_blank" rel="noopener noreferrer" className="block mt-1" onClick={(e) => e.stopPropagation()}>
                          <img src={m.media.url} alt="" className="rounded" style={{ maxHeight: 220, maxWidth: "100%" }} />
                        </a>
                      )}
                      <div className="text-[10px] mt-1 opacity-70 flex items-center justify-end gap-2">
                        {m.edited_at && <span data-testid={`dm-edited-${m.id}`}>edited</span>}
                        <span>{formatTime(m.created_at)}</span>
                        {mine ? (
                          <span data-testid={`dm-status-${m.id}`}>{status}</span>
                        ) : (
                          /* Phase 4 — non-own bubble: small Report flag.
                             Opens the universal ReportModal with target_type='message'.
                             We deliberately send ONLY {conv_id, message_id} as
                             metadata — the message body is never sent. */
                          <ReportButton
                            targetType="message"
                            targetId={m.id}
                            variant="icon"
                            testid={`dm-report-${m.id}`}
                            style={{
                              width: 18, height: 18,
                              background: "transparent", border: "none",
                              color: "inherit", opacity: 0.55,
                              padding: 0,
                            }}
                            title="Report message"
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {/* Portal-based action menu — Edit / Delete / Cancel. Mirrors the
            post management popup so mobile and desktop placement match
            the rest of the app. */}
        {menuFor && (() => {
          const m = messages.find((x) => x.id === menuFor);
          if (!m) return null;
          return (
            <MessageActionMenu
              open
              anchorRect={menuAnchor}
              busy={false}
              onEdit={() => startEdit(m)}
              onDelete={() => doDelete(m.id)}
              onClose={closeMenu}
              testid={`dm-actions-${m.id}`}
              editTestid={`dm-action-edit-${m.id}`}
              deleteTestid={`dm-action-delete-${m.id}`}
              cancelTestid={`dm-action-cancel-${m.id}`}
            />
          );
        })()}

        {err && <div className="text-xs px-4 py-1.5 shrink-0" style={{ color: "#FF8080" }} data-testid="dm-error">{err}</div>}

        <div className="p-3 flex items-center gap-2 shrink-0" style={{ borderTop: "1px solid var(--border-col)" }}>
          <input
            className="or-input flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Message @${username}`}
            data-testid="dm-input"
          />
          <button
            className="or-btn"
            disabled={busy || !draft.trim()}
            onClick={send}
            data-testid="dm-send"
            style={{ padding: "0.5rem 0.9rem" }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CONVERSATION OVERLAY — used by chats, groups, and realms
// ─────────────────────────────────────────────────────────────────────
function ConversationOverlay({ me, contextType, contextId, title, subtitle, onClose, onLeave }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [imagePicker, setImagePicker] = useState(false);
  const endRef = useRef(null);
  const { cache, resolve } = useProfileCache();

  // initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const rows = await fetchMessages(contextType, contextId);
        if (!mounted) return;
        setMessages(rows);
        const senderIds = Array.from(new Set(rows.map((r) => r.sender_id)));
        if (senderIds.length) resolve(senderIds);
      } catch (e) {
        if (mounted) setErr(e.message || "Failed to load messages");
      } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [contextType, contextId, resolve]);

  // realtime subscription — only for the active conversation
  useEffect(() => {
    const off = subscribeToConversation(contextType, contextId, (row) => {
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      resolve([row.sender_id]);
    });
    return off;
  }, [contextType, contextId, resolve]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const send = async (text, mediaUrl = null) => {
    const body = (text || "").trim();
    if (!body && !mediaUrl) return;
    setBusy(true); setErr("");
    try {
      const row = await sendMessage({
        contextType, contextId, senderId: me.id, text: body, mediaUrl,
      });
      // Optimistic merge; realtime may also deliver it — dedup by id.
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      setDraft("");
    } catch (e) {
      setErr(e.message || "Failed to send");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(10px)",
        paddingTop: "max(12px, env(safe-area-inset-top))",
        paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        paddingLeft: 12,
        paddingRight: 12,
      }}
      onClick={onClose}
      data-testid="conversation-overlay"
    >
      <div
        className="or-surface flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100vw - 24px, 640px)",
          maxWidth: "100%",
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)",
          overflow: "hidden",
        }}
      >
        <header className="flex items-center gap-3 p-3 shrink-0" style={{ borderBottom: "1px solid var(--border-col)" }}>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate" style={{ color: "var(--text-main)" }} data-testid="conversation-title">{title}</div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{subtitle}</div>
          </div>
          {onLeave && (
            <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={onLeave} title="Leave" data-testid="conversation-leave">
              <LogOut size={16} />
            </button>
          )}
          <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={onClose} data-testid="conversation-close">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-2" data-testid="conversation-body">
          {loading ? (
            <Loading />
          ) : messages.length === 0 ? (
            <div className="text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Say something to start the conversation.
            </div>
          ) : messages.map((m) => {
            const mine = m.sender_id === me.id;
            const sender = cache[m.sender_id];
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[75%] px-3 py-2 text-sm"
                  style={{
                    background: mine ? "var(--primary)" : "var(--surface-2)",
                    color: mine ? "var(--primary-fg)" : "var(--text-main)",
                    borderRadius: "var(--radius)",
                  }}
                  data-testid={`msg-${m.id}`}
                >
                  {!mine && sender && (
                    <div className="text-[10px] font-bold mb-0.5" style={{ color: "var(--brand-green)" }}>
                      @{sender.username || "user"}
                    </div>
                  )}
                  {m.text && <div className="or-wrap">{renderText(m.text)}</div>}
                  {m.media_url && (
                    <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="block mt-1">
                      <img src={m.media_url} alt="" className="rounded" style={{ maxHeight: 220, maxWidth: "100%" }} />
                    </a>
                  )}
                  <div className="text-[10px] mt-1 opacity-70 text-right">
                    {formatTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {err && <div className="text-xs px-4 py-1.5" style={{ color: "#FF8080" }} data-testid="conversation-error">{err}</div>}

        <div className="p-3 flex items-center gap-2" style={{ borderTop: "1px solid var(--border-col)" }}>
          <button
            type="button"
            className="starbar-icon"
            style={{ width: 36, height: 36 }}
            onClick={() => setImagePicker(true)}
            data-testid="conversation-attach-image"
            aria-label="Send image"
            title="Send image"
          >
            <ImageIcon size={16} />
          </button>
          <input
            className="or-input flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(draft)}
            placeholder="Message…"
            data-testid="conversation-input"
          />
          <button
            className="or-btn"
            style={{ padding: "0.55rem 0.9rem" }}
            disabled={busy || !draft.trim()}
            onClick={() => send(draft)}
            data-testid="conversation-send"
          >
            <Send size={16} />
          </button>
        </div>

        <ImageUploadPicker
          open={imagePicker}
          onClose={() => setImagePicker(false)}
          onPicked={({ url }) => { setImagePicker(false); send("", url); }}
          title="Send an image"
          testid="conversation-image-picker"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FriendPicker — picks one friend (for starting a direct chat)
// ─────────────────────────────────────────────────────────────────────
function FriendPicker({ me, onClose, onPick, testid = "friend-picker" }) {
  const [friends, setFriends] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await apiClient.get("/friends/list");
        if (!mounted) return;
        setFriends(data.friends || data || []);
      } catch (e) {
        console.error("friends/list failed", e);
      } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return friends;
    return friends.filter((f) =>
      (f.username || "").toLowerCase().includes(term)
      || (f.name || "").toLowerCase().includes(term)
    );
  }, [q, friends]);

  return (
    <Modal title="Start a chat" onClose={onClose} testid={testid}>
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
      {loading ? <Loading /> : filtered.length === 0 ? (
        <div className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
          {friends.length === 0 ? "Add some friends first to start chatting." : "No matches."}
        </div>
      ) : (
        <div className="max-h-[50vh] overflow-y-auto" data-testid={`${testid}-list`}>
          {filtered.map((f) => (
            <button
              key={f.id}
              onClick={() => onPick(f)}
              className="w-full flex items-center gap-3 py-2 px-2 text-left"
              style={{ borderBottom: "1px solid var(--border-col)" }}
              data-testid={`${testid}-pick-${f.username}`}
            >
              <Avatar user={f} size={36} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{f.name || f.username}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>@{f.username}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CreateThreadModal — name + multi-select friends. Used by Groups/Realms.
// ─────────────────────────────────────────────────────────────────────
function CreateThreadModal({ me, kind, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [friends, setFriends] = useState([]);
  const [picked, setPicked] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await apiClient.get("/friends/list");
        if (!mounted) return;
        setFriends(data.friends || data || []);
      } catch { /* ignore */ }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  const toggle = (id) => setPicked((p) => ({ ...p, [id]: !p[id] }));
  const memberIds = Object.keys(picked).filter((k) => picked[k]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await onCreate({ name: name.trim(), memberIds }); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`New ${kind === "realm" ? "Realm" : "Group"}`} onClose={onClose} testid={`create-${kind}-modal`}>
      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        Name
      </label>
      <input
        autoFocus
        className="or-input w-full mt-1 mb-3"
        placeholder={kind === "realm" ? "Realm name" : "Group name"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid={`create-${kind}-name`}
      />

      <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
        Add members ({memberIds.length} selected)
      </div>
      {loading ? <Loading /> : friends.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          You don&apos;t have any friends yet. You can still create this {kind} and add people later.
        </div>
      ) : (
        <div className="max-h-[40vh] overflow-y-auto mb-3" data-testid={`create-${kind}-friends`}>
          {friends.map((f) => {
            const on = !!picked[f.id];
            return (
              <button
                key={f.id}
                onClick={() => toggle(f.id)}
                className="w-full flex items-center gap-3 py-2 px-2 text-left"
                style={{
                  borderBottom: "1px solid var(--border-col)",
                  background: on ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
                }}
                data-testid={`create-${kind}-friend-${f.username}`}
              >
                <Avatar user={f} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{f.name || f.username}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>@{f.username}</div>
                </div>
                <span
                  className="w-5 h-5 rounded flex items-center justify-center text-xs"
                  style={{
                    background: on ? "var(--primary)" : "transparent",
                    border: `1px solid ${on ? "var(--primary)" : "var(--border-col)"}`,
                    color: "var(--primary-fg)",
                  }}
                >{on ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button className="or-btn or-btn-ghost" onClick={onClose} data-testid={`create-${kind}-cancel`}>Cancel</button>
        <button
          className="or-btn"
          disabled={busy || !name.trim()}
          onClick={submit}
          data-testid={`create-${kind}-submit`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Small shared primitives
// ─────────────────────────────────────────────────────────────────────
function Modal({ title, children, onClose, testid }) {
  return (
    <div
      className="or-modal-shell z-[90]"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid={testid}
    >
      <div className="or-surface or-modal-card p-4" onClick={(e) => e.stopPropagation()}>
        <div className="or-modal-header flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>{title}</h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose} data-testid={`${testid}-close`}>
            <X size={14} />
          </button>
        </div>
        <div className="or-modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }} data-testid="loading">
      <Loader2 size={20} className="animate-spin" />
    </div>
  );
}

function Empty({ icon, title, body, testid }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 gap-3" data-testid={testid}>
      <div style={{ color: "var(--text-muted)" }}>{icon}</div>
      <div className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>{title}</div>
      <p className="text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>{body}</p>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}

function renderText(text) {
  const parts = [];
  const urlRe = /(https?:\/\/[^\s]+)/g;
  let last = 0; let m; let i = 0;
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${i++}`}>{text.slice(last, m.index)}</span>);
    const url = m[0];
    const isImg   = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(url);
    const isAudio = /\.(mp3|m4a|aac|wav|ogg|flac|webm)(\?.*)?$/i.test(url);
    if (isImg) {
      parts.push(
        <a key={`img${i++}`} href={url} target="_blank" rel="noopener noreferrer" className="block mt-1 mb-1">
          <img src={url} alt="" className="rounded" style={{ maxHeight: 200, maxWidth: "100%" }} />
        </a>
      );
    } else if (isAudio) {
      // Inline mini-player for shared OurRealm sounds (Phase 4A "Share to chat").
      // No schema change — we just recognise the URL pattern here.
      parts.push(
        <audio
          key={`a${i++}`}
          controls preload="metadata"
          src={url}
          className="block mt-1 mb-1 w-full"
          style={{ maxWidth: "100%" }}
        />
      );
    } else {
      parts.push(
        <a key={`u${i++}`} href={url} target="_blank" rel="noopener noreferrer"
          style={{ color: "inherit", textDecoration: "underline" }}>{url}</a>
      );
    }
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(<span key={`t${i++}`}>{text.slice(last)}</span>);
  return parts;
}
