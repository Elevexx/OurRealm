/**
 * FloatingDMWindow — single floating private-message popup anchored to
 * the bottom-right of the screen. Uses the EXISTING DM endpoints so
 * messages sent here appear in /messages instantly and vice-versa.
 *
 * Endpoints:
 *   GET  /api/messages/thread/:username   — load conversation
 *   POST /api/messages                    — send (body: { to_username, text })
 *
 * Phase 1: single window (only one popup open at a time — opening a
 * second member replaces the first). Phase 3 will add a stacking
 * manager so multiple windows can coexist.
 */
import React, { useEffect, useRef, useState } from "react";
import { X, Minus, Send, Loader2, MessageCircle } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

export default function FloatingDMWindow({ peer, onClose }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const scrollRef = useRef(null);
  const pollRef = useRef(null);

  // Initial load + light polling (every 8s) — keeps the popup live
  // without a dedicated WS, identical to how the Messenger tab works
  // when no Supabase realtime subscription is open.
  useEffect(() => {
    if (!peer?.username) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await apiClient.get(`/messages/thread/${peer.username}`);
        if (!cancelled) setMessages(data?.messages || data || []);
      } catch { /* */ } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    pollRef.current = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [peer?.username]);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { data } = await apiClient.post("/messages", { to_username: peer.username, text });
      const msg = data?.message || data;
      if (msg && msg.id) {
        setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]);
      }
      setDraft("");
    } catch { /* */ } finally { setSending(false); }
  };

  if (!peer) return null;

  return (
    <div
      className="fixed z-50 or-surface overflow-hidden"
      style={{
        right: "max(12px, env(safe-area-inset-right))",
        bottom: "max(12px, env(safe-area-inset-bottom))",
        width: "min(340px, calc(100vw - 24px))",
        height: minimized ? 44 : "min(460px, calc(100dvh - 120px))",
        display: "flex", flexDirection: "column",
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        border: "1px solid var(--border-col)",
        transition: "height 0.18s ease-out",
      }}
      data-testid="floating-dm-window"
    >
      <header
        className="px-3 py-2 flex items-center gap-2 cursor-pointer"
        style={{ background: "color-mix(in srgb, var(--primary) 10%, var(--surface))" }}
        onClick={() => setMinimized((v) => !v)}
        data-testid="floating-dm-header"
      >
        <img src={peer.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full" style={{ width: 22, height: 22 }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: "var(--text-main)" }}>{peer.display_name || peer.username}</div>
          <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{peer.username}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setMinimized((v) => !v); }}
          className="or-chip"
          data-testid="floating-dm-minimize"
          title={minimized ? "Open" : "Minimize"}
        ><Minus size={12} /></button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose && onClose(); }}
          className="or-chip"
          data-testid="floating-dm-close"
          title="Close"
        ><X size={12} /></button>
      </header>

      {!minimized && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5" data-testid="floating-dm-stream">
            {loading ? (
              <div className="text-center py-6" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="inline animate-spin" /></div>
            ) : messages.length === 0 ? (
              <div className="text-center py-6 text-sm" style={{ color: "var(--text-muted)" }}>
                <MessageCircle size={18} className="inline mb-1" /><br />
                Say hi to {peer.display_name || peer.username}.
              </div>
            ) : messages.map((m) => {
              const mine = user && (m.from_user_id === user.id || m.sender_id === user.id);
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className="max-w-[80%] px-3 py-2 text-sm"
                    style={{
                      background: mine ? "var(--primary)" : "var(--surface-2)",
                      color: mine ? "var(--primary-fg)" : "var(--text-main)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    <div className="or-wrap whitespace-pre-wrap">{m.text || m.body}</div>
                    <div className="text-[10px] mt-0.5 opacity-70 text-right">{formatTime(m.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <form onSubmit={send} className="px-2 py-2 flex items-end gap-1.5 border-t" style={{ borderColor: "var(--border-col)" }}>
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Message…"
              className="or-input flex-1 resize-none text-sm"
              style={{ minHeight: 34, maxHeight: 96 }}
              data-testid="floating-dm-input"
            />
            <button type="submit" className="or-btn" disabled={sending || !draft.trim()} data-testid="floating-dm-send">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
