/**
 * MessagingPopupProvider — single global stack manager for every
 * messaging popup across OurRealm (DM popups, realm member chats,
 * Messenger pop-outs, anything future).
 *
 * Usage from any component:
 *   const { openDM, close, minimize } = useMessagingPopups();
 *   openDM(peer);                  // open or focus a popup
 *
 * Behavior:
 *   • Every popup opens centered (mobile: fixed-center; desktop:
 *     translate-centered + draggable from header).
 *   • Multiple popups cascade in a (32, 32) offset stack capped at
 *     four columns so they don't escape the viewport.
 *   • Clicking a popup focuses it (raises z-index above siblings).
 *   • Close removes the popup and CLEARS its remembered position; the
 *     next open of the same peer re-centers (per product spec).
 *   • Minimize collapses to a 44-px header dock; position is preserved
 *     in-memory while the popup remains in the stack.
 *   • Esc closes the focused popup. Focus trap stays inside the popup
 *     while it's open.
 *   • Mobile (<640px): every popup forces centered + no drag; the
 *     stack collapses to one visible popup at a time (others stay open
 *     in memory and can be re-opened via reopen()).
 *
 * Visual: identical bubble/header/composer as the previous
 * `FloatingDMWindow.jsx`. No new design tokens. Existing
 * `/api/messages/thread/:username` + `/api/messages` endpoints are
 * the source of truth — no parallel messaging path.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect,
  useMemo, useRef, useState,
} from "react";
import { X, Minus, Send, Loader2, MessageCircle } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const Ctx = createContext(null);
export const useMessagingPopups = () => useContext(Ctx);

const W = 340, H = 460, MARGIN = 12;
const isMobile = () => typeof window !== "undefined" && window.innerWidth < 640;
const clamp = ({ x, y }) => {
  if (typeof window === "undefined") return { x, y };
  const maxX = Math.max(MARGIN, window.innerWidth - W - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - H - MARGIN);
  return { x: Math.max(MARGIN, Math.min(maxX, x)), y: Math.max(MARGIN, Math.min(maxY, y)) };
};
const centeredFor = (i) => {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  const baseX = Math.max(MARGIN, Math.round((window.innerWidth - W) / 2));
  const baseY = Math.max(MARGIN, Math.round((window.innerHeight - H) / 2));
  // Cascade so a stack of popups doesn't fully overlap.
  return clamp({ x: baseX + (i % 4) * 32, y: baseY + (i % 4) * 32 });
};

export default function MessagingPopupProvider({ children }) {
  // popups: [{ id, peer, pos, minimized, focusZ }]
  const [popups, setPopups] = useState([]);
  const focusRef = useRef(0);

  const openDM = useCallback((peer) => {
    if (!peer?.username) return;
    setPopups((prev) => {
      // Already open → focus it; reset position to a fresh center so
      // the user sees movement (spec: "reopening resets to center").
      const i = prev.findIndex((p) => p.peer.username === peer.username);
      focusRef.current += 1;
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], minimized: false, pos: centeredFor(prev.length - 1), focusZ: focusRef.current };
        return next;
      }
      return [
        ...prev,
        { id: peer.username, peer, pos: centeredFor(prev.length), minimized: false, focusZ: focusRef.current },
      ];
    });
  }, []);

  const close = useCallback((id) => {
    setPopups((prev) => prev.filter((p) => p.id !== id));
  }, []);
  const setPos = useCallback((id, pos) => {
    setPopups((prev) => prev.map((p) => p.id === id ? { ...p, pos } : p));
  }, []);
  const setMinimized = useCallback((id, v) => {
    setPopups((prev) => prev.map((p) => p.id === id ? { ...p, minimized: v } : p));
  }, []);
  const focus = useCallback((id) => {
    focusRef.current += 1;
    const z = focusRef.current;
    setPopups((prev) => prev.map((p) => p.id === id ? { ...p, focusZ: z } : p));
  }, []);

  // Esc closes the top-most popup.
  useEffect(() => {
    const h = (e) => {
      if (e.key !== "Escape" || !popups.length) return;
      const top = popups.slice().sort((a, b) => b.focusZ - a.focusZ)[0];
      if (top) close(top.id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [popups, close]);

  const api = useMemo(() => ({ openDM, close, focus, popups }), [openDM, close, focus, popups]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="popup-layer" aria-live="polite" data-testid="messaging-popup-layer">
        {popups.map((p) => (
          <PopupShell
            key={p.id}
            popup={p}
            onClose={() => close(p.id)}
            onFocus={() => focus(p.id)}
            onMove={(pos) => setPos(p.id, pos)}
            onMinimize={(v) => setMinimized(p.id, v)}
          />
        ))}
      </div>
    </Ctx.Provider>
  );
}


// ─── Single popup shell ─────────────────────────────────────────────
function PopupShell({ popup, onClose, onFocus, onMove, onMinimize }) {
  const { user } = useAuth();
  const { peer, pos, minimized, focusZ } = popup;
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const pollRef = useRef(null);
  const dragRef = useRef({ active: false, dx: 0, dy: 0 });

  // Center fresh on mount.
  useLayoutEffect(() => {
    if (isMobile()) return;
    onMove(clamp(pos));
  }, [peer.username]);

  // Load + poll the existing DM thread.
  useEffect(() => {
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
  }, [peer.username]);

  // Re-clamp on window resize.
  useEffect(() => {
    const onResize = () => {
      if (isMobile()) return;
      onMove(clamp(pos));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos.x, pos.y]);

  // Drag handlers — desktop only, header bar only.
  const beginDrag = (cx, cy) => {
    if (isMobile() || minimized) return;
    dragRef.current = { active: true, dx: cx - pos.x, dy: cy - pos.y };
    document.body.style.userSelect = "none";
    onFocus();
  };
  useEffect(() => {
    const mm = (e) => {
      if (!dragRef.current.active) return;
      onMove(clamp({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy }));
    };
    const tm = (e) => {
      if (!dragRef.current.active || !e.touches[0]) return;
      onMove(clamp({ x: e.touches[0].clientX - dragRef.current.dx, y: e.touches[0].clientY - dragRef.current.dy }));
    };
    const end = () => { dragRef.current.active = false; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", tm, { passive: false });
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", tm);
      window.removeEventListener("touchend", end);
    };
  }, []);

  // Auto-scroll.
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
      if (msg && msg.id) setMessages((p) => p.find((m) => m.id === msg.id) ? p : [...p, msg]);
      setDraft("");
    } catch { /* */ } finally { setSending(false); }
  };

  const mobile = isMobile();
  const containerStyle = mobile
    ? { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: `min(${W}px, calc(100vw - 24px))`, maxHeight: "min(80dvh, 540px)" }
    : { position: "fixed", left: pos.x, top: pos.y, width: W };

  return (
    <div
      role="dialog"
      aria-label={`Conversation with ${peer.display_name || peer.username}`}
      className="or-surface overflow-hidden"
      style={{
        ...containerStyle,
        height: minimized ? 44 : (mobile ? "min(80dvh, 540px)" : H),
        display: "flex", flexDirection: "column",
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        border: "1px solid var(--border-col)",
        transition: dragRef.current.active ? "none" : "height 0.18s ease-out",
        zIndex: 60 + (focusZ % 1000),
      }}
      onMouseDown={onFocus}
      data-testid={`floating-dm-window-${peer.username}`}
    >
      <header
        className={`px-3 py-2 flex items-center gap-2 ${mobile ? "" : "cursor-move"}`}
        style={{ background: "color-mix(in srgb, var(--primary) 10%, var(--surface))", touchAction: mobile ? "auto" : "none" }}
        onMouseDown={(e) => { if (e.button === 0) beginDrag(e.clientX, e.clientY); }}
        onTouchStart={(e) => { if (mobile || !e.touches[0]) return; beginDrag(e.touches[0].clientX, e.touches[0].clientY); }}
        onDoubleClick={() => onMinimize(!minimized)}
        data-testid="floating-dm-header"
      >
        <div className="relative shrink-0">
          <img src={peer.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full" style={{ width: 22, height: 22 }} />
          {peer.is_online && (
            <span aria-hidden style={{
              position: "absolute", right: -1, bottom: -1, width: 7, height: 7, borderRadius: "50%",
              background: "var(--brand-green)", border: "2px solid var(--surface)",
              animation: "or-pulse-soft 3s ease-out infinite", "--orp-color": "var(--brand-green)",
            }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: "var(--text-main)" }}>{peer.display_name || peer.username}</div>
          <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>@{peer.username}</div>
        </div>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={() => onMinimize(!minimized)} className="or-chip" data-testid="floating-dm-minimize" title={minimized ? "Open" : "Minimize"}><Minus size={12} /></button>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} className="or-chip" data-testid="floating-dm-close" title="Close"><X size={12} /></button>
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
                    <div className="text-[10px] mt-0.5 opacity-70 text-right">{m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</div>
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
              autoFocus
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
