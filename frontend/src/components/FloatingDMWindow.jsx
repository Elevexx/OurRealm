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
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Minus, Send, Loader2, MessageCircle } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import ReactionAttachment from "@/components/ReactionAttachment";

const WIDTH  = 340;
const HEIGHT = 460;
const MARGIN = 12;
function isMobile() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 640;
}

export default function FloatingDMWindow({ peer, onClose }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // pos: { x, y } in viewport px. Mobile → null (CSS centers via fixed inset).
  const [pos, setPos] = useState(null);
  const scrollRef = useRef(null);
  const pollRef = useRef(null);
  const dragRef = useRef({ active: false, dx: 0, dy: 0 });

  // Per-spec: every open of a *new* peer starts centered. When the same
  // peer is re-opened we still reset to center (the popup is unmounted
  // between opens, so this just runs once on mount).
  useLayoutEffect(() => {
    if (!peer || isMobile()) { setPos(null); return; }
    const x = Math.max(MARGIN, Math.round((window.innerWidth  - WIDTH)  / 2));
    const y = Math.max(MARGIN, Math.round((window.innerHeight - HEIGHT) / 2));
    setPos({ x, y });
  }, [peer?.username]);

  // Keep the popup inside the viewport when the window resizes.
  useEffect(() => {
    const onResize = () => {
      if (isMobile()) { setPos(null); return; }
      setPos((p) => p ? clamp(p) : p);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ─── Drag handlers ───────────────────────────────────────────────
  const beginDrag = (clientX, clientY) => {
    if (isMobile() || minimized || !pos) return;
    dragRef.current = { active: true, dx: clientX - pos.x, dy: clientY - pos.y };
    document.body.style.userSelect = "none";
  };
  const moveDrag = (clientX, clientY) => {
    if (!dragRef.current.active) return;
    setPos(clamp({ x: clientX - dragRef.current.dx, y: clientY - dragRef.current.dy }));
  };
  const endDrag = () => {
    dragRef.current.active = false;
    document.body.style.userSelect = "";
  };
  useEffect(() => {
    const mm = (e) => moveDrag(e.clientX, e.clientY);
    const mu = () => endDrag();
    const tm = (e) => {
      if (!e.touches[0]) return;
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    };
    const tu = () => endDrag();
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    window.addEventListener("touchmove", tm, { passive: false });
    window.addEventListener("touchend", tu);
    return () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("touchmove", tm);
      window.removeEventListener("touchend", tu);
    };
  }, []);

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

  // Mobile → CSS centers the popup via fixed inset; desktop → absolute
  // x/y from the centered initial position (and user drag).
  const mobile = isMobile();
  const containerStyle = mobile
    ? {
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: `min(${WIDTH}px, calc(100vw - 24px))`,
        maxHeight: "min(80dvh, 540px)",
      }
    : {
        position: "fixed",
        left: pos?.x ?? 0,
        top:  pos?.y ?? 0,
        width: WIDTH,
      };

  return (
    <div
      className="or-surface overflow-hidden z-[60]"
      style={{
        ...containerStyle,
        height: minimized ? 44 : (mobile ? "min(80dvh, 540px)" : HEIGHT),
        display: "flex", flexDirection: "column",
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        border: "1px solid var(--border-col)",
        transition: dragRef.current.active ? "none" : "height 0.18s ease-out",
      }}
      data-testid="floating-dm-window"
    >
      <header
        className={`px-3 py-2 flex items-center gap-2 ${mobile ? "" : "cursor-move"}`}
        style={{
          background: "color-mix(in srgb, var(--primary) 10%, var(--surface))",
          touchAction: mobile ? "auto" : "none",
        }}
        onMouseDown={(e) => { if (e.button === 0) beginDrag(e.clientX, e.clientY); }}
        onTouchStart={(e) => {
          if (mobile || !e.touches[0]) return;
          beginDrag(e.touches[0].clientX, e.touches[0].clientY);
        }}
        onDoubleClick={() => setMinimized((v) => !v)}
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
                <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
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
                  <div className="mt-1" style={{ maxWidth: "80%" }}>
                    <ReactionAttachment
                      mode="mongo"
                      targetType="dm_message"
                      targetId={m.id}
                      summary={m.reactions?.summary}
                      myReaction={m.reactions?.my_reaction}
                      pickerAlign={mine ? "right" : "left"}
                      pickerPosition="above"
                      barAlign={mine ? "end" : "start"}
                      barSize="xs"
                      triggerSize={11}
                      testIdPrefix={`floating-dm-reaction-${m.id}`}
                    />
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

// Constrain the popup position so it never escapes the viewport edges,
// accounting for the popup's own width/height + a small margin so
// minimize/close stay tappable.
function clamp({ x, y }) {
  if (typeof window === "undefined") return { x, y };
  const maxX = Math.max(MARGIN, window.innerWidth  - WIDTH  - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - HEIGHT - MARGIN);
  return {
    x: Math.max(MARGIN, Math.min(maxX, x)),
    y: Math.max(MARGIN, Math.min(maxY, y)),
  };
}
