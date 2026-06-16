// ─────────────────────────────────────────────────────────────────────
// OurRealm Messenger — Phase 3 (Supabase)
// One unified messaging system powers Chats, Groups, and Realms.
// Calls is a UI-only placeholder.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  const src = user?.avatar_url
    || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.name || user?.username || "u")}`;
  return (
    <img
      src={src}
      alt={user?.username || "user"}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size, border: ring ? `2px solid ${ring}` : undefined }}
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
        Set <code>REACT_APP_SUPABASE_URL</code> and <code>REACT_APP_SUPABASE_ANON_KEY</code> in
        <code> /app/frontend/.env</code>, then run the SQL in <code>/app/supabase/schema.sql</code>
        in your Supabase project to bring Chats, Groups, and Realms online.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────
export default function Messages() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "chats");

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
// CHATS TAB
// ─────────────────────────────────────────────────────────────────────
function ChatsTab({ me }) {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // chat row
  const [showNew, setShowNew] = useState(false);
  const { cache, resolve } = useProfileCache();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listChats(me.id);
      setChats(rows);
      const peerIds = rows.flatMap((c) => (c.participants || []).filter((id) => id !== me.id));
      if (peerIds.length) await resolve(peerIds);
    } catch (e) {
      console.error("listChats failed", e);
    } finally { setLoading(false); }
  }, [me.id, resolve]);

  useEffect(() => { load(); }, [load]);

  const onStartChat = useCallback(async (friend) => {
    try {
      const chat = await getOrCreateDirectChat(me.id, friend.id);
      await resolve([friend.id]);
      setShowNew(false);
      setActive(chat);
      load();
    } catch (e) { console.error(e); }
  }, [me.id, resolve, load]);

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
      ) : chats.length === 0 ? (
        <Empty
          icon={<MessagesSquare size={32} />}
          title="No chats yet"
          body="Start a direct chat with one of your friends."
          testid="chats-empty"
        />
      ) : (
        <div data-testid="chats-list">
          {chats.map((c) => {
            const peerId = (c.participants || []).find((id) => id !== me.id);
            const peer = cache[peerId];
            const title = peer ? (peer.name || `@${peer.username}`) : "Loading…";
            return (
              <button
                key={c.id}
                onClick={() => setActive(c)}
                className="w-full flex items-center gap-3 py-2.5 px-2 text-left"
                style={{ borderBottom: "1px solid var(--border-col)" }}
                data-testid={`chat-row-${c.id}`}
              >
                <Avatar user={peer} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: "var(--text-main)" }}>{title}</div>
                  <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {c.last_message || "Tap to start the conversation"}
                  </div>
                </div>
                <div className="text-xs whitespace-nowrap shrink-0" style={{ color: "var(--text-muted)" }}>
                  {formatTime(c.updated_at)}
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
        <ConversationOverlay
          me={me}
          contextType="chat"
          contextId={active.id}
          title={chatTitle(active, me, cache)}
          subtitle="Direct chat"
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
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid="conversation-overlay"
    >
      <div className="or-surface w-full max-w-2xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
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
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid={testid}
    >
      <div className="or-surface w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>{title}</h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose} data-testid={`${testid}-close`}>
            <X size={14} />
          </button>
        </div>
        {children}
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
    const isImg = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(url);
    if (isImg) {
      parts.push(
        <a key={`img${i++}`} href={url} target="_blank" rel="noopener noreferrer" className="block mt-1 mb-1">
          <img src={url} alt="" className="rounded" style={{ maxHeight: 200, maxWidth: "100%" }} />
        </a>
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
