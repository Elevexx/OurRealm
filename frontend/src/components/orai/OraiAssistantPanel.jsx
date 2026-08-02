import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

// ORAi Operating Assistant — global, page-aware, with smart action buttons.
// Extends existing ORAi (RcOraiPanel untouched). Backend validates every
// action against the signed-in user's real permissions.
function ctxFromPath(path) {
  const ctx = { path };
  let m = path.match(/\/responsibility-center\/([a-z0-9-]+)/i);
  if (m && m[1] !== "create") ctx.center_id = m[1];
  m = path.match(/\/courses\/([a-z0-9-]+)/i);
  if (m) ctx.course_id = m[1];
  return ctx;
}

export default function OraiAssistantPanel() {
  const { user } = useAuth();
  const { mode: theme } = useTheme() || {};
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef(null);
  const scrollRef = useRef(null);
  const lastMsgRef = useRef("");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [messages, open]);

  const send = useCallback(async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    lastMsgRef.current = msg;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setBusy(true);
    try {
      const { data } = await apiClient.post("/orai/assistant/chat", {
        message: msg,
        session_id: sessionRef.current,
        context: {
          ...ctxFromPath(location.pathname),
          theme: theme || undefined,
          device: window.innerWidth < 640 ? "mobile" : "desktop",
        },
      });
      sessionRef.current = data.session_id;
      setMessages((m) => [...m, { role: "assistant", content: data.reply, actions: data.actions || [] }]);
    } catch (e) {
      const d = e?.response?.data?.detail;
      setMessages((m) => [...m, { role: "assistant", error: true,
        content: (typeof d === "string" ? d : d?.message) || "ORAi hit a snag — try again.",
        actions: [{ id: "retry", label: "Retry", kind: "client", op: "retry" }] }]);
    } finally { setBusy(false); }
  }, [input, busy, location.pathname, theme]);

  const runAction = async (a) => {
    if (a.kind === "navigate") { navigate(a.to); setOpen(false); return; }
    if (a.kind === "client") {
      if (a.op === "retry") send(lastMsgRef.current);
      if (a.op === "refresh") window.location.reload();
      return;
    }
    if (a.kind === "api") {
      if (a.confirm && !window.confirm(a.confirm)) return;
      try {
        const method = (a.method || "POST").toLowerCase();
        await apiClient[method](a.path, a.body || {});
        toast.success(`${a.label} — done`);
        setMessages((m) => [...m, { role: "assistant", content: `✓ ${a.label} completed.`, actions: [] }]);
      } catch (e) {
        toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || `${a.label} failed`);
      }
    }
  };

  if (!user) return null;

  return (
    <>
      <button onClick={() => setOpen(!open)} aria-label="Open ORAi assistant"
        className="fixed z-[70] bottom-20 right-4 sm:bottom-6 sm:right-6 w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #2EA0FF, #C26BFF)", boxShadow: "0 4px 20px rgba(46,160,255,0.45)" }}
        data-testid="orai-assistant-fab">
        {open ? <X size={20} color="#fff" /> : <Sparkles size={20} color="#fff" />}
      </button>

      {open && (
        <div className="fixed z-[70] bottom-36 right-4 sm:bottom-20 sm:right-6 w-[calc(100vw-2rem)] sm:w-[380px] flex flex-col or-surface"
          style={{ height: "min(520px, 65vh)", border: "1px solid rgba(46,160,255,0.35)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}
          data-testid="orai-assistant-panel">
          <div className="flex items-center gap-2 p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
            <Sparkles size={16} style={{ color: "#C26BFF" }} />
            <div className="flex-1">
              <div className="text-sm font-bold">ORAi Assistant</div>
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Page-aware · live platform data · smart actions</div>
            </div>
            <button className="or-btn or-btn-ghost p-1" onClick={() => setOpen(false)} aria-label="Close" data-testid="orai-assistant-close"><X size={15} /></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Ask me anything — "How many users do we have?", "Open analytics", "Pause signups",
                "Generate a course", or questions about this page.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <div className={`text-xs whitespace-pre-wrap px-3 py-2 rounded-xl ${m.role === "user" ? "ml-8" : "mr-6"}`}
                  style={{ background: m.role === "user" ? "rgba(46,160,255,0.15)" : m.error ? "rgba(255,107,107,0.1)" : "rgba(255,255,255,0.05)" }}
                  data-testid={`orai-msg-${i}`}>
                  {m.content}
                </div>
                {(m.actions || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid={`orai-actions-${i}`}>
                    {m.actions.map((a) => (
                      <button key={a.id} className="or-btn text-[10px] font-bold"
                        style={{ background: a.kind === "api" ? "rgba(244,167,59,0.2)" : "rgba(46,160,255,0.2)",
                                 color: a.kind === "api" ? "#F4A73B" : "var(--brand-blue)" }}
                        onClick={() => runAction(a)} data-testid={`orai-action-${a.id}`}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <Loader2 size={15} className="animate-spin" style={{ color: "#C26BFF" }} />}
          </div>

          <div className="p-2 flex gap-2" style={{ borderTop: "1px solid var(--border-col)" }}>
            <input className="or-input text-xs flex-1" placeholder="Ask ORAi…" value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              data-testid="orai-assistant-input" />
            <button className="or-btn p-2" style={{ background: "var(--brand-blue)", color: "#fff" }}
              disabled={busy || !input.trim()} onClick={() => send()} aria-label="Send" data-testid="orai-assistant-send">
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
