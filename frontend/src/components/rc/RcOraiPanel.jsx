import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X, Plus, Send, Trash2, Bot } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { OraiVoiceBar } from "@/components/orai/OraiVoiceBar";

const PROMPTS = [
  "What needs my attention today?",
  "Summarize this week's progress",
  "Suggest the next responsibilities to assign",
  "Draft a short announcement for the members",
];

const renderMd = (text) => {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>);
};

// ORAi — per-Center assistant panel. Suggestions only; every chat stored.
export const RcOraiPanel = ({ centerId, centerName, open, onClose }) => {
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  const loadSessions = useCallback(() => {
    apiClient.get(`/responsibility-center/${centerId}/orai/sessions`)
      .then((r) => setSessions(r.data.sessions || [])).catch(() => {});
  }, [centerId]);

  useEffect(() => { if (open) { loadSessions(); } }, [open, loadSessions]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const openSession = async (sid) => {
    setSessionId(sid);
    if (!sid) { setMessages([]); return; }
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/orai/sessions/${sid}/messages`);
      setMessages(r.data.messages || []);
    } catch { setMessages([]); }
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || busy) return null;
    setInput("");
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content: msg }]);
    setBusy(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/orai/chat`,
        { session_id: sessionId, message: msg });
      setSessionId(r.data.session_id);
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: "assistant", content: r.data.reply }]);
      loadSessions();
      return r.data.reply;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "ORAi is unavailable right now");
      setMessages((m) => m.slice(0, -1));
      setInput(msg);
      return null;
    } finally { setBusy(false); }
  };

  const removeSession = async (sid) => {
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await apiClient.delete(`/responsibility-center/${centerId}/orai/sessions/${sid}`);
      if (sid === sessionId) { setSessionId(null); setMessages([]); }
      loadSessions();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not delete"); }
  };

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end" style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose} data-testid="rc-orai-overlay">
      <div className="h-full w-full sm:w-[440px] flex flex-col rcx-scope"
        style={{ background: "color-mix(in srgb, var(--bgc) 82%, #060D18)", borderLeft: "1px solid rgba(46,160,255,0.35)" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ORAi assistant" data-testid="rc-orai-panel">
        {/* Header */}
        <div className="flex items-center gap-2 p-3" style={{ borderBottom: "1px solid rgba(46,160,255,0.25)" }}>
          <span className="rounded-lg p-1.5" style={{ background: "rgba(194,107,255,0.15)", color: "#C26BFF" }}><Sparkles size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>ORAi</div>
            <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{centerName} · suggestions only</div>
          </div>
          <button className="or-btn or-btn-ghost p-1.5 text-xs" onClick={() => openSession(null)} title="New conversation" data-testid="rc-orai-new">
            <Plus size={14} />
          </button>
          <button className="or-btn or-btn-ghost p-1.5" onClick={onClose} aria-label="Close ORAi" data-testid="rc-orai-close">
            <X size={16} />
          </button>
        </div>

        {/* Session chips */}
        {!!sessions.length && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar p-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            data-testid="rc-orai-sessions">
            {sessions.map((s) => (
              <span key={s.id} className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-1 rounded-full cursor-pointer"
                style={{ background: s.id === sessionId ? "rgba(46,160,255,0.18)" : "rgba(255,255,255,0.05)",
                  border: s.id === sessionId ? "1px solid rgba(46,160,255,0.5)" : "1px solid rgba(255,255,255,0.1)" }}
                onClick={() => openSession(s.id)} data-testid={`rc-orai-session-${s.id}`}>
                {s.title?.slice(0, 24) || "Chat"}
                <button className="p-0.5" onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                  aria-label="Delete conversation" data-testid={`rc-orai-session-del-${s.id}`}><Trash2 size={9} /></button>
              </span>
            ))}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="rc-orai-messages">
          {messages.length === 0 && (
            <div className="text-center pt-8" data-testid="rc-orai-empty">
              <Bot size={34} className="mx-auto mb-2" style={{ color: "#C26BFF" }} />
              <div className="text-sm font-semibold mb-1">Ask ORAi about this Center</div>
              <div className="text-[11px] mb-4" style={{ color: "var(--text-muted)" }}>
                It knows your Center's real tasks, calendar, and activity — filtered by your permissions.
              </div>
              <div className="flex flex-col gap-1.5 items-stretch px-4">
                {PROMPTS.map((p) => (
                  <button key={p} className="text-[11px] text-left px-3 py-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{ background: "rgba(194,107,255,0.06)", border: "1px solid rgba(194,107,255,0.25)" }}
                    onClick={() => send(p)} data-testid={`rc-orai-prompt-${PROMPTS.indexOf(p)}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[85%] rounded-xl px-3 py-2 text-[12px] whitespace-pre-wrap"
                style={m.role === "user"
                  ? { background: "rgba(46,160,255,0.16)", border: "1px solid rgba(46,160,255,0.35)" }
                  : { background: "rgba(194,107,255,0.08)", border: "1px solid rgba(194,107,255,0.25)" }}
                data-testid={`rc-orai-msg-${m.role}`}>
                {renderMd(m.content)}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-1.5 text-[11px] px-1" style={{ color: "var(--text-muted)" }} data-testid="rc-orai-thinking">
              <Sparkles size={12} className="animate-pulse" style={{ color: "#C26BFF" }} /> ORAi is thinking…
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-3" style={{ borderTop: "1px solid rgba(46,160,255,0.25)" }}>
          <OraiVoiceBar onSubmit={(t) => send(t)} accent="#C26BFF" testidPrefix="rc-orai" />
          <div className="flex gap-2">
            <input className="or-input flex-1 text-sm" value={input} maxLength={4000}
              placeholder="Ask ORAi…" disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              aria-label="Message ORAi" data-testid="rc-orai-input" />
            <button className="or-btn px-3" disabled={busy || !input.trim()} onClick={() => send()}
              aria-label="Send" data-testid="rc-orai-send"><Send size={14} /></button>
          </div>
          <div className="text-[9px] mt-1.5" style={{ color: "var(--text-muted)" }} data-testid="rc-orai-disclaimer">
            ORAi offers suggestions only — it never performs actions. Conversations are stored with your Center records.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
