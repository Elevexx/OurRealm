import React, { useState, useEffect, useCallback } from "react";
import { UserPlus, MessageCircle, UserCheck, Search, Check, X, Sparkles, Users as UsersIcon, Loader2, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { FEATURED_FRIENDS } from "@/data/mockData";

const TABS = [
  { id: "friends",   label: "Friends" },
  { id: "requests",  label: "Requests" },
  { id: "search",    label: "Find People" },
];

function Avatar({ user, size = 52, ring }) {
  const src = user.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name || user.username || "U")}`;
  return (
    <img
      src={src}
      alt={user.username}
      className="rounded-full object-cover"
      style={{ width: size, height: size, border: ring ? `2px solid ${ring}` : "2px solid var(--border-col)" }}
    />
  );
}

export default function Friends() {
  const [tab, setTab] = useState("friends");
  const [q, setQ] = useState("");
  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [actionId, setActionId] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();

  const loadFriends = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await apiClient.get("/friends/list");
      setFriends(data.friends || []);
      setIncoming(data.incoming || []);
      setOutgoing(data.outgoing || []);
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  // live search (debounced) when on the search tab
  useEffect(() => {
    if (tab !== "search") return;
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.get(`/users/search?q=${encodeURIComponent(q.trim())}`);
        setSearchResults((data.users || []).filter((u) => u.username !== user?.username));
      } catch { setSearchResults([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, tab, user?.username]);

  const friendUsernames = new Set(friends.map((f) => f.username));
  const outgoingUsernames = new Set(outgoing.map((f) => f.username));
  const incomingUsernames = new Set(incoming.map((f) => f.username));

  const sendRequest = async (username) => {
    setActionId(username);
    try { await apiClient.post("/friends/request", { username }); await loadFriends(); } catch { /* */ } finally { setActionId(""); }
  };
  const accept = async (username) => {
    setActionId(username);
    try { await apiClient.post("/friends/accept", { username }); await loadFriends(); } catch { /* */ } finally { setActionId(""); }
  };
  const decline = async (username) => {
    setActionId(username);
    try { await apiClient.post("/friends/decline", { username }); await loadFriends(); } catch { /* */ } finally { setActionId(""); }
  };

  const filteredFriends = friends.filter((f) =>
    !q.trim() ||
    (f.username || "").toLowerCase().includes(q.toLowerCase()) ||
    (f.name || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto" data-testid="friends-page">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Your network</div>
          <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
            <UsersIcon size={28} style={{ color: "var(--primary)" }} /> Friends
          </h1>
        </div>
        <span className="mode-badge hidden sm:inline-flex">{friends.length} connections</span>
      </div>

      {/* Featured 8 circles (Close Realm) — kept as mock per design */}
      <div className="or-surface p-4 sm:p-5 mb-5" data-testid="friends-featured-circles">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base sm:text-lg flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
            <Sparkles size={16} /> Close Realm
          </h3>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Your inner 8</span>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-4 place-items-center">
          {FEATURED_FRIENDS.map((f, i) => (
            <button
              key={f.id}
              className="flex flex-col items-center gap-1.5 min-w-0 w-full"
              data-testid={`featured-friend-${i}`}
              onClick={() => navigate("/messages")}
            >
              <div className="rounded-full p-[3px] relative aspect-square w-full"
                style={{ background: f.ringColor, boxShadow: `0 0 14px ${f.ringColor}66`, maxWidth: 80 }}>
                <img src={f.avatar} alt="" className="w-full h-full rounded-full object-cover" style={{ border: "3px solid var(--bgc)" }} />
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[8px] font-extrabold"
                  style={{ background: f.ringColor, color: "#fff", letterSpacing: "0.06em" }}>#{i + 1}</span>
              </div>
              <div className="text-[11px] sm:text-xs font-semibold text-center truncate w-full" style={{ color: "var(--text-main)" }}>{f.name}</div>
              <div className="text-[10px]" style={{ color: f.ringColor }}>{f.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const count =
            t.id === "friends" ? friends.length :
            t.id === "requests" ? incoming.length :
            searchResults.length;
          return (
            <button
              key={t.id}
              className="or-chip shrink-0"
              data-active={tab === t.id}
              onClick={() => setTab(t.id)}
              data-testid={`friends-tab-${t.id}`}
            >
              {t.label} <span style={{ opacity: 0.7 }}>· {count}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="or-surface p-3 mb-5 flex items-center gap-2">
        {searching ? <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} /> : <Search size={16} style={{ color: "var(--text-muted)" }} />}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === "search" ? "Search OurRealm by @username or name…" : "Filter your friends…"}
          className="bg-transparent border-none outline-none flex-1 text-sm"
          style={{ color: "var(--text-main)" }}
          data-testid="friends-search"
        />
      </div>

      {/* Friends list */}
      {tab === "friends" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="friends-grid">
          {filteredFriends.length === 0 && (
            <div className="or-surface p-6 text-center sm:col-span-2 lg:col-span-3" style={{ color: "var(--text-muted)" }}>
              You have no friends yet. Try <button className="underline" onClick={() => setTab("search")} style={{ color: "var(--primary)" }}>Find People</button>.
            </div>
          )}
          {filteredFriends.map((f) => (
            <div key={f.username} className="or-surface p-5 flex flex-col items-center text-center" data-testid={`friend-card-${f.username}`}>
              <button onClick={() => navigate(`/public/${f.username}`)} aria-label={`Open @${f.username}`}>
                <Avatar user={f} size={84} ring="var(--primary)" />
              </button>
              <div className="mt-3 font-semibold" style={{ color: "var(--text-main)" }}>@{f.username}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{f.name}</div>
              <div className="mt-3 flex gap-2 w-full">
                <button className="or-btn flex-1" style={{ padding: "0.45rem", fontSize: "0.8rem" }}
                  data-testid={`friend-message-${f.username}`}
                  onClick={() => navigate(`/messages?to=${f.username}`)}>
                  <MessageCircle size={14} /> Message
                </button>
                <button className="or-btn or-btn-ghost flex-1" style={{ padding: "0.45rem", fontSize: "0.8rem" }}
                  data-testid={`friend-profile-${f.username}`}
                  onClick={() => navigate(`/public/${f.username}`)}>
                  <UserCheck size={14} /> Profile
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Requests (incoming + outgoing) */}
      {tab === "requests" && (
        <div className="space-y-3" data-testid="requests-list">
          {incoming.length === 0 && outgoing.length === 0 && (
            <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }}>No pending requests.</div>
          )}
          {incoming.map((r) => (
            <div key={`in-${r.username}`} className="or-surface p-4 flex items-center gap-3" data-testid={`request-in-${r.username}`}>
              <Avatar user={r} size={52} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{r.username}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{r.name} · wants to connect</div>
              </div>
              <button className="or-btn" style={{ padding: "0.45rem 0.85rem", fontSize: "0.8rem" }}
                disabled={actionId === r.username}
                onClick={() => accept(r.username)} data-testid={`request-accept-${r.username}`}>
                <Check size={14} /> Accept
              </button>
              <button className="or-btn or-btn-ghost" style={{ padding: "0.45rem 0.85rem", fontSize: "0.8rem" }}
                disabled={actionId === r.username}
                onClick={() => decline(r.username)} data-testid={`request-decline-${r.username}`}>
                <X size={14} />
              </button>
            </div>
          ))}
          {outgoing.map((r) => (
            <div key={`out-${r.username}`} className="or-surface p-4 flex items-center gap-3" data-testid={`request-out-${r.username}`}>
              <Avatar user={r} size={52} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{r.username}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{r.name} · request pending</div>
              </div>
              <span className="or-chip" style={{ color: "var(--text-muted)" }}>
                <Clock size={12} /> Pending
              </span>
              <button className="or-btn or-btn-ghost" style={{ padding: "0.45rem 0.85rem", fontSize: "0.8rem" }}
                disabled={actionId === r.username}
                onClick={() => decline(r.username)} data-testid={`request-cancel-${r.username}`}>
                <X size={14} /> Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search for people */}
      {tab === "search" && (
        <div className="space-y-3" data-testid="search-list">
          {!q.trim() && (
            <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }}>
              Start typing a name or @username to find people on OurRealm.
            </div>
          )}
          {q.trim() && !searching && searchResults.length === 0 && (
            <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }}>
              No users matched &quot;<b style={{ color: "var(--text-main)" }}>{q}</b>&quot;.
            </div>
          )}
          {searchResults.map((u) => {
            const isFriend = friendUsernames.has(u.username);
            const isOut = outgoingUsernames.has(u.username);
            const isIn = incomingUsernames.has(u.username);
            return (
              <div key={u.username} className="or-surface p-4 flex items-center gap-3" data-testid={`search-user-${u.username}`}>
                <button onClick={() => navigate(`/public/${u.username}`)} aria-label={`Open @${u.username}`}>
                  <Avatar user={u} size={52} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{u.username}</div>
                    {u.is_founder && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "linear-gradient(135deg, #00FF66, #2EA0FF)", color: "#0a0a0a" }}>Founder</span>
                    )}
                  </div>
                  <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{u.name} {u.bio ? `· ${u.bio}` : ""}</div>
                </div>
                {isFriend ? (
                  <span className="or-chip" style={{ color: "var(--brand-green)" }}><UserCheck size={12} /> Friends</span>
                ) : isOut ? (
                  <span className="or-chip" style={{ color: "var(--text-muted)" }}><Clock size={12} /> Pending</span>
                ) : isIn ? (
                  <button className="or-btn" style={{ padding: "0.4rem 0.7rem", fontSize: "0.78rem" }}
                    disabled={actionId === u.username}
                    onClick={() => accept(u.username)}
                    data-testid={`accept-${u.username}`}>
                    <Check size={14} /> Accept
                  </button>
                ) : (
                  <button className="or-btn" style={{ padding: "0.4rem 0.7rem", fontSize: "0.78rem" }}
                    disabled={actionId === u.username}
                    onClick={() => sendRequest(u.username)}
                    data-testid={`add-friend-${u.username}`}>
                    <UserPlus size={14} /> Add Friend
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
