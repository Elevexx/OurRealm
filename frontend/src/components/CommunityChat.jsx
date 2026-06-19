/**
 * CommunityChat — the main chat widget inside every Realm / Group page.
 *
 * Wire:
 *   • REST `GET /api/community-chats/:id/messages`   — initial load + paginate
 *   • REST `POST /api/community-chats/:id/messages`  — send a message
 *   • WS   `/api/ws/community-chat/:id`              — realtime delivery
 *
 * Visual: deliberately reuses the same bubble shape, colours, surface
 * classes, and `Send` button as the existing Messenger so users see
 * one consistent chat experience across DMs and community rooms.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Send, Edit3, Loader2, MessageSquare, Pin } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");

function wsUrl(chatId) {
  // Use the same origin as the backend; switch http→ws / https→wss.
  const proto = BACKEND_URL.startsWith("https") ? "wss" : "ws";
  const base  = BACKEND_URL.replace(/^https?/, proto);
  const token = (() => {
    try { return localStorage.getItem("ourrealm.access") || ""; } catch { return ""; }
  })();
  return `${base}/api/ws/community-chat/${chatId}?token=${encodeURIComponent(token)}`;
}

export default function CommunityChat({ chat, isAdmin, onRenameRequested }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState({}); // id -> username
  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const typingClearRef = useRef({});

  // Initial load + new-chat reset.
  useEffect(() => {
    if (!chat?.id) return;
    setMessages([]); setLoading(true);
    (async () => {
      try {
        const { data } = await apiClient.get(`/community-chats/${chat.id}/messages`, { params: { limit: 50 } });
        setMessages(data.messages || []);
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, [chat?.id]);

  // WebSocket subscription.
  useEffect(() => {
    if (!chat?.id) return;
    const ws = new WebSocket(wsUrl(chat.id));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "message:new") {
          setMessages((prev) => prev.find((m) => m.id === msg.message.id) ? prev : [...prev, msg.message]);
        } else if (msg.type === "typing") {
          const uid = msg.user_id, uname = msg.username;
          setTypingUsers((p) => ({ ...p, [uid]: uname }));
          clearTimeout(typingClearRef.current[uid]);
          typingClearRef.current[uid] = setTimeout(() => {
            setTypingUsers((p) => { const n = { ...p }; delete n[uid]; return n; });
          }, 3000);
        } else if (msg.type === "chat:updated") {
          // Bubble up so the parent can refresh the title without a re-fetch.
          window.dispatchEvent(new CustomEvent("community-chat:updated", { detail: msg }));
        } else if (msg.type === "widget:layout_changed") {
          // Same event channel — RealmDetail listens for widget layout
          // changes here so it can refetch the widgets list.
          window.dispatchEvent(new CustomEvent("community-chat:updated", { detail: msg }));
        }
      } catch { /* */ }
    };
    return () => {
      try { ws.close(); } catch { /* */ }
      wsRef.current = null;
    };
  }, [chat?.id]);

  // Auto-scroll to the bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text || sending || !chat?.id) return;
    setSending(true);
    try {
      const { data } = await apiClient.post(`/community-chats/${chat.id}/messages`, { body: text });
      // Optimistic insert in case the WS echo is slow.
      setMessages((prev) => prev.find((m) => m.id === data.id) ? prev : [...prev, data]);
      setDraft("");
    } catch { /* */ } finally { setSending(false); }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    if (wsRef.current && wsRef.current.readyState === 1) {
      try { wsRef.current.send(JSON.stringify({ type: "typing" })); } catch { /* */ }
    }
  };

  const typers = useMemo(() => Object.values(typingUsers).filter(Boolean).slice(0, 3), [typingUsers]);

  return (
    <section className="or-surface flex flex-col overflow-hidden" style={{ minHeight: 520, maxHeight: "calc(100dvh - 280px)" }} data-testid="community-chat-widget">
      {/* Header */}
      <header className="px-4 py-3 flex items-center gap-2 border-b" style={{ borderColor: "var(--border-col)" }}>
        <MessageSquare size={16} style={{ color: "var(--primary)" }} />
        <h3 className="text-base font-bold truncate" style={{ fontFamily: "var(--font-display)" }} data-testid="community-chat-title">
          {chat?.title || "General Chat"}
        </h3>
        {chat?.description && (
          <span className="text-[11px] truncate ml-2" style={{ color: "var(--text-muted)" }}>{chat.description}</span>
        )}
        {isAdmin && (
          <button
            onClick={onRenameRequested}
            className="or-chip ml-auto"
            data-testid="community-chat-rename"
            title="Rename chat (admin)"
          ><Edit3 size={12} /> Rename</button>
        )}
      </header>

      {/* Pinned / welcome */}
      {(chat?.welcome_message || chat?.pinned_message_id) && (
        <div className="px-4 py-2 text-[12px] flex items-start gap-2" style={{ background: "color-mix(in srgb, var(--primary) 7%, transparent)", color: "var(--text-muted)" }} data-testid="community-chat-welcome">
          <Pin size={11} className="mt-0.5" />
          <span>{chat.welcome_message}</span>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2" data-testid="community-chat-stream">
        {loading ? (
          <div className="text-center py-8" style={{ color: "var(--text-muted)" }}><Loader2 size={18} className="inline animate-spin" /></div>
        ) : messages.length === 0 ? (
          <div className="text-center py-10 text-sm" style={{ color: "var(--text-muted)" }} data-testid="community-chat-empty">
            Be the first to say hi.
          </div>
        ) : messages.map((m) => {
          const mine = user && m.user_id === user.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`community-chat-msg-${m.id}`}>
              {!mine && (
                <img src={m.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full mr-2 mt-1" style={{ width: 24, height: 24 }} />
              )}
              <div
                className="max-w-[75%] px-3 py-2 text-sm relative"
                style={{
                  background: mine ? "var(--primary)" : "var(--surface-2)",
                  color: mine ? "var(--primary-fg)" : "var(--text-main)",
                  borderRadius: "var(--radius)",
                }}
              >
                {!mine && (
                  <div className="text-[11px] font-bold mb-0.5" style={{ color: "var(--primary)" }}>{m.display_name || m.username}</div>
                )}
                <div className="or-wrap whitespace-pre-wrap">{m.body}</div>
                <div className="text-[10px] mt-1 opacity-70 text-right">{formatTime(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Typing indicator */}
      {typers.length > 0 && (
        <div className="px-4 py-1 text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="community-chat-typing">
          {typers.join(", ")} typing…
        </div>
      )}

      {/* Composer */}
      <form onSubmit={send} className="px-3 py-3 flex items-end gap-2 border-t" style={{ borderColor: "var(--border-col)" }}>
        <textarea
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={`Message ${chat?.title || "the community"}…`}
          className="or-input flex-1 resize-none"
          style={{ minHeight: 38, maxHeight: 110 }}
          data-testid="community-chat-input"
        />
        <button
          type="submit"
          className="or-btn"
          disabled={sending || !draft.trim()}
          data-testid="community-chat-send"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>
    </section>
  );
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
