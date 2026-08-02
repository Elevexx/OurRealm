import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles, X, Send, Loader2, Volume2, Crown, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { oraiVoice } from "@/lib/oraiVoiceEngine";

// Private ORAi Operating Assistant — server-gated. Users without an access
// grant see NOTHING (no button, no placeholder). Every request is
// re-validated server-side, so revocation is instant.
function ctxFromPath(path) {
  const ctx = { path };
  let m = path.match(/\/responsibility-center\/([a-z0-9-]+)/i);
  if (m && m[1] !== "create") ctx.center_id = m[1];
  m = path.match(/\/courses\/([a-z0-9-]+)/i);
  if (m) ctx.course_id = m[1];
  return ctx;
}

const FOUNDER_SHORTCUTS = [
  { id: "orai_admin", label: "ORAi Admin", to: "/admin/orai" },
  { id: "ai_dashboard", label: "AI Dashboard", to: "/admin/orai", state: { section: "ai-usage" } },
  { id: "ai_queue", label: "AI Queue", to: "/admin/ai-video" },
  { id: "video_queue", label: "Video Queue", to: "/admin/ai-video" },
  { id: "provider_health", label: "Provider Health", to: "/admin/ai-video" },
  { id: "command_center", label: "Command Center", to: "/admin" },
];

function FounderStrip({ onNavigate }) {
  const [spend, setSpend] = useState(null);
  useEffect(() => {
    apiClient.get("/admin/ai-video/analytics")
      .then((r) => setSpend(r.data.spend)).catch(() => {});
  }, []);
  const go = (s) => {
    apiClient.post("/orai/assistant/log-shortcut", { id: s.id }).catch(() => {});
    onNavigate(s.to, s.state);
  };
  const emergency = async () => {
    if (!window.confirm("EMERGENCY DISABLE all AI video generation right now?")) return;
    try {
      await apiClient.patch("/admin/ai-video/settings",
        { emergency_disabled: true, reason: "Emergency disable via ORAi founder shortcut" });
      apiClient.post("/orai/assistant/log-shortcut", { id: "emergency_disable" }).catch(() => {});
      toast.success("AI video generation emergency-disabled");
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="px-3 pt-2 pb-1" data-testid="orai-founder-strip">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#F4A73B" }}>
        <Crown size={11} /> Founder
        {spend && <span className="ml-auto normal-case tracking-normal" style={{ color: "var(--text-muted)" }}>
          AI spend today: ${spend.daily_spent.toFixed(2)}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {FOUNDER_SHORTCUTS.map((s) => (
          <button key={s.id} className="text-[9.5px] px-2 py-1 rounded-full"
            style={{ background: "rgba(244,167,59,0.12)", border: "1px solid rgba(244,167,59,0.35)", color: "#F4A73B" }}
            onClick={() => go(s)} data-testid={`orai-shortcut-${s.id}`}>{s.label}</button>
        ))}
        <button className="text-[9.5px] px-2 py-1 rounded-full flex items-center gap-1"
          style={{ background: "rgba(255,107,107,0.12)", border: "1px solid rgba(255,107,107,0.4)", color: "#FF6B6B" }}
          onClick={emergency} data-testid="orai-shortcut-emergency">
          <ShieldAlert size={10} /> Emergency Disable
        </button>
      </div>
    </div>
  );
}

export default function OraiAssistantPanel() {
  const { user } = useAuth();
  const { mode: theme } = useTheme() || {};
  const location = useLocation();
  const navigate = useNavigate();
  const [access, setAccess] = useState(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const sessionRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const lastMsgRef = useRef("");

  useEffect(() => {
    if (!user) { setAccess(null); return; }
    apiClient.get("/orai/assistant/access")
      .then((r) => setAccess(r.data))
      .catch(() => setAccess({ allowed: false }));
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [messages, open, busy]);

  const revoke = useCallback(() => {
    // Access revoked mid-session: close + hide everything, no explanation.
    setOpen(false);
    setAccess({ allowed: false });
    setMessages([]);
    sessionRef.current = null;
  }, []);

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
      if (e?.response?.status === 403) { revoke(); return; }
      const d = e?.response?.data?.detail;
      setMessages((m) => [...m, { role: "assistant", error: true,
        content: (typeof d === "string" ? d : d?.message) || "ORAi hit a snag — try again.",
        actions: [{ id: "retry", label: "Retry", kind: "client", op: "retry" }] }]);
    } finally { setBusy(false); }
  }, [input, busy, location.pathname, theme, revoke]);

  const speak = async (text) => {
    if (speaking || oraiVoice.state === "speaking") { oraiVoice.stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    try { await oraiVoice.speak(text); }
    catch { toast.error("ORAi voice is unavailable right now"); }
    finally { setSpeaking(false); }
  };

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
        if (e?.response?.status === 403) { revoke(); return; }
        toast.error(e?.response?.data?.detail?.message || e?.response?.data?.detail || `${a.label} failed`);
      }
    }
  };

  // Unauthorized users get absolutely nothing — no button, no placeholder.
  if (!user || !access?.allowed) return null;

  return (
    <>
      <style>{`
        @keyframes oraiPanelIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .orai-panel-anim { animation: oraiPanelIn 0.22s ease-out; }
      `}</style>
      <button onClick={() => setOpen(!open)} aria-label="Open ORAi assistant"
        className="fixed z-[70] bottom-20 right-4 sm:bottom-6 sm:right-6 w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #2EA0FF, #C26BFF)", boxShadow: "0 4px 20px rgba(46,160,255,0.45)",
                 marginBottom: "env(safe-area-inset-bottom, 0px)", transition: "transform 0.15s ease" }}
        data-testid="orai-assistant-fab">
        {open ? <X size={20} color="#fff" /> : <Sparkles size={20} color="#fff" />}
      </button>

      {open && (
        <div className="orai-panel-anim fixed z-[71] inset-x-0 bottom-0 w-full rounded-t-2xl sm:inset-x-auto sm:bottom-20 sm:right-6 sm:w-[380px] sm:rounded-2xl flex flex-col or-surface overflow-hidden"
          style={{ height: "min(560px, 72dvh)", maxWidth: "100vw",
                   border: "1px solid rgba(46,160,255,0.35)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                   paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          data-testid="orai-assistant-panel">
          <div className="flex items-center gap-2 p-3 shrink-0" style={{ borderBottom: "1px solid var(--border-col)" }}>
            <Sparkles size={16} style={{ color: "#C26BFF" }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold">ORAi Assistant</div>
              <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>Page-aware · live platform data · smart actions</div>
            </div>
            <button className="or-btn or-btn-ghost p-1" onClick={() => setOpen(false)} aria-label="Close" data-testid="orai-assistant-close"><X size={15} /></button>
          </div>

          {access.is_founder && <FounderStrip onNavigate={(to, state) => { navigate(to, state ? { state } : undefined); setOpen(false); }} />}

          <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Ask me anything — "How many users do we have?", "Open analytics",
                or questions about this page.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <div className={`text-xs whitespace-pre-wrap break-words px-3 py-2 rounded-xl ${m.role === "user" ? "ml-8" : "mr-6"}`}
                  style={{ background: m.role === "user" ? "rgba(46,160,255,0.15)" : m.error ? "rgba(255,107,107,0.1)" : "rgba(255,255,255,0.05)" }}
                  data-testid={`orai-msg-${i}`}>
                  {m.content}
                  {m.role === "assistant" && !m.error && access.voice_enabled && (
                    <button className="block mt-1.5 text-[9px] font-bold flex items-center gap-1" style={{ color: "#FF8A5A" }}
                      onClick={() => speak(m.content)} data-testid={`orai-speak-${i}`}>
                      <Volume2 size={10} /> {speaking ? "Stop" : "Listen"}
                    </button>
                  )}
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

          <div className="p-2 flex gap-2 shrink-0" style={{ borderTop: "1px solid var(--border-col)" }}>
            <input ref={inputRef} className="or-input text-xs flex-1 min-w-0" placeholder="Ask ORAi…" value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              data-testid="orai-assistant-input" />
            <button className="or-btn p-2 shrink-0" style={{ background: "var(--brand-blue)", color: "#fff" }}
              disabled={busy || !input.trim()} onClick={() => send()} aria-label="Send" data-testid="orai-assistant-send">
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
