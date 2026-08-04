import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, ArrowDownToLine } from "lucide-react";
import apiClient from "@/api/client";

/* Embedded ORAi chat — same backend endpoints + sessions as the global
   ORAi assistant (routers/orai_assistant.py). Not a duplicate engine. */
export const OraiProjectChat = ({ onUsePrompt }) => {
  const [allowed, setAllowed] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    apiClient.get("/orai/assistant/access")
      .then((r) => setAllowed(!!r.data?.allowed))
      .catch(() => setAllowed(false));
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    onUsePrompt?.(msg, { silent: true });
    setBusy(true);
    try {
      const { data } = await apiClient.post("/orai/assistant/chat", {
        message: msg, session_id: sessionRef.current,
        context: { page: "orai_projects", device: window.innerWidth < 640 ? "mobile" : "desktop" },
      });
      sessionRef.current = data.session_id;
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (e) {
      const d = e?.response?.data?.detail;
      setMessages((m) => [...m, { role: "assistant", error: true,
        content: (typeof d === "string" ? d : d?.message) || "ORAi hit a snag — try again." }]);
    } finally { setBusy(false); }
  }, [input, busy, onUsePrompt]);

  if (allowed === false) return null;

  return (
    <div className="or-surface p-3 sm:p-4" data-testid="orai-project-chat">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} style={{ color: "#C26BFF" }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#C26BFF" }}>
          ORAi Chat
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          — describe your project; your prompt fills the Project Summary
        </span>
      </div>
      {messages.length > 0 && (
        <div ref={scrollRef} className="max-h-56 overflow-y-auto space-y-2 mb-2 pr-1" data-testid="orai-chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`text-xs leading-relaxed rounded-lg px-3 py-2 ${m.role === "user" ? "ml-8" : "mr-4"}`}
              style={{ background: m.role === "user" ? "rgba(194,107,255,.12)" : "rgba(255,255,255,.04)",
                       color: m.error ? "#FF6B6B" : "var(--text-primary)" }}>
              {m.content}
              {m.role === "user" && (
                <button className="block mt-1 text-[10px] underline opacity-70 hover:opacity-100"
                  data-testid={`chat-use-prompt-${i}`}
                  onClick={() => onUsePrompt?.(m.content)}>
                  <ArrowDownToLine size={9} className="inline mr-0.5" />Use as project prompt
                </button>
              )}
            </div>
          ))}
          {busy && <div className="text-[10px] animate-pulse" style={{ color: "var(--text-muted)" }}>ORAi is thinking…</div>}
        </div>
      )}
      <div className="flex gap-2">
        <input className="or-input flex-1 text-sm" placeholder="Ask ORAi… e.g. 'An illustrated space story with narration'"
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={allowed === null} data-testid="orai-chat-input" aria-label="ORAi chat message" />
        <button className="or-btn px-4" onClick={send} disabled={busy || !input.trim()}
          data-testid="orai-chat-send" aria-label="Send message">
          <Send size={14} />
        </button>
      </div>
    </div>
  );
};

export default OraiProjectChat;
