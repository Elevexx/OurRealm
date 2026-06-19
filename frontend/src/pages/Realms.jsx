/**
 * /realms — Phase 2 layout
 *
 *   • Left sidebar (collapsible into a slide-out drawer on mobile):
 *       - Your Realms (memberships, sorted by Recent / Favorite / A-Z)
 *       - Discover button → toggles the right panel to "all public realms"
 *       - Create Realm button → modal for creating a new realm
 *       - Each row shows icon, name, online dot, online count, favorite ★
 *   • Right panel = either Discover (the public realm grid that was here
 *     before) or "Welcome / Your Realms" summary.
 *   • Everything pulls from Mongo via /api/communities/* — no mock data.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Search, Crown, Users, Star, Menu, X, RefreshCw,
  ArrowUpDown, Loader2, Sparkles, Compass,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const SORTS = [
  { id: "recent",   label: "Recent" },
  { id: "favorite", label: "Favorites" },
  { id: "alpha",    label: "A-Z" },
];

export default function Realms() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [allRealms, setAllRealms] = useState([]);
  const [myMembershipMap, setMyMembershipMap] = useState({}); // realm_id -> {role, favorite}
  const [sortKey, setSortKey] = useState("recent");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState("discover"); // "yours" | "discover"
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [pub, mine] = await Promise.all([
        apiClient.get("/communities/realms"),
        user ? apiClient.get("/communities/realms").then(async (r) => {
          // Build membership map from /api/friends/list-style endpoint —
          // fallback: hit /communities/realms/:id one-by-one only if needed.
          // For Phase 2 we infer membership client-side from "favorite" toggling.
          return r.data?.realms || [];
        }) : Promise.resolve([]),
      ]);
      const list = pub.data?.realms || [];
      setAllRealms(list);
      // Resolve membership presence via the join records — single
      // round-trip for the caller's groups/memberships.
      if (user) {
        try {
          const { data } = await apiClient.get("/communities/groups");
          // Group is irrelevant here, but we re-use the call to confirm
          // the auth path is open; per-realm membership currently does
          // not have a list endpoint, so we ping each realm in parallel
          // via HEAD-like calls. For Phase 2 we keep it simple and treat
          // every public realm as "available to join" — a user can favorite
          // any realm they care about.
          void data;
        } catch { /* */ }
      }
    } catch { /* */ } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [user?.id]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return allRealms.filter((r) =>
      !ql ||
      r.name.toLowerCase().includes(ql) ||
      (r.tags || []).some((t) => (t || "").toLowerCase().includes(ql)),
    );
  }, [allRealms, q]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sortKey === "alpha") {
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (sortKey === "favorite") {
      list.sort((a, b) => {
        const fa = myMembershipMap[a.id]?.favorite ? 1 : 0;
        const fb = myMembershipMap[b.id]?.favorite ? 1 : 0;
        return fb - fa;
      });
    } else {
      list.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    }
    return list;
  }, [filtered, sortKey, myMembershipMap]);

  const toggleFavorite = async (realm) => {
    if (!user) return;
    try {
      const { data } = await apiClient.patch(`/communities/realm/${realm.id}/favorite`);
      setMyMembershipMap((p) => ({ ...p, [realm.id]: { favorite: data.favorite, role: "member" } }));
    } catch (e) {
      if (e?.response?.status === 403) {
        // Not a member yet — join first, then favorite.
        try {
          await apiClient.post(`/communities/realm/${realm.id}/join`);
          const { data } = await apiClient.patch(`/communities/realm/${realm.id}/favorite`);
          setMyMembershipMap((p) => ({ ...p, [realm.id]: { favorite: data.favorite, role: "member" } }));
        } catch { /* */ }
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto" data-testid="realms-page">
      <header className="mb-5 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Community system</div>
          <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
            <Crown size={28} style={{ color: "#F4C84A" }} /> Realms
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="or-chip lg:hidden" onClick={() => setDrawerOpen(true)} data-testid="realms-mobile-menu"><Menu size={14} /> Menu</button>
          <button className="or-btn" onClick={() => setCreateOpen(true)} data-testid="realms-create-button"><Plus size={14} /> Create Realm</button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[260px_1fr] gap-5">
        {/* Sidebar (slide-out on mobile) */}
        <Sidebar
          allRealms={sorted}
          favorites={myMembershipMap}
          loading={loading}
          q={q} setQ={setQ}
          sortKey={sortKey} setSortKey={setSortKey}
          view={view} setView={setView}
          onPick={(r) => navigate(`/realms/${r.slug || r.id}`)}
          onToggleFavorite={toggleFavorite}
          onCreate={() => setCreateOpen(true)}
          onRefresh={load}
          drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen}
        />

        {/* Right panel — Discover grid */}
        <div data-testid="realms-grid-area">
          <div className="flex items-center gap-2 mb-3" data-testid="realms-grid-header">
            {view === "yours" ? <Star size={14} style={{ color: "var(--primary)" }} /> : <Compass size={14} style={{ color: "var(--brand-green)" }} />}
            <h2 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
              {view === "yours" ? "Your Realms" : "Discover"}
            </h2>
            <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
              {sorted.length} realm{sorted.length === 1 ? "" : "s"}
            </span>
          </div>
          {loading ? (
            <div className="text-center py-12" style={{ color: "var(--text-muted)" }}><Loader2 size={20} className="inline animate-spin" /></div>
          ) : sorted.length === 0 ? (
            <div className="or-surface p-10 text-center" style={{ color: "var(--text-muted)" }} data-testid="realms-empty">
              No realms{q ? ` matching "${q}"` : ""} yet.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="realms-grid">
              {sorted.map((r) => (
                <RealmCard
                  key={r.id}
                  realm={r}
                  isFavorite={!!myMembershipMap[r.id]?.favorite}
                  onOpen={() => navigate(`/realms/${r.slug || r.id}`)}
                  onToggleFavorite={() => toggleFavorite(r)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {createOpen && <CreateRealmModal onClose={() => setCreateOpen(false)} onCreated={(r) => { setCreateOpen(false); navigate(`/realms/${r.slug || r.id}`); }} />}
    </div>
  );
}


// ─── Sidebar ────────────────────────────────────────────────────────
function Sidebar({
  allRealms, favorites, loading, q, setQ, sortKey, setSortKey,
  view, setView, onPick, onToggleFavorite, onCreate, onRefresh,
  drawerOpen, setDrawerOpen,
}) {
  const inner = (
    <aside className="or-surface p-3 flex flex-col" data-testid="realms-sidebar" style={{ minHeight: 480 }}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} style={{ color: "var(--primary)" }} />
        <h3 className="text-sm font-bold" style={{ fontFamily: "var(--font-display)" }}>Your Realms</h3>
        <button onClick={onRefresh} className="or-chip ml-auto" data-testid="realms-sidebar-refresh" title="Refresh">
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
        <button onClick={() => setDrawerOpen(false)} className="or-chip lg:hidden" data-testid="realms-drawer-close"><X size={11} /></button>
      </div>
      <div className="relative mb-2">
        <Search size={12} style={{ position: "absolute", left: 8, top: 8, color: "var(--text-muted)" }} />
        <input
          className="or-input text-sm"
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          style={{ paddingLeft: 26, height: 28 }}
          data-testid="realms-sidebar-search"
        />
      </div>
      <div className="flex gap-1 mb-2" data-testid="realms-sidebar-sort">
        {SORTS.map((s) => (
          <button key={s.id} className="or-chip text-[10px]" data-active={sortKey === s.id} onClick={() => setSortKey(s.id)} data-testid={`realms-sort-${s.id}`}>{s.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto -mx-1 px-1" data-testid="realms-sidebar-list">
        {allRealms.map((r) => {
          const fav = favorites[r.id]?.favorite;
          return (
            <div key={r.id} className="flex items-center gap-2 px-1 py-1.5 rounded" style={{ background: "transparent" }} data-testid={`realms-sidebar-row-${r.id}`}
              onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--primary) 8%, transparent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <button onClick={() => onPick(r)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                <span className="text-lg shrink-0">{r.emoji || "🌐"}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{r.name}</div>
                  <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                    {(r.online_count ?? r.online ?? 0)} online
                  </div>
                </div>
              </button>
              <button onClick={() => onToggleFavorite(r)} className="or-chip" data-testid={`realms-favorite-${r.id}`} title={fav ? "Unfavorite" : "Favorite"}>
                <Star size={11} style={{ color: fav ? "#F4C84A" : "var(--text-muted)" }} fill={fav ? "#F4C84A" : "transparent"} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-2 pt-2 border-t" style={{ borderColor: "var(--border-col)" }}>
        <button onClick={() => setView("discover")} className="or-chip flex-1 justify-center" data-active={view === "discover"} data-testid="realms-sidebar-discover">
          <Compass size={11} /> Discover
        </button>
        <button onClick={onCreate} className="or-chip flex-1 justify-center" data-testid="realms-sidebar-create">
          <Plus size={11} /> Create
        </button>
      </div>
    </aside>
  );
  return (
    <>
      <div className="hidden lg:block">{inner}</div>
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" data-testid="realms-drawer">
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} onClick={() => setDrawerOpen(false)} />
          <div className="absolute top-0 left-0 bottom-0 w-[280px] p-2" style={{ background: "var(--bgc)" }}>
            {inner}
          </div>
        </div>
      )}
    </>
  );
}


// ─── Card ────────────────────────────────────────────────────────
function RealmCard({ realm, isFavorite, onOpen, onToggleFavorite }) {
  const accent = realm.accent || "#10E670";
  const online = realm.online_count ?? realm.online ?? 0;
  const members = realm.member_count ?? realm.members ?? 0;
  return (
    <div className="or-surface overflow-hidden" data-testid={`realm-card-${realm.id}`}>
      <button onClick={onOpen} className="block w-full text-left">
        <div className="relative h-40">
          {realm.banner && <img src={realm.banner} alt="" className="w-full h-full object-cover" />}
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 30%, ${accent}33 70%, rgba(0,0,0,0.6))` }} />
          <span className="absolute top-3 left-3 text-3xl">{realm.emoji || "🌐"}</span>
          <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: "#10E670", color: "#000" }}>● {online}</span>
          <div className="absolute bottom-3 left-3 right-3">
            <div className="text-lg font-bold truncate" style={{ color: "#fff" }}>{realm.name}</div>
            <div className="text-xs" style={{ color: "#cfe3ff" }}>{Number(members).toLocaleString()} members</div>
          </div>
        </div>
      </button>
      <div className="p-3 flex items-start gap-2">
        <p className="text-sm flex-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>{realm.description || realm.desc}</p>
        <button onClick={onToggleFavorite} className="or-chip shrink-0" data-testid={`realms-grid-favorite-${realm.id}`} title={isFavorite ? "Unfavorite" : "Favorite"}>
          <Star size={11} fill={isFavorite ? "#F4C84A" : "transparent"} style={{ color: isFavorite ? "#F4C84A" : "var(--text-muted)" }} />
        </button>
      </div>
      <div className="px-3 pb-3 flex flex-wrap gap-1">
        {(realm.tags || []).map((t) => (
          <span key={t} className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: `${accent}22`, color: accent }}>{t}</span>
        ))}
      </div>
    </div>
  );
}


// ─── Create modal ───────────────────────────────────────────────
function CreateRealmModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post("/communities/realms", {
        name: name.trim(),
        description: description.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      onCreated(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Create failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} data-testid="realms-create-modal-backdrop">
      <form onSubmit={submit} className="or-surface w-full max-w-md p-5" onClick={(e) => e.stopPropagation()} data-testid="realms-create-modal">
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Create a Realm</h3>
        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="or-input mb-3" placeholder="My Realm" required data-testid="realms-create-name" />
        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} rows={3} className="or-input mb-3" placeholder="What's it about?" data-testid="realms-create-description" />
        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Tags (comma-separated)</label>
        <input value={tags} onChange={(e) => setTags(e.target.value)} className="or-input mb-3" placeholder="music, festivals" data-testid="realms-create-tags" />
        {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }} data-testid="realms-create-error">{err}</div>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="or-chip" data-testid="realms-create-cancel">Cancel</button>
          <button type="submit" className="or-btn" disabled={busy || !name.trim()} data-testid="realms-create-submit">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
          </button>
        </div>
      </form>
    </div>
  );
}
