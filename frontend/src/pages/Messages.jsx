import React, { useState, useRef, useEffect } from "react";
import { Send, Mic, Paperclip, Phone, Video } from "lucide-react";
import { MESSAGES_THREADS } from "@/data/mockData";

export default function Messages() {
  const [activeId, setActiveId] = useState(MESSAGES_THREADS[0]?.id);
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState(MESSAGES_THREADS);
  const endRef = useRef(null);
  const active = threads.find((t) => t.id === activeId);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeId, threads]);

  const send = () => {
    if (!draft.trim() || !active) return;
    const newMsg = { from: "me", text: draft.trim(), t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    setThreads((arr) => arr.map((t) => t.id === active.id ? { ...t, messages: [...t.messages, newMsg], last: newMsg.text, when: "now" } : t));
    setDraft("");
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="messages-page">
      <div className="mb-5">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Direct</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Messages</h1>
      </div>
      <div className="grid md:grid-cols-[300px_1fr] gap-4" style={{ height: "calc(100vh - 220px)" }}>
        {/* Threads */}
        <div className="or-surface overflow-y-auto" data-testid="messages-thread-list">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              data-testid={`messages-thread-${t.id}`}
              className="w-full flex items-center gap-3 p-3 text-left transition-colors"
              style={{
                background: activeId === t.id ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent",
                borderBottom: "1px solid var(--border-col)",
              }}
            >
              <div className="relative shrink-0">
                <img src={t.friend.avatar} alt="" className="rounded-full object-cover" style={{ width: 44, height: 44 }} />
                {t.friend.is_online && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full" style={{ background: "#10E670", border: "2px solid var(--surface)" }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold truncate" style={{ color: "var(--text-main)" }}>@{t.friend.handle}</span>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t.when}</span>
                </div>
                <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{t.last}</div>
              </div>
              {t.unread > 0 && (
                <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5" style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                  {t.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Active conversation */}
        <div className="or-surface flex flex-col">
          {active ? (
            <>
              <div className="flex items-center gap-3 p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
                <img src={active.friend.avatar} alt="" className="rounded-full object-cover" style={{ width: 40, height: 40 }} />
                <div className="flex-1">
                  <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{active.friend.handle}</div>
                  <div className="text-[11px]" style={{ color: active.friend.is_online ? "#10E670" : "var(--text-muted)" }}>
                    {active.friend.is_online ? "online · typing…" : "offline"}
                  </div>
                </div>
                <button className="or-btn or-btn-ghost" style={{ padding: "0.4rem 0.6rem" }} data-testid="messages-call"><Phone size={16} /></button>
                <button className="or-btn or-btn-ghost" style={{ padding: "0.4rem 0.6rem" }} data-testid="messages-video"><Video size={16} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="messages-conversation">
                {active.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[75%] px-3 py-2 text-sm"
                      style={{
                        background: m.from === "me" ? "var(--primary)" : "var(--surface-2)",
                        color: m.from === "me" ? "var(--primary-fg)" : "var(--text-main)",
                        borderRadius: "var(--radius)",
                      }}>
                      <div>{m.text}</div>
                      <div className="text-[10px] mt-1 opacity-70 text-right">{m.t} {m.from === "me" && "✓✓"}</div>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="p-3 flex items-center gap-2" style={{ borderTop: "1px solid var(--border-col)" }}>
                <button className="or-btn or-btn-ghost" style={{ padding: "0.4rem 0.5rem" }} data-testid="messages-attach"><Paperclip size={16} /></button>
                <button className="or-btn or-btn-ghost" style={{ padding: "0.4rem 0.5rem" }} data-testid="messages-voice"><Mic size={16} /></button>
                <input
                  className="or-input flex-1"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Message…"
                  data-testid="messages-input"
                />
                <button className="or-btn" onClick={send} data-testid="messages-send"><Send size={16} /></button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
