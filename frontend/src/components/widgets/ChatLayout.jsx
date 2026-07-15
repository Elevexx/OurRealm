/**
 * ChatLayout — Phase 3.5 conversational AI widget renderer.
 *
 * Renders a ChatGPT-style chat surface:
 *   • Header (title from data.title)
 *   • Conversation area (user bubbles right, AI bubbles left)
 *   • Quick-action chips (optional, from chat_cfg.quick_actions)
 *   • Multiline input + Send / Clear / Regenerate buttons
 *
 * All network IO goes through /api/widgets/chat/*. No OpenAI keys
 * ever touch the frontend. Founder-only enforcement is server-side.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";

const MAX_INPUT_CHARS = 8000;

export default function ChatLayout({ data, theme, widget }) {
  const chatCfg = useMemo(() => (widget?.editor_config?.chat) || {}, [widget]);
  // For registry-launched widgets the user's saved entry id (e.g.
  // ``w-chat-1``) is NOT the registry id; we must call the chat API
  // with the registry KEY so the backend can find the widget. Falls
  // back to the instance id for direct admin-builder previews.
  const widgetId = widget?.key || widget?.id || widget?._preview_widget_id;
  const memoryMode = (chatCfg.memory_mode || "persistent").toLowerCase();
  const enableStreaming = !!chatCfg.enable_streaming;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  // Load persisted history once on mount (only when widget has an id
  // and memory != off). Preview widgets without ID skip this.
  useEffect(() => {
    if (!widgetId || memoryMode === "off") return;
    let cancelled = false;
    (async () => {
      try {
        const { data: hist } = await apiClient.get(`/widgets/chat/history`, { params: { widget_id: widgetId } });
        if (!cancelled) setMessages(hist?.messages || []);
      } catch (e) {
        if (!cancelled) console.warn("chat history load failed", e?.response?.data || e);
      }
    })();
    return () => { cancelled = true; };
  }, [widgetId, memoryMode]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const send = useCallback(async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    if (!widgetId) {
      setError("Save the widget first to chat with it.");
      return;
    }
    setError(null);
    setBusy(true);
    // Optimistically render the user turn.
    const userTurn = { role: "user", content: msg, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, userTurn]);
    setInput("");

    if (enableStreaming) {
      try {
        const ok = await streamReply({
          widgetId,
          message: msg,
          onToken: (chunk, fullSoFar) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant" && last._streaming) {
                next[next.length - 1] = { ...last, content: fullSoFar };
              } else {
                next.push({ role: "assistant", content: fullSoFar, created_at: new Date().toISOString(), _streaming: true });
              }
              return next;
            });
          },
          onDone: (final) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant" && last._streaming) {
                next[next.length - 1] = { role: "assistant", content: final, created_at: new Date().toISOString() };
              }
              return next;
            });
          },
        });
        if (!ok) throw new Error("stream-failed");
      } catch (e) {
        // Fallback to non-streaming on any stream error.
        try {
          const { data: resp } = await apiClient.post(`/widgets/chat/message`, { widget_id: widgetId, message: msg });
          setMessages((prev) => [...prev.filter((m) => !m._streaming), { role: "assistant", content: resp.reply || "", created_at: new Date().toISOString() }]);
        } catch (e2) {
          setMessages((prev) => prev.filter((m) => !m._streaming));
          setError(e2?.response?.data?.detail || e2?.message || "Send failed");
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      const { data: resp } = await apiClient.post(`/widgets/chat/message`, { widget_id: widgetId, message: msg });
      const aiTurn = { role: "assistant", content: resp.reply || "", created_at: new Date().toISOString() };
      setMessages((prev) => [...prev, aiTurn]);
    } catch (e) {
      setMessages((prev) => prev.slice(0, -1));  // Roll back optimistic user turn.
      setInput(msg);  // Restore input so user can edit + retry.
      setError(e?.response?.data?.detail || e?.message || "Send failed");
    } finally {
      setBusy(false);
    }
  }, [input, busy, widgetId, enableStreaming]);

  const clearAll = useCallback(async () => {
    if (busy) return;
    setMessages([]);
    setError(null);
    if (!widgetId || memoryMode === "off") return;
    try { await apiClient.post(`/widgets/chat/clear`, { widget_id: widgetId }); }
    catch (e) { console.warn("clear failed", e?.response?.data || e); }
  }, [busy, widgetId, memoryMode]);

  const regenerate = useCallback(async () => {
    if (busy || !widgetId) return;
    setBusy(true);
    setError(null);
    // Optimistically drop the last assistant turn.
    setMessages((prev) => {
      const next = [...prev];
      if (next.length && next[next.length - 1].role === "assistant") next.pop();
      return next;
    });
    try {
      const { data: resp } = await apiClient.post(`/widgets/chat/regenerate`, { widget_id: widgetId });
      setMessages((prev) => [...prev, { role: "assistant", content: resp.reply || "", created_at: new Date().toISOString() }]);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Regenerate failed");
    } finally {
      setBusy(false);
    }
  }, [busy, widgetId]);

  const quickActions = chatCfg.quick_actions || [];

  return (
    <div className="h-full flex flex-col" data-testid="custom-layout-chat">
      <div className="px-2 py-1 flex items-center gap-2 border-b" style={{ borderColor: "var(--border-col)" }}>
        <div className="rounded-full p-1.5" style={{ background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary)" }}>
          <Icons.Sparkles size={12} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold truncate" style={{ color: "var(--text-main)" }}>{data.title || "AI Assistant"}</div>
          {chatCfg.model && (
            <div className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{chatCfg.model}</div>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearAll}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
            data-testid="chat-clear-btn"
            title="Clear conversation"
          >
            <Icons.Trash2 size={10} className="inline" />
          </button>
        )}
        {/* Phase 3.7.1 — quick launcher into the full-screen ORAi
            Command Center. Only renders for the founder, otherwise
            the link 404s and clutters the UI. The check is duplicated
            from /admin/orion (server-side gate) — that's fine. */}
        {(typeof window !== "undefined" &&
          ((JSON.parse(localStorage.getItem("auth_user") || "{}")?.username || "").toLowerCase() === "stealth")) && (
          <a
            href="/admin/orion"
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary)" }}
            data-testid="chat-open-command-center"
            title="Open ORAi Command Center"
          >
            <Icons.ExternalLink size={10} className="inline" />
          </a>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2 px-1 space-y-1.5" data-testid="chat-messages">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-2 gap-2">
            <Icons.MessageSquare size={22} style={{ color: "var(--text-muted)" }} />
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {chatCfg.system_prompt
                ? "Start chatting — your messages stay private."
                : "Configure a system prompt in the Chat tab to bring this widget to life."}
            </div>
            {quickActions.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1 pt-1">
                {quickActions.map((qa, i) => (
                  <button
                    key={i}
                    onClick={() => send(typeof qa === "string" ? qa : qa.prompt)}
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)", color: "var(--primary)" }}
                    data-testid={`chat-quick-${i}`}
                  >
                    {typeof qa === "string" ? qa : qa.label || qa.prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} content={m.content} streaming={m._streaming} />
        ))}

        {busy && !enableStreaming && (
          <div className="flex items-center gap-1.5 pl-2" data-testid="chat-typing">
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--primary)" }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--primary)", animationDelay: "120ms" }} />
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--primary)", animationDelay: "240ms" }} />
          </div>
        )}
      </div>

      {error && (
        <div className="text-[10px] px-2 py-1 mx-1 mb-1 rounded" style={{ background: "rgba(255,90,107,0.16)", color: "#FF8080" }} data-testid="chat-error">
          {error}
        </div>
      )}

      <div className="border-t flex items-end gap-1 p-1" style={{ borderColor: "var(--border-col)" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_CHARS))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={(data.input_placeholder) || "Ask anything…"}
          className="flex-1 resize-none text-xs px-2 py-1.5 rounded outline-none"
          style={{ background: "var(--surface-2)", color: "var(--text-main)", maxHeight: 80 }}
          disabled={busy}
          data-testid="chat-input"
        />
        {messages.some((m) => m.role === "assistant") && (
          <button
            onClick={regenerate}
            disabled={busy}
            className="text-[10px] px-1.5 py-1 rounded shrink-0"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
            data-testid="chat-regenerate-btn"
            title="Regenerate last response"
          >
            <Icons.RefreshCw size={11} />
          </button>
        )}
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="px-2 py-1 rounded text-[11px] shrink-0 font-bold"
          style={{ background: "var(--primary)", color: "#000", opacity: (busy || !input.trim()) ? 0.5 : 1 }}
          data-testid="chat-send-btn"
        >
          {busy ? <Icons.Loader2 size={11} className="animate-spin" /> : <Icons.Send size={11} />}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ChatBubble — user (right) / assistant (left) with markdown support.
// ─────────────────────────────────────────────────────────────────────

function ChatBubble({ role, content, streaming }) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      navigator.clipboard.writeText(content || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`} data-testid={`chat-bubble-${role}`}>
      <div
        className="max-w-[80%] rounded-lg px-2 py-1 text-xs leading-snug whitespace-pre-wrap break-words relative group"
        style={{
          background: isUser ? "var(--primary)" : "var(--surface-2)",
          color: isUser ? "#000" : "var(--text-main)",
        }}
      >
        {renderInline(content)}
        {streaming && <span className="inline-block w-1 h-3 ml-0.5 align-middle animate-pulse" style={{ background: "currentColor" }} />}
        {!isUser && content && (
          <button
            onClick={copy}
            className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition rounded p-0.5"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border-col)" }}
            data-testid="chat-bubble-copy"
            title={copied ? "Copied!" : "Copy"}
          >
            {copied ? <Icons.Check size={9} style={{ color: "var(--brand-green)" }} /> : <Icons.Copy size={9} style={{ color: "var(--text-muted)" }} />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Minimal markdown renderer (intentionally lightweight to avoid adding
 * a heavy dependency). Supports code fences ``` ``` and inline `code`.
 * Falls back to <pre> for fenced blocks and <code> for inline. Lines
 * starting with - become a bulleted item.
 */
function renderInline(text) {
  if (!text) return null;
  const parts = String(text).split(/(```[\s\S]*?```)/g);
  return parts.map((seg, i) => {
    if (seg.startsWith("```")) {
      const body = seg.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/```$/, "");
      return (
        <pre
          key={i}
          className="mt-1 mb-1 p-1.5 rounded text-[10px] overflow-x-auto"
          style={{ background: "var(--surface-1)", color: "var(--text-main)" }}
        >
          <code>{body}</code>
        </pre>
      );
    }
    // Inline code + bullets.
    const lines = seg.split("\n");
    return (
      <span key={i}>
        {lines.map((ln, j) => {
          const bullet = /^\s*[-*]\s+/.test(ln);
          const content = ln.replace(/`([^`]+)`/g, (_m, code) => `\u0000${code}\u0000`);
          const tokens = content.split("\u0000");
          return (
            <span key={j} style={{ display: "block", paddingLeft: bullet ? 10 : 0, position: "relative" }}>
              {bullet && <span style={{ position: "absolute", left: 0 }}>•</span>}
              {tokens.map((t, k) =>
                k % 2 === 1
                  ? <code key={k} className="px-1 rounded text-[10px]" style={{ background: "var(--surface-1)" }}>{t}</code>
                  : <span key={k}>{bullet && k === 0 ? t.replace(/^\s*[-*]\s+/, "") : t}</span>
              )}
            </span>
          );
        })}
      </span>
    );
  });
}

// ─────────────────────────────────────────────────────────────────────
// SSE streaming (Phase 3.5d) — POST EventSource via fetch + reader.
// ─────────────────────────────────────────────────────────────────────

async function streamReply({ widgetId, message, onToken, onDone }) {
  try {
    const apiUrl = `${process.env.REACT_APP_BACKEND_URL || ""}/api/widgets/chat/stream`;
    const token = (typeof localStorage !== "undefined") ? localStorage.getItem("ourrealm.access") : null;
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ widget_id: widgetId, message }),
    });
    if (!resp.ok || !resp.body) return false;
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames separated by \n\n.
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (payload === "[DONE]") { onDone(full); return true; }
        try {
          const obj = JSON.parse(payload);
          if (obj.delta) { full += obj.delta; onToken(obj.delta, full); }
          else if (obj.error) { return false; }
          else if (obj.done) { onDone(obj.full || full); return true; }
        } catch { /* ignore non-JSON frame */ }
      }
    }
    onDone(full);
    return true;
  } catch {
    return false;
  }
}
