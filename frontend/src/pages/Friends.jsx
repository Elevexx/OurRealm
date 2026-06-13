import React, { useState, useMemo } from "react";
import { UserPlus, MessageCircle, UserCheck, Search, Check, X, Sparkles, Users as UsersIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { FRIENDS, FEATURED_FRIENDS, FRIEND_REQUESTS, FOLLOWING, FOLLOWERS } from "@/data/mockData";

const TABS = [
  { id: "friends",   label: "Friends" },
  { id: "requests",  label: "Requests" },
  { id: "following", label: "Following" },
  { id: "followers", label: "Followers" },
];

export default function Friends() {
  const [tab, setTab] = useState("friends");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(FRIEND_REQUESTS);
  const navigate = useNavigate();

  const filteredFriends = useMemo(
    () => FRIENDS.filter((f) => f.handle.toLowerCase().includes(q.toLowerCase()) || f.name.toLowerCase().includes(q.toLowerCase())),
    [q]
  );

  const acceptRequest = (id) => setPending((arr) => arr.filter((r) => r.id !== id));
  const declineRequest = (id) => setPending((arr) => arr.filter((r) => r.id !== id));

  return (
    <div className="max-w-6xl mx-auto" data-testid="friends-page">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Your network</div>
          <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
            <UsersIcon size={28} style={{ color: "var(--primary)" }} /> Friends
          </h1>
        </div>
        <span className="mode-badge hidden sm:inline-flex">{FRIENDS.length} connections</span>
      </div>

      {/* Featured 8 circles */}
      <div className="or-surface p-4 sm:p-5 mb-5" data-testid="friends-featured-circles">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base sm:text-lg flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
            <Sparkles size={16} /> Close Realm
          </h3>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Your inner 8</span>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 sm:gap-4 place-items-center">
          {FEATURED_FRIENDS.map((f, i) => (
            <button
              key={f.id}
              className="flex flex-col items-center gap-1.5"
              data-testid={`featured-friend-${i}`}
              onClick={() => navigate("/messages")}
            >
              <div
                className="rounded-full p-[3px] relative"
                style={{
                  background: f.ringColor,
                  boxShadow: `0 0 14px ${f.ringColor}66`,
                  width: 80, height: 80,
                }}
              >
                <img src={f.avatar} alt="" className="w-full h-full rounded-full object-cover" style={{ border: "3px solid var(--bgc)" }} />
                <span
                  className="absolute -top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[8px] font-extrabold"
                  style={{ background: f.ringColor, color: "#fff", letterSpacing: "0.06em" }}
                >
                  #{i + 1}
                </span>
              </div>
              <div className="text-xs font-semibold text-center" style={{ color: "var(--text-main)" }}>{f.name}</div>
              <div className="text-[10px]" style={{ color: f.ringColor }}>{f.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const count =
            t.id === "friends" ? FRIENDS.length :
            t.id === "requests" ? pending.length :
            t.id === "following" ? FOLLOWING.length : FOLLOWERS.length;
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

      <div className="or-surface p-3 mb-5 flex items-center gap-2">
        <Search size={16} style={{ color: "var(--text-muted)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or handle…"
          className="bg-transparent border-none outline-none flex-1 text-sm"
          style={{ color: "var(--text-main)" }}
          data-testid="friends-search"
        />
      </div>

      {tab === "friends" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="friends-grid">
          {filteredFriends.map((f) => (
            <div key={f.id} className="or-surface p-5 flex flex-col items-center text-center" data-testid={`friend-card-${f.id}`}>
              <div className="relative">
                <img src={f.avatar} alt="" className="rounded-full object-cover" style={{ width: 84, height: 84, border: "2px solid var(--border-col)" }} />
                {f.is_online && (
                  <span className="absolute bottom-1 right-1 w-3 h-3 rounded-full" style={{ background: "#10E670", border: "2px solid var(--surface)" }} />
                )}
              </div>
              <div className="mt-3 font-semibold" style={{ color: "var(--text-main)" }}>@{f.handle}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{f.mutuals} mutual friends</div>
              <div className="mt-3 flex gap-2 w-full">
                <button className="or-btn flex-1" style={{ padding: "0.45rem", fontSize: "0.8rem" }} data-testid={`friend-message-${f.id}`} onClick={() => navigate("/messages")}>
                  <MessageCircle size={14} /> Message
                </button>
                <button className="or-btn or-btn-ghost flex-1" style={{ padding: "0.45rem", fontSize: "0.8rem" }} data-testid={`friend-follow-${f.id}`}>
                  <UserCheck size={14} /> Friends
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "requests" && (
        <div className="space-y-3" data-testid="requests-list">
          {pending.length === 0 && (
            <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }}>No pending requests.</div>
          )}
          {pending.map((r) => (
            <div key={r.id} className="or-surface p-4 flex items-center gap-3" data-testid={`request-${r.id}`}>
              <img src={r.avatar} alt="" className="rounded-full object-cover" style={{ width: 52, height: 52 }} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{r.handle}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{r.mutuals} mutual · {r.when} ago</div>
              </div>
              <button className="or-btn" style={{ padding: "0.45rem 0.85rem", fontSize: "0.8rem" }} onClick={() => acceptRequest(r.id)} data-testid={`request-accept-${r.id}`}>
                <Check size={14} /> Accept
              </button>
              <button className="or-btn or-btn-ghost" style={{ padding: "0.45rem 0.85rem", fontSize: "0.8rem" }} onClick={() => declineRequest(r.id)} data-testid={`request-decline-${r.id}`}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "following" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="following-grid">
          {FOLLOWING.map((u) => (
            <div key={u.id} className="or-surface p-4 flex items-center gap-3" data-testid={`following-${u.id}`}>
              <img src={u.avatar} alt="" className="rounded-full object-cover" style={{ width: 52, height: 52 }} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{u.handle}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>Following · {u.since}</div>
              </div>
              <button className="or-btn or-btn-ghost" style={{ padding: "0.4rem 0.7rem", fontSize: "0.78rem" }} data-testid={`unfollow-${u.id}`}>
                <UserCheck size={14} /> Following
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "followers" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="followers-grid">
          {FOLLOWERS.map((u) => (
            <div key={u.id} className="or-surface p-4 flex items-center gap-3" data-testid={`follower-${u.id}`}>
              <img src={u.avatar} alt="" className="rounded-full object-cover" style={{ width: 52, height: 52 }} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{u.handle}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{u.mutuals} mutual · joined you {u.since} ago</div>
              </div>
              <button className="or-btn" style={{ padding: "0.4rem 0.7rem", fontSize: "0.78rem" }} data-testid={`follow-back-${u.id}`}>
                <UserPlus size={14} /> Follow back
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
