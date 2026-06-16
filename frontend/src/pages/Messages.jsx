import React, { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Search, Sliders, Pin, MessagesSquare, Users, Radio, Users2, Phone, Settings as SettingsIcon, Plus, Send, Mic, Paperclip, X, ChevronRight, Crown, UserPlus, AlertTriangle } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { CHARACTERS, PINNED_CONVERSATIONS, GROUP_CHATS, DIRECT_MESSAGES, CURRENT_PERSONA } from "@/data/mockData";

const SIDEBAR = [
  { id: "chats",    label: "Chats",    Icon: MessagesSquare, badge: null },
  { id: "groups",   label: "Groups",   Icon: Users,           badge: null },
  { id: "lives",    label: "Lives",    Icon: Radio,           badge: 12 },
  { id: "people",   label: "People",   Icon: Users2,          badge: null },
  { id: "calls",    label: "Calls",    Icon: Phone,           badge: null },
  { id: "settings", label: "Settings", Icon: SettingsIcon,    badge: null },
];

function StatusRing({ character, size = 76 }) {
  const isLive = character.status === "live";
  const ringColor = character.ringColor;
  return (
    <div
      className="rounded-full p-[3px] relative"
      style={{
        background: ringColor,
        boxShadow: `0 0 14px ${ringColor}55`,
        width: size, height: size,
      }}
    >
      <img
        src={character.avatar}
        alt={character.name}
        className="w-full h-full rounded-full object-cover"
        style={{ border: "3px solid var(--bgc)" }}
      />
      {isLive && (
        <span
          className="absolute -top-1 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[9px] font-extrabold rounded-full"
          style={{ background: "#FF3F5A", color: "#fff", letterSpacing: "0.08em" }}
        >
          LIVE
        </span>
      )}
      {character.status === "in-app" && (
        <span
          className="absolute top-0 right-0 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ background: "#2EA0FF", border: "2px solid var(--bgc)" }}
        >
          <span className="text-white text-[10px]">···</span>
        </span>
      )}
      {character.status === "online" && (
        <span
          className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full"
          style={{ background: "#10E670", border: "2px solid var(--bgc)" }}
        />
      )}
    </div>
  );
}

export default function Messages() {
  const [tab, setTab] = useState("chats");
  const [activeChat, setActiveChat] = useState(null); // null = list view, else thread id
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState({
    "dm-1": [
      { from: "them", text: "Going live in 5 mins! 🔥", t: "9:48 PM" },
      { from: "me",   text: "🔥🔥 see you there",      t: "9:49 PM" },
    ],
  });

  // Real friends-only DM overlay (?to=username)
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toUsername = searchParams.get("to");
  const [realThread, setRealThread] = useState(null); // {messages: [], target, allowed, reason}
  const [realDraft, setRealDraft] = useState("");
  const [realErr, setRealErr] = useState("");
  const [realBusy, setRealBusy] = useState(false);
  // Edit + long-press delete state
  const [msgMenu, setMsgMenu] = useState(null);      // {id, text, x, y}
  const [editingMsg, setEditingMsg] = useState(null); // {id, text}
  const [editDraft, setEditDraft] = useState("");
  const longPressTimer = useRef(null);
  const realEndRef = useRef(null);

  const loadRealThread = async (username) => {
    setRealErr("");
    try {
      const can = await apiClient.get(`/messages/can-message/${username}`);
      if (!can.data.allowed) {
        setRealThread({ target: username, allowed: false, reason: can.data.reason, messages: [] });
        return;
      }
      const t = await apiClient.get(`/messages/thread/${username}`);
      setRealThread({ target: username, allowed: true, messages: t.data.messages || [] });
    } catch (e) {
      setRealThread({ target: username, allowed: false, reason: "error", messages: [] });
      setRealErr(e.response?.data?.detail || "Could not open chat");
    }
  };

  useEffect(() => {
    if (toUsername && user) loadRealThread(toUsername);
    if (!toUsername) setRealThread(null);
  }, [toUsername, user]);

  useEffect(() => { realEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [realThread?.messages?.length]);

  const sendReal = async () => {
    if (!realThread?.allowed || !realDraft.trim()) return;
    setRealBusy(true);
    try {
      const { data } = await apiClient.post("/messages", { to_username: realThread.target, text: realDraft.trim() });
      setRealThread((rt) => ({ ...rt, messages: [...(rt.messages || []), data.message] }));
      setRealDraft("");
      // refresh the DM list preview/timestamp
      loadThreads();
    } catch (e) {
      setRealErr(e.response?.data?.detail || "Failed to send");
    } finally { setRealBusy(false); }
  };

  // ----- Edit + delete handlers -----
  const beginEdit = (m) => {
    setEditingMsg({ id: m.id, text: m.text });
    setEditDraft(m.text);
    setMsgMenu(null);
  };
  const saveEdit = async () => {
    if (!editingMsg || !editDraft.trim()) return;
    try {
      const { data } = await apiClient.patch(`/messages/${editingMsg.id}`, { text: editDraft.trim() });
      setRealThread((rt) => ({
        ...rt,
        messages: rt.messages.map((m) => m.id === editingMsg.id ? data.message : m),
      }));
      setEditingMsg(null); setEditDraft("");
      loadThreads();
    } catch (e) {
      setRealErr(e.response?.data?.detail || "Failed to edit");
    }
  };
  const cancelEdit = () => { setEditingMsg(null); setEditDraft(""); };

  const deleteMsg = async (mid) => {
    setMsgMenu(null);
    try {
      await apiClient.delete(`/messages/${mid}`);
      setRealThread((rt) => ({ ...rt, messages: rt.messages.filter((m) => m.id !== mid) }));
      loadThreads();
    } catch (e) {
      setRealErr(e.response?.data?.detail || "Failed to delete");
    }
  };

  const onMsgPointerDown = (m, e) => {
    // Long-press (500ms) opens the menu — only for own messages
    if (m.from_username !== user?.username) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      // The menu is rendered INSIDE the bubble (position absolute) so it
      // can't overflow the chat viewport on small screens.
      setMsgMenu({ id: m.id, text: m.text });
    }, 480);
  };
  const onMsgPointerUp = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  // Linkify text — turn http(s)://... and image extensions into rich content
  const renderText = (text) => {
    const parts = [];
    const urlRe = /(https?:\/\/[^\s]+)/g;
    let last = 0; let m; let i = 0;
    while ((m = urlRe.exec(text)) !== null) {
      if (m.index > last) parts.push(<span key={`t${i++}`}>{text.slice(last, m.index)}</span>);
      const url = m[0];
      const isImg = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(url);
      if (isImg) {
        parts.push(
          <a key={`img${i++}`} href={url} target="_blank" rel="noopener noreferrer" className="block mt-1 mb-1">
            <img src={url} alt="" className="rounded" style={{ maxHeight: 200, maxWidth: "100%" }} />
          </a>
        );
      } else {
        parts.push(
          <a key={`u${i++}`} href={url} target="_blank" rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline" }}>{url}</a>
        );
      }
      last = m.index + url.length;
    }
    if (last < text.length) parts.push(<span key={`t${i++}`}>{text.slice(last)}</span>);
    return parts;
  };

  const closeRealChat = () => {
    setSearchParams({});
    setRealThread(null);
  };

  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeChat, messages]);

  // --- Real thread list (Pinned + DMs) -----------------------------------
  const [threads, setThreads] = useState([]);
  const loadThreads = async () => {
    if (!user) return;
    try {
      const { data } = await apiClient.get("/messages/threads");
      setThreads(data.threads || []);
    } catch { setThreads([]); }
  };
  useEffect(() => { loadThreads(); }, [user]);

  const togglePin = async (peerUsername, isPinned) => {
    try {
      await apiClient.post(
        isPinned ? "/messages/threads/unpin" : "/messages/threads/pin",
        { peer_username: peerUsername }
      );
      loadThreads();
    } catch { /* silent */ }
  };

  const realPinned = threads.filter((t) => t.is_pinned).slice(0, 4);
  const realDMs = threads;

  const openRealChat = (username) => {
    setSearchParams({ to: username });
  };

  const formatTimeShort = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      const now = new Date();
      if (d.toDateString() === now.toDateString())
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch { return ""; }
  };

  // ----------------------------------------------------------------------

  const activeThread = activeChat ? DIRECT_MESSAGES.find((d) => d.id === activeChat) : null;

  const send = () => {
    if (!draft.trim() || !activeChat) return;
    const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages((m) => ({
      ...m,
      [activeChat]: [...(m[activeChat] || []), { from: "me", text: draft.trim(), t }],
    }));
    setDraft("");
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="messages-page">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
          OurRealm <span style={{ color: "var(--brand-green)" }}>Messenger</span>
        </h1>
        <span className="mode-badge hidden sm:inline-flex">Messenger</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-3 sm:gap-4">
        {/* Vertical sidebar */}
        <aside className="or-surface p-3 flex md:flex-col gap-2 overflow-x-auto md:overflow-visible no-scrollbar min-w-0" data-testid="messenger-sidebar">
          {SIDEBAR.map(({ id, label, Icon, badge }) => (
            <button
              key={id}
              data-testid={`messenger-tab-${id}`}
              data-active={tab === id}
              onClick={() => setTab(id)}
              className="flex flex-col md:flex-row items-center md:items-center gap-1.5 md:gap-2.5 px-3 py-3 transition-colors shrink-0"
              style={{
                borderRadius: "calc(var(--radius) - 4px)",
                background: tab === id ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "transparent",
                color: tab === id ? "var(--primary)" : "var(--text-muted)",
                fontWeight: tab === id ? 700 : 500,
                outline: tab === id ? "1px solid var(--primary)" : "1px solid transparent",
                minWidth: 70,
              }}
            >
              <div className="relative">
                <Icon size={20} />
                {badge && (
                  <span className="starbar-badge" style={{ top: -6, right: -8 }}>{badge}</span>
                )}
              </div>
              <span className="text-xs sm:text-sm">{label}</span>
            </button>
          ))}

          <div className="mt-auto pt-3 hidden md:flex flex-col items-center gap-1.5" data-testid="messenger-persona">
            <div className="relative">
              <img
                src={CURRENT_PERSONA.avatar}
                alt={CURRENT_PERSONA.name}
                className="rounded-full object-cover"
                style={{ width: 64, height: 64, border: "3px solid var(--primary)" }}
              />
              <span className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full" style={{ background: "#10E670", border: "2px solid var(--bgc)" }} />
            </div>
            <div className="text-xs font-semibold text-center" style={{ color: "var(--text-main)" }}>{CURRENT_PERSONA.name}</div>
            <div className="px-2 py-0.5 text-[10px] font-bold rounded-full" style={{ background: "color-mix(in srgb, var(--primary) 20%, transparent)", color: "var(--primary)" }}>
              LVL {CURRENT_PERSONA.level}
            </div>
            <div className="text-[11px]" style={{ color: "var(--brand-green)" }}>
              {CURRENT_PERSONA.rp.toLocaleString()} RP <ChevronRight size={10} className="inline" />
            </div>
          </div>
        </aside>

        {/* Main panel */}
        <section className="or-surface p-3 sm:p-5 min-w-0">
          {/* Live users row */}
          <div className="flex gap-3 sm:gap-5 overflow-x-auto no-scrollbar pb-2" data-testid="messenger-live-users">
            {CHARACTERS.map((c) => (
              <button
                key={c.id}
                className="flex flex-col items-center gap-1.5 shrink-0"
                data-testid={`messenger-live-${c.id}`}
                onClick={() => setActiveChat(`dm-${CHARACTERS.indexOf(c) + 1}`)}
              >
                <StatusRing character={c} size={72} />
                <div className="text-xs font-semibold" style={{ color: "var(--text-main)" }}>{c.name}</div>
                <div className="text-[10px]" style={{ color: c.ringColor }}>{c.label}</div>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="or-surface mt-4 p-2.5 flex items-center gap-2" style={{ background: "var(--surface-2)" }}>
            <Search size={16} style={{ color: "var(--text-muted)" }} />
            <input
              placeholder="Search for friends, groups, or messages…"
              className="bg-transparent flex-1 outline-none border-none text-sm"
              style={{ color: "var(--text-main)" }}
              data-testid="messenger-search"
            />
            <Sliders size={16} style={{ color: "var(--text-muted)" }} />
          </div>

          {/* Pinned — REAL threads (fall back to design mocks while no real pins exist
              so the visual layout is preserved). */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base sm:text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>Pinned Conversations</h3>
              <button className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>View All <ChevronRight size={12} /></button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="messenger-pinned">
              {realPinned.length > 0 ? realPinned.map((t) => {
                const badgeColor = t.peer.is_founder ? "#10E670" : "#2EA0FF";
                const badge = t.peer.is_founder ? "FOUNDER" : "FRIEND";
                const avatar = t.peer.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(t.peer.name || t.peer.username)}`;
                return (
                  <button
                    key={t.conv_id}
                    onClick={() => openRealChat(t.peer.username)}
                    className="or-surface p-3 text-left"
                    style={{ background: "var(--surface-2)", borderColor: badgeColor, outline: `1px solid ${badgeColor}33` }}
                    data-testid={`pinned-${t.peer.username}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <img src={avatar} alt="" className="rounded-full object-cover" style={{ width: 36, height: 36, border: `2px solid ${badgeColor}` }} />
                      <div className="min-w-0">
                        <div className="text-sm font-bold truncate" style={{ color: "var(--text-main)" }}>{t.peer.name || `@${t.peer.username}`}</div>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: badgeColor, color: "#fff" }}>{badge}</span>
                      </div>
                      <button
                        className="ml-auto p-0"
                        style={{ background: "transparent" }}
                        onClick={(e) => { e.stopPropagation(); togglePin(t.peer.username, t.is_pinned); }}
                        title="Unpin"
                        data-testid={`pinned-unpin-${t.peer.username}`}
                      >
                        <Pin size={12} style={{ color: "var(--primary)" }} />
                      </button>
                    </div>
                    <div className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>{t.last_text || "Tap to start a conversation"}</div>
                  </button>
                );
              }) : PINNED_CONVERSATIONS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveChat(`dm-${PINNED_CONVERSATIONS.indexOf(p) + 1}`)}
                  className="or-surface p-3 text-left"
                  style={{ background: "var(--surface-2)", borderColor: p.badgeColor, outline: `1px solid ${p.badgeColor}33` }}
                  data-testid={`pinned-${p.id}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <img src={p.character.avatar} alt="" className="rounded-full object-cover" style={{ width: 36, height: 36, border: `2px solid ${p.badgeColor}` }} />
                    <div>
                      <div className="text-sm font-bold" style={{ color: "var(--text-main)" }}>{p.character.name}</div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: p.badgeColor, color: "#fff" }}>{p.badge}</span>
                    </div>
                    <Pin size={12} style={{ color: "var(--text-muted)", marginLeft: "auto" }} />
                  </div>
                  <div className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>{p.text}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Group Chats */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base sm:text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>Group Chats</h3>
              <button className="text-xs flex items-center gap-1" style={{ color: "var(--brand-green)" }} data-testid="messenger-new-group">New Group <Plus size={12} /></button>
            </div>
            <div className="space-y-2" data-testid="messenger-groups">
              {GROUP_CHATS.map((g) => (
                <button
                  key={g.id}
                  className="w-full or-surface p-3 text-left flex items-center gap-3"
                  style={{ background: "var(--surface-2)", outline: `1px solid ${g.accent}33` }}
                  data-testid={`group-${g.id}`}
                >
                  <div
                    className="rounded-full flex items-center justify-center shrink-0"
                    style={{ width: 52, height: 52, background: `linear-gradient(135deg, ${g.accent}33, ${g.accent}11)`, border: `1px solid ${g.accent}` }}
                  >
                    <span style={{ color: g.accent, fontSize: 22 }}>{g.emoji || "💬"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-bold flex items-center gap-1" style={{ color: "var(--text-main)" }}>
                        {g.name} {g.name === "Realm Raiders" && <Crown size={14} style={{ color: "#F4C84A" }} />}
                      </div>
                      <div className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{g.time}</div>
                    </div>
                    <div className="text-xs line-clamp-1" style={{ color: "var(--text-muted)" }}>{g.preview}</div>
                    <div className="flex items-center mt-1.5 gap-1">
                      {CHARACTERS.slice(0, 5).map((c) => (
                        <img key={c.id} src={c.avatar} alt="" className="rounded-full" style={{ width: 18, height: 18, border: "1px solid var(--bgc)", marginLeft: -4 }} />
                      ))}
                      <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface)", color: "var(--text-muted)" }}>+5</span>
                    </div>
                  </div>
                  <div
                    className="text-xs font-bold rounded-full px-2 py-0.5 shrink-0"
                    style={{ background: `${g.accent}33`, color: g.accent, minWidth: 28, textAlign: "center" }}
                  >
                    {g.count}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Direct Messages — REAL threads from /api/messages/threads */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base sm:text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>Direct Messages</h3>
              <button className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }} onClick={loadThreads} data-testid="messenger-dm-refresh">Refresh <ChevronRight size={12} /></button>
            </div>
            <div data-testid="messenger-dms">
              {realDMs.length === 0 ? (
                DIRECT_MESSAGES.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setActiveChat(d.id)}
                    className="w-full flex items-center gap-3 py-2.5 px-2 text-left transition-colors"
                    style={{ borderBottom: "1px solid var(--border-col)" }}
                    data-testid={`dm-${d.id}`}
                  >
                    <img src={d.character.avatar} alt="" className="rounded-full object-cover shrink-0" style={{ width: 40, height: 40 }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-sm" style={{ color: "var(--text-main)" }}>{d.character.name}</div>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: d.badgeColor, color: "#fff" }}>{d.badge}</span>
                      </div>
                      <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{d.preview}</div>
                    </div>
                    <div className="text-xs whitespace-nowrap shrink-0" style={{ color: "var(--text-muted)" }}>{d.time}</div>
                    {d.unread > 0 ? (
                      <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 shrink-0" style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                        {d.unread}
                      </span>
                    ) : d.pinned ? (
                      <Pin size={12} style={{ color: "var(--primary)" }} />
                    ) : (
                      <span className="w-2 h-2 rounded-full" style={{ background: d.badgeColor }} />
                    )}
                  </button>
                ))
              ) : realDMs.map((t) => {
                const badgeColor = t.peer.is_founder ? "#10E670" : "#2EA0FF";
                const badge = t.peer.is_founder ? "FOUNDER" : "FRIEND";
                const avatar = t.peer.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(t.peer.name || t.peer.username)}`;
                const preview = t.last_text
                  ? (t.last_from_me ? `You: ${t.last_text}` : t.last_text)
                  : "Tap to start a conversation";
                return (
                  <button
                    key={t.conv_id}
                    onClick={() => openRealChat(t.peer.username)}
                    className="w-full flex items-center gap-3 py-2.5 px-2 text-left transition-colors"
                    style={{ borderBottom: "1px solid var(--border-col)" }}
                    data-testid={`dm-${t.peer.username}`}
                  >
                    <img src={avatar} alt="" className="rounded-full object-cover shrink-0" style={{ width: 40, height: 40 }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-sm truncate" style={{ color: "var(--text-main)" }}>{t.peer.name || `@${t.peer.username}`}</div>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: badgeColor, color: "#fff" }}>{badge}</span>
                      </div>
                      <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{preview}</div>
                    </div>
                    <div className="text-xs whitespace-nowrap shrink-0" style={{ color: "var(--text-muted)" }}>{formatTimeShort(t.last_at)}</div>
                    {t.is_pinned ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(t.peer.username, true); }}
                        title="Unpin"
                        data-testid={`dm-unpin-${t.peer.username}`}
                        className="p-0"
                        style={{ background: "transparent" }}
                      >
                        <Pin size={12} style={{ color: "var(--primary)" }} />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(t.peer.username, false); }}
                        title="Pin"
                        data-testid={`dm-pin-${t.peer.username}`}
                        className="p-0 opacity-50 hover:opacity-100"
                        style={{ background: "transparent" }}
                      >
                        <Pin size={12} style={{ color: "var(--text-muted)" }} />
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* Chat overlay */}
      {activeChat && activeThread && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
          onClick={() => setActiveChat(null)}
          data-testid="chat-overlay"
        >
          <div className="or-surface w-full max-w-2xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
              <img src={activeThread.character.avatar} alt="" className="rounded-full" style={{ width: 40, height: 40 }} />
              <div className="flex-1">
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>{activeThread.character.name}</div>
                <div className="text-[11px]" style={{ color: activeThread.badgeColor }}>{activeThread.badge}</div>
              </div>
              <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={() => setActiveChat(null)} data-testid="chat-close">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2" data-testid="chat-conversation">
              {(messages[activeChat] || []).map((m, i) => (
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
              <button className="starbar-icon" style={{ width: 36, height: 36 }} data-testid="chat-attach"><Paperclip size={16} /></button>
              <button className="starbar-icon" style={{ width: 36, height: 36 }} data-testid="chat-voice"><Mic size={16} /></button>
              <input
                className="or-input flex-1"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Message…"
                data-testid="chat-input"
              />
              <button className="or-btn" style={{ padding: "0.55rem 0.9rem" }} onClick={send} data-testid="chat-send"><Send size={16} /></button>
            </div>
          </div>
        </div>
      )}

      {/* Real friends-only DM overlay (opened via ?to=username) */}
      {realThread && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
          onClick={closeRealChat}
          data-testid="real-chat-overlay"
        >
          <div className="or-surface w-full max-w-2xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
              <div className="rounded-full w-10 h-10 flex items-center justify-center" style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", color: "var(--primary)", fontWeight: 700 }}>
                {realThread.target?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="font-semibold" style={{ color: "var(--text-main)" }} data-testid="real-chat-target">@{realThread.target}</div>
                <div className="text-[11px]" style={{ color: realThread.allowed ? "var(--brand-green)" : "#FF8080" }}>
                  {realThread.allowed ? "Friends · secure DM" : "Locked — friends only"}
                </div>
              </div>
              <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={closeRealChat} data-testid="real-chat-close">
                <X size={16} />
              </button>
            </div>

            {!realThread.allowed ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3" data-testid="real-chat-blocked">
                <AlertTriangle size={32} style={{ color: "#FFB72E" }} />
                <div className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
                  Messaging is friends-only
                </div>
                <p className="text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>
                  To start a private conversation with <b style={{ color: "var(--text-main)" }}>@{realThread.target}</b>, send them a friend request first.
                </p>
                {realErr && <div className="text-xs" style={{ color: "#FF8080" }}>{realErr}</div>}
                <div className="flex gap-2 mt-2">
                  <button
                    className="or-btn"
                    onClick={() => navigate(`/public/${realThread.target}`)}
                    data-testid="real-chat-open-profile"
                  >
                    <UserPlus size={14} /> Open profile
                  </button>
                  <button className="or-btn or-btn-ghost" onClick={closeRealChat} data-testid="real-chat-dismiss">Close</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-2" data-testid="real-chat-conversation">
                  {(realThread.messages || []).length === 0 && (
                    <div className="text-center text-sm" style={{ color: "var(--text-muted)" }}>
                      Say hi to @{realThread.target} 👋
                    </div>
                  )}
                  {(realThread.messages || []).map((m, idx) => {
                    const mine = m.from_username === user?.username;
                    const isLastMine = mine && idx === (realThread.messages.length - 1);
                    const isEditing = editingMsg?.id === m.id;
                    let status = "Sent";
                    if (mine) {
                      if (m.read_at) status = "Read";
                      else if (m.delivered_at) status = "Delivered";
                    }
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className="max-w-[75%] px-3 py-2 text-sm select-none"
                          style={{
                            background: mine ? "var(--primary)" : "var(--surface-2)",
                            color: mine ? "var(--primary-fg)" : "var(--text-main)",
                            borderRadius: "var(--radius)",
                            position: "relative",
                          }}
                          data-testid={`real-msg-${m.id}`}
                          onPointerDown={(e) => onMsgPointerDown(m, e)}
                          onPointerUp={onMsgPointerUp}
                          onPointerLeave={onMsgPointerUp}
                        >
                          {isEditing ? (
                            <div className="flex flex-col gap-1">
                              <input
                                autoFocus
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEdit();
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                className="or-input"
                                style={{ color: "var(--text-main)" }}
                                data-testid={`real-msg-edit-input-${m.id}`}
                              />
                              <div className="flex gap-1 justify-end">
                                <button className="or-chip" onClick={cancelEdit} data-testid={`real-msg-edit-cancel-${m.id}`}>Cancel</button>
                                <button className="or-chip" onClick={saveEdit} data-testid={`real-msg-edit-save-${m.id}`}>Save</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="or-wrap">{renderText(m.text)}</div>
                              <div className="text-[10px] mt-1 opacity-70 text-right flex items-center justify-end gap-1.5">
                                {m.edited_at && <span data-testid={`real-msg-edited-${m.id}`}>edited</span>}
                                <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                {isLastMine && (
                                  <span data-testid={`real-msg-status-${m.id}`}>· {status}</span>
                                )}
                              </div>
                              {/* Long-press dropdown — anchored INSIDE the bubble.
                                  Aligns to the bubble's edge so it cannot overflow
                                  the chat viewport, regardless of screen size. */}
                              {msgMenu?.id === m.id && (
                                <div
                                  className="absolute or-surface p-1 z-10"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid="real-msg-menu"
                                  style={{
                                    top: "100%",
                                    [mine ? "right" : "left"]: 0,
                                    marginTop: 4,
                                    minWidth: 140,
                                    background: "var(--surface-2)",
                                    boxShadow: "0 8px 20px rgba(0,0,0,0.4)",
                                  }}
                                >
                                  <button
                                    className="block w-full text-left px-3 py-2 text-sm"
                                    onClick={() => beginEdit(m)}
                                    data-testid="real-msg-menu-edit"
                                    style={{ color: "var(--text-main)" }}
                                  >Edit</button>
                                  <button
                                    className="block w-full text-left px-3 py-2 text-sm"
                                    onClick={() => deleteMsg(m.id)}
                                    data-testid="real-msg-menu-delete"
                                    style={{ color: "#FF8080" }}
                                  >Delete for everyone</button>
                                  <button
                                    className="block w-full text-left px-3 py-2 text-[11px]"
                                    onClick={() => setMsgMenu(null)}
                                    style={{ color: "var(--text-muted)" }}
                                  >Cancel</button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={realEndRef} />
                </div>
                {realErr && (
                  <div className="text-xs px-4 py-1.5" style={{ color: "#FF8080" }}>{realErr}</div>
                )}
                <div className="p-3 flex items-center gap-2" style={{ borderTop: "1px solid var(--border-col)" }}>
                  <input
                    className="or-input flex-1"
                    value={realDraft}
                    onChange={(e) => setRealDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendReal()}
                    placeholder={`Message @${realThread.target}…`}
                    data-testid="real-chat-input"
                  />
                  <button className="or-btn" style={{ padding: "0.55rem 0.9rem" }} disabled={realBusy || !realDraft.trim()} onClick={sendReal} data-testid="real-chat-send">
                    <Send size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
