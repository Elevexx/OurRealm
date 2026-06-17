import React, { useState, useEffect, useCallback, useRef } from "react";
import { UserPlus, MessageCircle, UserCheck, Search, Check, X, Sparkles, Users as UsersIcon, Loader2, Clock, Edit3, Plus, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import RadiusChips from "@/components/RadiusChips";
import ZipRequiredModal from "@/components/ZipRequiredModal";

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
  // Phase-2-Gate — radius chip selection for the Find People search.
  // Persisted via localStorage so it survives in-app navigation.
  const [radius, setRadius] = useState(() => {
    try { return localStorage.getItem("ourrealm.friendsRadius") || ""; } catch { return ""; }
  });
  const [zipRequired, setZipRequired] = useState(false);
  const [actionId, setActionId] = useState("");
  const [actionErr, setActionErr] = useState("");
  const navigate = useNavigate();
  const { user, refreshMe } = useAuth();

  // Phase 5 — quick "Add to Top 8" action surfaced on every friend card.
  // Uses the existing PATCH /profile/me { inner_8: [...] } API.
  const innerIds = user?.inner_8 || [];
  const isInTop8 = (id) => innerIds.includes(id);
  const addToTop8 = async (id) => {
    if (isInTop8(id)) return;
    if (innerIds.length >= 8) {
      setActionErr("Please remove friend from top 8 to add more");
      return;
    }
    setActionErr("");
    try {
      await apiClient.patch("/profile/me", { inner_8: [...innerIds, id] });
      if (refreshMe) await refreshMe();
    } catch (e) {
      setActionErr(e?.response?.data?.detail || "Could not add to Top 8");
    }
  };

  const loadFriends = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await apiClient.get("/friends/list");
      setFriends(data.friends || []);
      setIncoming(data.incoming || []);
      setOutgoing(data.outgoing || []);
    } catch (e) { setActionErr(e.response?.data?.detail || "Could not load friends"); }
  }, [user]);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  // live search (debounced) when on the search tab
  useEffect(() => {
    if (tab !== "search") return;
    if (!q.trim()) { setSearchResults([]); return; }
    // Phase-2-Gate — apply radius using existing backend filter when the
    // user has selected one. If they pick a radius but have no ZIP set,
    // we surface the shared ZipRequired modal and revert to "Any".
    let effectiveRadius = radius;
    if (effectiveRadius && !user?.zip_code) {
      effectiveRadius = "";
      setRadius("");
      setZipRequired(true);
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const params = { q: q.trim() };
        if (effectiveRadius) {
          params.radius = effectiveRadius;
          if (user?.username) params.viewer = user.username;
        }
        const { data } = await apiClient.get("/users/search", { params });
        setSearchResults((data.users || []).filter((u) => u.username !== user?.username));
      } catch { setSearchResults([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, tab, radius, user?.username, user?.zip_code]);

  const friendUsernames = new Set(friends.map((f) => f.username));
  const outgoingUsernames = new Set(outgoing.map((f) => f.username));
  const incomingUsernames = new Set(incoming.map((f) => f.username));

  const sendRequest = async (username) => {
    setActionId(username); setActionErr("");
    try {
      await apiClient.post("/friends/request", { username });
      await loadFriends();
    } catch (e) {
      setActionErr(e.response?.data?.detail || `Could not send request to @${username}`);
    } finally { setActionId(""); }
  };
  const accept = async (username) => {
    setActionId(username); setActionErr("");
    // Snapshot for rollback if the server call fails
    const prevIncoming = incoming;
    const prevFriends = friends;
    const requesterUser = incoming.find((u) => u.username === username);
    try {
      // ── Call backend FIRST and verify DB write succeeded ──
      const { data } = await apiClient.post("/friends/accept", { username });
      console.log("[Friends] accept response:", data);
      if (data?.status !== "friends") {
        throw new Error(`Unexpected response status: ${data?.status}`);
      }
      // ── Now update local state (no navigation, no redirect, no tab change) ──
      setIncoming((arr) => arr.filter((u) => u.username !== username));
      if (requesterUser && !friends.some((f) => f.username === username)) {
        // Use the hydrated peer payload from the server if available, else
        // reuse the request card data.
        const peer = data.peer ? { ...requesterUser, ...data.peer } : requesterUser;
        setFriends((arr) => [...arr, peer]);
      }
      // Background reconciliation — make absolutely sure UI matches DB
      loadFriends();
    } catch (e) {
      console.error("[Friends] accept failed:", e?.response?.data || e?.message || e);
      setIncoming(prevIncoming);
      setFriends(prevFriends);
      setActionErr(
        e?.response?.data?.detail ||
        `Could not accept @${username}. Please try again.`
      );
    } finally {
      setActionId("");
    }
  };
  const decline = async (username) => {
    setActionId(username); setActionErr("");
    try {
      await apiClient.post("/friends/decline", { username });
      await loadFriends();
    } catch (e) {
      setActionErr(e.response?.data?.detail || `Could not decline @${username}`);
    } finally { setActionId(""); }
  };

  const filteredFriends = friends.filter((f) =>
    !q.trim() ||
    (f.username || "").toLowerCase().includes(q.toLowerCase()) ||
    (f.name || "").toLowerCase().includes(q.toLowerCase())
  );

  // "Manage Top 8" CTA — bumps a token InnerEight reacts to (enters edit mode
  // and opens the picker if there's room) and scrolls the widget into view.
  const [manageTop8Token, setManageTop8Token] = useState(0);
  const innerEightRef = useRef(null);
  const manageTop8 = () => {
    setManageTop8Token((t) => t + 1);
    try {
      innerEightRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch { /* ignore */ }
  };

  return (
    <div className="max-w-6xl mx-auto" data-testid="friends-page">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Your network</div>
          <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
            <UsersIcon size={28} style={{ color: "var(--primary)" }} /> Friends
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="or-chip"
            onClick={manageTop8}
            data-testid="friends-manage-top8"
            title="Manage your Top 8"
          >
            <Star size={12} /> <span className="hidden sm:inline">Manage Top 8</span><span className="sm:hidden">Top 8</span>
          </button>
          <span className="mode-badge hidden sm:inline-flex">{friends.length} connections</span>
        </div>
      </div>

      {/* Close Realm / Inner 8 — backed by /api/profile/me { inner_8 } */}
      <div ref={innerEightRef}>
        <InnerEight friends={friends} onChange={loadFriends} manageToken={manageTop8Token} />
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

      {actionErr && (
        <div
          className="mb-3 px-3 py-2 text-sm flex items-start justify-between gap-3"
          style={{
            background: "rgba(255,80,80,0.1)",
            border: "1px solid rgba(255,80,80,0.4)",
            color: "#ff8080",
            borderRadius: "var(--radius)",
          }}
          data-testid="friends-action-err"
        >
          <span>{actionErr}</span>
          <button onClick={() => setActionErr("")} style={{ background: "transparent", color: "inherit" }}>×</button>
        </div>
      )}

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
              {/* Phase 5 — Add to Top 8 quick action (existing friends only) */}
              {f.id !== user?.id && (
                isInTop8(f.id) ? (
                  <button
                    type="button"
                    className="or-chip mt-2"
                    disabled
                    data-testid={`friend-in-top8-${f.username}`}
                    style={{ width: "100%", justifyContent: "center", opacity: 0.85 }}
                  >
                    <Star size={12} style={{ fill: "currentColor" }} /> In Top 8
                  </button>
                ) : (
                  <button
                    type="button"
                    className="or-chip mt-2"
                    onClick={() => addToTop8(f.id)}
                    data-testid={`friend-add-top8-${f.username}`}
                    style={{ width: "100%", justifyContent: "center" }}
                    title="Add to Top 8"
                  >
                    <Star size={12} /> Add to Top 8
                  </button>
                )
              )}
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
          <RadiusChips
            value={radius}
            onChange={(v) => {
              if (v && !user?.zip_code) { setZipRequired(true); return; }
              setRadius(v);
            }}
            storageKey="ourrealm.friendsRadius"
            testidPrefix="friends-radius"
            className="or-surface px-3 py-2"
          />
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
      <ZipRequiredModal open={zipRequired} onClose={() => setZipRequired(false)} testid="friends-zip-required" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Inner 8 — editable Close Realm widget (max 8 friends, ordered).
// ─────────────────────────────────────────────────────────────────────
function InnerEight({ friends, onChange, manageToken = 0 }) {
  const { user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => { if (!pickerOpen) setPickerQuery(""); }, [pickerOpen]);

  // Parent ("Manage Top 8" CTA) bumps manageToken — we enter edit mode and,
  // if there's still room, open the friend picker so the user can add right away.
  useEffect(() => {
    if (!manageToken) return;
    setEditing(true);
    const hasRoom = (user?.inner_8?.length || 0) < 8;
    if (hasRoom) setPickerOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageToken]);

  const idToFriend = new Map(friends.map((f) => [f.id, f]));
  const ids = (user?.inner_8 || []).filter((id) => idToFriend.has(id)).slice(0, 8);
  const ringColors = ["#10E670", "#2EA0FF", "#FF8AC2", "#FFD24A", "#FF3F5A", "#B26BFF", "#22D3EE", "#9EE800"];

  const save = async (next) => {
    setBusy(true); setErr("");
    try {
      await apiClient.patch("/profile/me", { inner_8: next });
      if (refreshMe) await refreshMe();
      if (onChange) await onChange();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not save Inner 8");
    } finally { setBusy(false); }
  };
  const remove = (id) => save(ids.filter((x) => x !== id));
  const add = (id) => {
    if (ids.length >= 8) { setErr("Please remove friend from top 8 to add more"); return; }
    save([...ids, id]);
    setPickerOpen(false);
  };
  const move = (id, dir) => {
    const i = ids.indexOf(id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids]; [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const pressTimer = useRef(null);
  const onPressDown = (id) => { if (!editing) return; pressTimer.current = setTimeout(() => remove(id), 600); };
  const onPressUp = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };

  const slots = Array.from({ length: 8 }, (_, i) => ids[i] || null);
  const candidates = friends.filter((f) => !ids.includes(f.id));
  const filteredCandidates = pickerQuery.trim()
    ? candidates.filter((f) => {
        const term = pickerQuery.trim().toLowerCase();
        return (f.username || "").toLowerCase().includes(term)
          || (f.name || "").toLowerCase().includes(term);
      })
    : candidates;

  return (
    <div className="or-surface p-4 sm:p-5 mb-5" data-testid="friends-inner-eight">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-base sm:text-lg flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          <Sparkles size={16} /> Close Realm <span className="text-xs" style={{ color: "var(--text-muted)" }}>Your inner 8</span>
        </h3>
        <button className="or-chip" onClick={() => setEditing((v) => !v)} data-active={editing} data-testid="inner8-edit-toggle">
          <Edit3 size={12} /> {editing ? "Done" : "Edit"}
        </button>
      </div>
      {err && <div className="text-[11px] mb-2" data-testid="inner8-err" style={{ color: "#FF8080" }}>{err}</div>}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-4 place-items-center">
        {slots.map((id, i) => {
          const ring = ringColors[i];
          if (!id) {
            return (
              <button key={`empty-${i}`} onClick={() => setPickerOpen(true)} className="flex flex-col items-center gap-1.5 min-w-0 w-full" data-testid={`inner8-add-slot-${i}`} style={{ opacity: 0.85 }}>
                <div className="rounded-full aspect-square w-full flex items-center justify-center" style={{ border: `2px dashed ${ring}`, maxWidth: 80, color: ring }}>
                  <Plus size={20} />
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Add Friend</div>
              </button>
            );
          }
          const f = idToFriend.get(id);
          const avatar = f.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(f.name || f.username)}`;
          return (
            <div key={id} className="flex flex-col items-center gap-1.5 min-w-0 w-full" data-testid={`inner8-slot-${f.username}`} onPointerDown={() => onPressDown(id)} onPointerUp={onPressUp} onPointerLeave={onPressUp}>
              <button onClick={() => editing ? null : navigate(`/messages?to=${f.username}`)} className="rounded-full p-[3px] relative aspect-square w-full" style={{ background: ring, boxShadow: `0 0 14px ${ring}66`, maxWidth: 80 }} aria-label={`Inner 8 #${i + 1}: @${f.username}`}>
                <img src={avatar} alt="" className="w-full h-full rounded-full object-cover" style={{ border: "3px solid var(--bgc)" }} />
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[8px] font-extrabold" style={{ background: ring, color: "#fff", letterSpacing: "0.06em" }}>#{i + 1}</span>
                {editing && (
                  <button className="absolute -top-1 -right-1 rounded-full w-5 h-5 flex items-center justify-center" style={{ background: "#FF3F5A", color: "#fff", border: "2px solid var(--bgc)" }} onClick={(e) => { e.stopPropagation(); remove(id); }} data-testid={`inner8-remove-${f.username}`} aria-label={`Remove @${f.username}`}>
                    <X size={10} />
                  </button>
                )}
              </button>
              <div className="text-[11px] sm:text-xs font-semibold text-center truncate w-full" style={{ color: "var(--text-main)" }}>{f.name || `@${f.username}`}</div>
              {editing && (
                <div className="flex gap-1">
                  <button className="text-[10px] px-1" onClick={() => move(id, -1)} data-testid={`inner8-up-${f.username}`} style={{ color: "var(--text-muted)" }}>◀</button>
                  <button className="text-[10px] px-1" onClick={() => move(id, +1)} data-testid={`inner8-down-${f.username}`} style={{ color: "var(--text-muted)" }}>▶</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {busy && <div className="text-[11px] mt-2 text-center" style={{ color: "var(--text-muted)" }}>Saving…</div>}

      {pickerOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center px-3 pb-24 sm:pb-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }} onClick={() => setPickerOpen(false)} data-testid="inner8-picker">
          <div className="or-surface w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
              <h3 className="text-base" style={{ fontFamily: "var(--font-display)" }}>Add to Top 8</h3>
              <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={() => setPickerOpen(false)} data-testid="inner8-picker-close"><X size={14} /></button>
            </div>
            <div className="px-3 pt-3">
              <div className="or-surface p-2.5 flex items-center gap-2" style={{ background: "var(--surface-2)" }}>
                <Search size={14} style={{ color: "var(--text-muted)" }} />
                <input
                  autoFocus
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search friends by name or @username…"
                  className="bg-transparent flex-1 outline-none border-none text-sm"
                  style={{ color: "var(--text-main)" }}
                  data-testid="inner8-picker-search"
                />
              </div>
            </div>
            <div className="p-3 flex-1 overflow-y-auto">
              {filteredCandidates.length === 0 ? (
                <div className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
                  {candidates.length === 0
                    ? "All your friends are already in Top 8."
                    : "No matches."}
                </div>
              ) : filteredCandidates.map((f) => (
                <button key={f.id} onClick={() => add(f.id)} className="w-full flex items-center gap-3 p-2 text-left" data-testid={`inner8-pick-${f.username}`} style={{ borderBottom: "1px solid var(--border-col)" }}>
                  <img src={f.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(f.name || f.username)}`} alt="" className="rounded-full" style={{ width: 36, height: 36 }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: "var(--text-main)" }}>@{f.username}</div>
                    <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{f.name}</div>
                  </div>
                  <Plus size={14} style={{ color: "var(--primary)" }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

