/**
 * OurRealm — /admin/portals
 *
 * Founder-only Portal Development Hub. Ships as a card grid of every
 * Realm the platform knows about (from `realmMetadata.js`) with:
 *   • Live status badge + version + last-updated
 *   • Platform chips (AR / VR / Phone / Tablet / Desktop)
 *   • Notes + performance profile
 *   • Actions: Launch (opens WebXR session) · Edit (metadata inspector) · Disable
 *
 * Not linked from public navigation. Access is gated by `isAdmin()`;
 * non-founders get a denial panel.
 */
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Crown, ShieldCheck, PlayCircle, Pencil, PowerOff, Power,
  Sparkles, ArrowLeft, Search, Filter,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import {
  REALM_METADATA,
  REALM_STATUS,
  REALM_STATUS_LABEL,
  REALM_STATUS_COLOR,
} from "@/lib/portals/realmMetadata";

const STATUS_FILTERS = [
  { id: "all",      label: "All" },
  { id: REALM_STATUS.FOUNDER_PREVIEW, label: "Founder Preview" },
  { id: REALM_STATUS.INTERNAL_TESTING, label: "Internal" },
  { id: REALM_STATUS.DRAFT,     label: "Draft" },
  { id: REALM_STATUS.RELEASED,  label: "Released" },
  { id: REALM_STATUS.DISABLED,  label: "Disabled" },
];

export default function AdminPortalsHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery]    = useState("");
  const [filter, setFilter]  = useState("all");
  // Runtime status overrides — persist to sessionStorage so the founder
  // can flip a realm to "Disabled" during a dev session without editing
  // the metadata file. Server-side persistence lands in a future phase.
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("portalsDevOverrides") || "{}"); }
    catch (_) { return {}; }
  });

  const persistOverrides = (next) => {
    setOverrides(next);
    try { sessionStorage.setItem("portalsDevOverrides", JSON.stringify(next)); } catch (_) { /* noop */ }
  };

  const realms = useMemo(() => {
    const q = query.trim().toLowerCase();
    return REALM_METADATA
      .map((r) => ({ ...r, status: overrides[r.id] || r.status }))
      .filter((r) => (filter === "all" ? true : r.status === filter))
      .filter((r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.tags || []).some((t) => t.toLowerCase().includes(q)),
      );
  }, [query, filter, overrides]);

  const totalPlayable = REALM_METADATA.filter((r) => r.hasGameplay).length;

  // ── Guard ────────────────────────────────────────────────────────
  if (!user || !isAdmin(user)) {
    return (
      <div className="max-w-md mx-auto or-surface p-8 text-center" data-testid="admin-portals-denied">
        <ShieldCheck size={28} style={{ color: "var(--primary)", margin: "0 auto" }} />
        <h2 className="text-xl mt-2" style={{ fontFamily: "var(--font-display)" }}>Portal Dev Hub</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          This environment is restricted to the OurRealm founder.
        </p>
      </div>
    );
  }

  const onToggleDisable = (id, current) => {
    const next = { ...overrides };
    if (current === REALM_STATUS.DISABLED) {
      const original = REALM_METADATA.find((r) => r.id === id)?.status || REALM_STATUS.DRAFT;
      next[id] = original;
    } else {
      next[id] = REALM_STATUS.DISABLED;
    }
    persistOverrides(next);
  };

  return (
    <div className="admin-portals-root" data-testid="admin-portals-hub">
      <AdminPortalsStyles />

      <header className="apx-topbar">
        <button
          type="button"
          className="apx-btn apx-btn-ghost"
          onClick={() => navigate("/admin")}
          data-testid="admin-portals-back"
        >
          <ArrowLeft size={14} /> Admin
        </button>
        <div className="apx-title">
          <Crown size={16} />
          <span>Portal Development Hub</span>
        </div>
        <div className="apx-signed-as" data-testid="admin-portals-role">
          <ShieldCheck size={12} /> Founder
        </div>
      </header>

      <section className="apx-hero">
        <div className="apx-hero-left">
          <div className="apx-eyebrow">Portals 1.2 · Internal Only</div>
          <h1 className="apx-h1">Portal Development Hub</h1>
          <p className="apx-lede">
            Every Realm on the OurRealm platform — released, drafted, or under construction.
            Only realms marked <b>Released</b> ever become visible to normal users; everything else
            lives inside this dashboard.
          </p>
        </div>
        <div className="apx-hero-stats">
          <StatChip label="Total Realms"     value={REALM_METADATA.length} />
          <StatChip label="With Gameplay"    value={totalPlayable} accent="#22c55e" />
          <StatChip label="Public"           value={REALM_METADATA.filter((r) => (overrides[r.id] || r.status) === REALM_STATUS.RELEASED).length} accent="#60a5fa" />
        </div>
      </section>

      <section className="apx-toolbar">
        <div className="apx-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search realms, tags, description…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="admin-portals-search"
          />
        </div>
        <div className="apx-filters" role="tablist" aria-label="Status filters">
          <Filter size={12} />
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`apx-chip ${filter === f.id ? "is-active" : ""}`}
              onClick={() => setFilter(f.id)}
              data-testid={`admin-portals-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section className="apx-grid" data-testid="admin-portals-grid">
        {realms.length === 0 && (
          <div className="apx-empty" data-testid="admin-portals-empty">
            No realms match this filter.
          </div>
        )}
        {realms.map((r) => (
          <RealmCard
            key={r.id}
            realm={r}
            onLaunch={() => navigate(`/realms/portals/ar/xr?realm=${encodeURIComponent(r.id)}`)}
            onEdit={()   => navigate(`/admin/portals/${encodeURIComponent(r.id)}`)}
            onToggleDisable={() => onToggleDisable(r.id, r.status)}
          />
        ))}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
function StatChip({ label, value, accent = "#86efac" }) {
  return (
    <div className="apx-stat">
      <div className="apx-stat-value" style={{ color: accent }}>{value}</div>
      <div className="apx-stat-label">{label}</div>
    </div>
  );
}

function RealmCard({ realm, onLaunch, onEdit, onToggleDisable }) {
  const disabled = realm.status === REALM_STATUS.DISABLED;
  return (
    <article
      className={`apx-card ${disabled ? "is-disabled" : ""}`}
      style={{ "--card-accent": realm.accent, "--card-secondary": realm.secondary || realm.accent }}
      data-testid={`admin-portal-card-${realm.id}`}
    >
      <div
        className="apx-card-thumb"
        style={{ background: realm.thumbnail || "linear-gradient(135deg, #0b1220, #22c55e)" }}
      >
        <span className="apx-card-emoji" aria-hidden="true">{realm.emoji || "✦"}</span>
        <span
          className="apx-card-badge"
          style={{ color: REALM_STATUS_COLOR[realm.status], borderColor: REALM_STATUS_COLOR[realm.status] }}
          data-testid={`admin-portal-status-${realm.id}`}
        >
          {REALM_STATUS_LABEL[realm.status] || realm.status}
        </span>
      </div>
      <div className="apx-card-body">
        <div className="apx-card-head">
          <h3 className="apx-card-title" data-testid={`admin-portal-name-${realm.id}`}>{realm.name}</h3>
          <span className="apx-card-version" title={`v${realm.version}`}>v{realm.version}</span>
        </div>
        <p className="apx-card-desc">{realm.description}</p>

        <div className="apx-card-platforms" aria-label="Supported platforms">
          {(realm.supportedPlatforms || []).map((p) => (
            <span key={p} className="apx-chip apx-chip-static" data-testid={`admin-portal-plat-${realm.id}-${p}`}>{p.toUpperCase()}</span>
          ))}
        </div>

        <dl className="apx-card-meta">
          <div><dt>Performance</dt><dd>{realm.performanceLevel || "—"}</dd></div>
          <div><dt>Weather</dt><dd>{realm.weatherProfile || "—"}</dd></div>
          <div><dt>Audio</dt><dd>{realm.audioProfile || "—"}</dd></div>
          <div><dt>Updated</dt><dd>{realm.lastUpdated || "—"}</dd></div>
        </dl>

        {realm.notes && (
          <div className="apx-card-notes" data-testid={`admin-portal-notes-${realm.id}`}>
            <Sparkles size={11} /> {realm.notes}
          </div>
        )}

        <div className="apx-card-actions">
          <button
            type="button"
            className="apx-btn apx-btn-primary"
            onClick={onLaunch}
            disabled={disabled}
            data-testid={`admin-portal-launch-${realm.id}`}
          >
            <PlayCircle size={14} /> Launch
          </button>
          <button
            type="button"
            className="apx-btn"
            onClick={onEdit}
            data-testid={`admin-portal-edit-${realm.id}`}
          >
            <Pencil size={14} /> Edit
          </button>
          <button
            type="button"
            className={`apx-btn ${disabled ? "apx-btn-warn" : "apx-btn-danger"}`}
            onClick={onToggleDisable}
            data-testid={`admin-portal-disable-${realm.id}`}
          >
            {disabled ? <><Power size={14} /> Enable</> : <><PowerOff size={14} /> Disable</>}
          </button>
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
function AdminPortalsStyles() {
  return (
    <style>{`
      .admin-portals-root {
        max-width: 1200px; margin: 0 auto;
        padding: 8px 6px 40px;
        color: var(--text, #E6FFF3);
        font-family: var(--font-display, "Inter", system-ui, sans-serif);
      }
      .apx-topbar {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 4px 14px;
      }
      .apx-title {
        display: inline-flex; align-items: center; gap: 8px;
        font-size: 12px; font-weight: 800; letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #86efac;
      }
      .apx-signed-as {
        margin-left: auto;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 10px;
        background: color-mix(in srgb, #22c55e 15%, transparent);
        border: 1px solid rgba(134,239,172,0.35);
        border-radius: 999px;
        color: #86efac;
        font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 800;
      }

      /* Buttons */
      .apx-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px;
        background: rgba(6,20,14,0.55);
        border: 1px solid rgba(134,239,172,0.28);
        border-radius: 999px;
        color: #ecfdf5;
        font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        cursor: pointer;
        transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
      }
      .apx-btn:hover  { border-color: #86efac; transform: translateY(-1px); }
      .apx-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
      .apx-btn-ghost  { background: transparent; }
      .apx-btn-primary {
        background: linear-gradient(180deg, #22C55E, #15803D);
        color: #022C1A; border-color: transparent;
        box-shadow: 0 6px 18px rgba(34,197,94,0.35);
      }
      .apx-btn-danger { border-color: rgba(239,68,68,0.5); color: #fca5a5; }
      .apx-btn-danger:hover { border-color: #ef4444; color: #fecaca; }
      .apx-btn-warn { border-color: rgba(251,191,36,0.5); color: #fde68a; }

      /* Hero */
      .apx-hero {
        display: grid; grid-template-columns: 1fr auto; gap: 24px;
        padding: 20px 22px;
        background: linear-gradient(135deg, rgba(6,20,14,0.85), rgba(4,12,10,0.65));
        border: 1px solid rgba(134,239,172,0.20);
        border-radius: 20px;
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      }
      .apx-eyebrow { font-size: 10px; letter-spacing: 0.32em; text-transform: uppercase; color: #86efac; font-weight: 800; }
      .apx-h1 { margin: 6px 0 4px; font-size: 28px; font-weight: 900;
        background: linear-gradient(180deg, #ECFDF5, #86EFAC); -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; }
      .apx-lede { margin: 0; font-size: 13px; line-height: 1.6; color: #bbf7d0; max-width: 640px; }
      .apx-hero-stats { display: flex; gap: 10px; align-items: center; }
      .apx-stat {
        min-width: 84px;
        padding: 10px 14px;
        border: 1px solid rgba(134,239,172,0.28);
        border-radius: 12px;
        background: rgba(3,12,8,0.6);
        text-align: center;
      }
      .apx-stat-value { font-size: 22px; font-weight: 900; line-height: 1; }
      .apx-stat-label { margin-top: 4px; font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase; color: #86efac; font-weight: 700; }

      /* Toolbar */
      .apx-toolbar {
        display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
        margin: 18px 0 14px;
      }
      .apx-search {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 12px; min-width: 220px;
        background: rgba(6,20,14,0.6);
        border: 1px solid rgba(134,239,172,0.25);
        border-radius: 999px;
        color: #86efac;
      }
      .apx-search input {
        background: none; border: none; outline: none; color: #ecfdf5;
        font-size: 13px; width: 100%;
      }
      .apx-filters { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; color: #86efac; }
      .apx-chip {
        padding: 5px 12px;
        background: rgba(6,20,14,0.6);
        border: 1px solid rgba(134,239,172,0.25);
        border-radius: 999px;
        color: #bbf7d0;
        font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
        cursor: pointer;
      }
      .apx-chip:hover { border-color: #86efac; }
      .apx-chip.is-active {
        background: linear-gradient(180deg, #22C55E, #15803D);
        color: #022c1a; border-color: transparent;
      }
      .apx-chip-static { cursor: default; }
      .apx-chip-static:hover { border-color: rgba(134,239,172,0.25); }

      /* Grid */
      .apx-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 18px;
      }
      .apx-empty {
        grid-column: 1 / -1; padding: 40px; text-align: center;
        color: #86efac; font-size: 13px;
      }

      /* Card */
      .apx-card {
        display: flex; flex-direction: column;
        background: rgba(3,12,8,0.85);
        border: 1px solid rgba(134,239,172,0.20);
        border-radius: 18px;
        overflow: hidden;
        transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
      }
      .apx-card:hover {
        transform: translateY(-2px);
        border-color: var(--card-accent, #86efac);
        box-shadow: 0 14px 40px rgba(0,0,0,0.55), 0 0 0 1px var(--card-accent, #86efac) inset;
      }
      .apx-card.is-disabled { opacity: 0.55; }

      .apx-card-thumb {
        position: relative;
        height: 108px;
        display: flex; align-items: center; justify-content: center;
      }
      .apx-card-thumb::after {
        content: ""; position: absolute; inset: 0;
        background: radial-gradient(120% 90% at 50% 100%, transparent 40%, rgba(0,0,0,0.55) 100%);
      }
      .apx-card-emoji {
        position: relative; z-index: 1;
        font-size: 44px;
        filter: drop-shadow(0 6px 12px rgba(0,0,0,0.5));
      }
      .apx-card-badge {
        position: absolute; top: 10px; right: 10px;
        padding: 3px 9px;
        background: rgba(3,12,8,0.75);
        border: 1px solid;
        border-radius: 999px;
        font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;
        backdrop-filter: blur(4px);
      }
      .apx-card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
      .apx-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .apx-card-title { margin: 0; font-size: 17px; font-weight: 900; color: #ecfdf5; }
      .apx-card-version {
        font-size: 10px; letter-spacing: 0.1em; color: rgba(134,239,172,0.7); font-family: monospace;
      }
      .apx-card-desc { margin: 0; font-size: 12.5px; line-height: 1.5; color: #bbf7d0; }
      .apx-card-platforms { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
      .apx-card-meta {
        display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px;
        margin: 6px 0 0; padding: 8px 10px;
        background: rgba(6,20,14,0.55);
        border: 1px solid rgba(134,239,172,0.15);
        border-radius: 10px;
      }
      .apx-card-meta div { display: flex; justify-content: space-between; gap: 8px; }
      .apx-card-meta dt { margin: 0; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(134,239,172,0.6); font-weight: 700; }
      .apx-card-meta dd { margin: 0; font-size: 10.5px; color: #ecfdf5; font-weight: 600; }
      .apx-card-notes {
        display: inline-flex; align-items: flex-start; gap: 6px;
        padding: 6px 10px;
        background: rgba(134,239,172,0.06);
        border: 1px dashed rgba(134,239,172,0.25);
        border-radius: 8px;
        color: #bbf7d0;
        font-size: 11px; line-height: 1.45;
      }
      .apx-card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      .apx-card-actions .apx-btn { padding: 7px 12px; font-size: 10.5px; }

      /* Responsive */
      @media (max-width: 720px) {
        .apx-hero { grid-template-columns: 1fr; }
        .apx-hero-stats { flex-wrap: wrap; }
        .apx-h1 { font-size: 24px; }
        .apx-lede { font-size: 12.5px; }
        .apx-title { display: none; }
      }
    `}</style>
  );
}
