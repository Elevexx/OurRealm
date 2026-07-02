/**
 * OurRealm — /admin/portals/:realmId
 *
 * Founder-only Realm detail page. Read-only in Portals 1.2 (metadata
 * inspector + performance profile + JSON view). "Notes" is
 * editable in-session and persisted to sessionStorage so the founder
 * can leave TODOs across a dev day without a backend round-trip.
 * Server persistence lands in a future phase.
 */
import React, { useMemo, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, PlayCircle, Save, Pencil, Sparkles, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import {
  getRealmMeta, REALM_STATUS_LABEL, REALM_STATUS_COLOR,
} from "@/lib/portals/realmMetadata";
import { listPlayableRealmIds } from "@/lib/portals/registry";

export default function AdminPortalDetail() {
  const { user }        = useAuth();
  const navigate        = useNavigate();
  const { realmId }     = useParams();
  const meta            = useMemo(() => getRealmMeta(realmId), [realmId]);
  const isPlayable      = useMemo(() => listPlayableRealmIds().includes(realmId), [realmId]);

  // Editable notes — sessionStorage keyed by realm.
  const notesKey = `portalsDevNotes:${realmId}`;
  const [notes, setNotes]     = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    let saved = "";
    try { saved = sessionStorage.getItem(notesKey) || ""; } catch (_) { /* noop */ }
    setNotes(saved || meta?.notes || "");
    setIsDirty(false);
  }, [notesKey, meta]);

  const onSaveNotes = () => {
    try { sessionStorage.setItem(notesKey, notes); } catch (_) { /* noop */ }
    setIsDirty(false);
  };

  // ── Guard ────────────────────────────────────────────────────────
  if (!user || !isAdmin(user)) {
    return (
      <div className="max-w-md mx-auto or-surface p-8 text-center" data-testid="admin-portal-detail-denied">
        <ShieldCheck size={28} style={{ color: "var(--primary)", margin: "0 auto" }} />
        <h2 className="text-xl mt-2" style={{ fontFamily: "var(--font-display)" }}>Portal Detail</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          This environment is restricted to the OurRealm founder.
        </p>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="max-w-md mx-auto or-surface p-8 text-center" data-testid="admin-portal-detail-missing">
        <h2 className="text-xl mt-2" style={{ fontFamily: "var(--font-display)" }}>Realm not found</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          &ldquo;{realmId}&rdquo; is not registered in the metadata catalogue.
        </p>
        <button
          type="button"
          className="apx-btn apx-btn-primary mt-4"
          onClick={() => navigate("/admin/portals")}
          data-testid="admin-portal-detail-back"
        >
          <ArrowLeft size={14} /> Back to Portal Dev Hub
        </button>
      </div>
    );
  }

  return (
    <div className="admin-portal-detail-root" data-testid="admin-portal-detail-page">
      <DetailStyles />

      <header className="apd-topbar">
        <button
          type="button"
          className="apd-btn apd-btn-ghost"
          onClick={() => navigate("/admin/portals")}
          data-testid="admin-portal-detail-back-btn"
        >
          <ArrowLeft size={14} /> Portal Dev Hub
        </button>
        <div className="apd-crumbs">Portals · {meta.name}</div>
        <div className="apd-signed-as"><ShieldCheck size={12} /> Founder</div>
      </header>

      <section className="apd-hero" style={{ background: meta.thumbnail }}>
        <div className="apd-hero-emoji" aria-hidden="true">{meta.emoji || "✦"}</div>
        <div className="apd-hero-body">
          <div className="apd-hero-badges">
            <span
              className="apd-badge"
              style={{ color: REALM_STATUS_COLOR[meta.status], borderColor: REALM_STATUS_COLOR[meta.status] }}
              data-testid="admin-portal-detail-status"
            >
              {REALM_STATUS_LABEL[meta.status] || meta.status}
            </span>
            <span className="apd-badge apd-badge-outline">v{meta.version}</span>
            {!isPlayable && <span className="apd-badge apd-badge-outline">Placeholder gameplay</span>}
          </div>
          <h1 className="apd-h1" data-testid="admin-portal-detail-name">{meta.name}</h1>
          <p className="apd-desc">{meta.longDescription || meta.description}</p>
          <div className="apd-actions">
            <button
              type="button"
              className="apd-btn apd-btn-primary"
              onClick={() => navigate(`/realms/portals/ar/xr?realm=${encodeURIComponent(meta.id)}`)}
              data-testid="admin-portal-detail-launch"
            >
              <PlayCircle size={14} /> Launch Realm
            </button>
          </div>
        </div>
      </section>

      <section className="apd-grid">
        <Field label="Platforms">
          {(meta.supportedPlatforms || []).map((p) => (
            <span key={p} className="apd-chip" data-testid={`admin-portal-detail-plat-${p}`}>{p.toUpperCase()}</span>
          ))}
        </Field>

        <Field label="Required Capabilities">
          {(meta.requiredCapabilities || ["—"]).map((c) => (
            <code key={c} className="apd-code">{c}</code>
          ))}
        </Field>

        <div className="apd-panel">
          <h3 className="apd-panel-title">Profiles</h3>
          <dl className="apd-panel-dl">
            <div><dt>Audio</dt><dd>{meta.audioProfile || "—"}</dd></div>
            <div><dt>Lighting</dt><dd>{meta.lightingProfile || "—"}</dd></div>
            <div><dt>Weather</dt><dd>{meta.weatherProfile || "—"}</dd></div>
            <div><dt>Performance</dt><dd>{meta.performanceLevel || "—"}</dd></div>
            <div><dt>Est. FPS</dt><dd>{meta.estimatedFps || "—"}</dd></div>
            <div><dt>Last updated</dt><dd>{meta.lastUpdated || "—"}</dd></div>
          </dl>
        </div>

        <div className="apd-panel">
          <h3 className="apd-panel-title"><Sparkles size={14} /> Tags</h3>
          <div className="apd-tags" data-testid="admin-portal-detail-tags">
            {(meta.tags || []).length === 0
              ? <span className="apd-muted">No tags.</span>
              : meta.tags.map((t) => <span key={t} className="apd-chip">{t}</span>)}
          </div>
        </div>

        <div className="apd-panel apd-panel-wide">
          <div className="apd-panel-head">
            <h3 className="apd-panel-title"><Pencil size={14} /> Notes</h3>
            {isDirty && (
              <button
                type="button"
                className="apd-btn apd-btn-primary apd-btn-tiny"
                onClick={onSaveNotes}
                data-testid="admin-portal-detail-notes-save"
              >
                <Save size={12} /> Save
              </button>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setIsDirty(true); }}
            placeholder="Leave a TODO for tomorrow…"
            rows={5}
            data-testid="admin-portal-detail-notes"
          />
          <div className="apd-muted apd-notes-hint">
            Notes are stored in this browser session. Cloud persistence lands in a future release.
          </div>
        </div>

        <div className="apd-panel apd-panel-wide apd-json">
          <h3 className="apd-panel-title">Raw Metadata</h3>
          <pre data-testid="admin-portal-detail-json">{JSON.stringify(meta, null, 2)}</pre>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="apd-panel">
      <h3 className="apd-panel-title">{label}</h3>
      <div className="apd-inline">{children}</div>
    </div>
  );
}

function DetailStyles() {
  return (
    <style>{`
      .admin-portal-detail-root {
        max-width: 1080px; margin: 0 auto;
        padding: 8px 6px 40px;
        color: var(--text, #E6FFF3);
        font-family: var(--font-display, "Inter", system-ui, sans-serif);
      }
      .apd-topbar {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 4px 14px;
      }
      .apd-crumbs { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #86efac; font-weight: 800; }
      .apd-signed-as {
        margin-left: auto;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 10px;
        background: color-mix(in srgb, #22c55e 15%, transparent);
        border: 1px solid rgba(134,239,172,0.35);
        border-radius: 999px;
        color: #86efac; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 800;
      }
      .apd-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px;
        background: rgba(6,20,14,0.55);
        border: 1px solid rgba(134,239,172,0.28);
        border-radius: 999px;
        color: #ecfdf5;
        font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        cursor: pointer;
      }
      .apd-btn-ghost { background: transparent; }
      .apd-btn-primary {
        background: linear-gradient(180deg, #22C55E, #15803D);
        color: #022C1A; border-color: transparent;
        box-shadow: 0 6px 18px rgba(34,197,94,0.35);
      }
      .apd-btn-tiny { padding: 5px 10px; font-size: 10px; }

      .apd-hero {
        position: relative;
        display: grid; grid-template-columns: 96px 1fr; gap: 18px;
        padding: 18px 20px;
        border-radius: 20px;
        border: 1px solid rgba(134,239,172,0.20);
        overflow: hidden;
      }
      .apd-hero::before {
        content: ""; position: absolute; inset: 0;
        background: radial-gradient(120% 90% at 100% 0%, transparent 40%, rgba(0,0,0,0.6) 100%);
        pointer-events: none;
      }
      .apd-hero-emoji {
        position: relative; z-index: 1;
        width: 96px; height: 96px;
        display: flex; align-items: center; justify-content: center;
        font-size: 56px;
        background: rgba(3,12,8,0.65);
        border-radius: 16px;
        border: 1px solid rgba(134,239,172,0.25);
      }
      .apd-hero-body { position: relative; z-index: 1; }
      .apd-hero-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
      .apd-badge {
        padding: 3px 10px;
        border: 1px solid;
        background: rgba(3,12,8,0.65);
        border-radius: 999px;
        font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 800;
      }
      .apd-badge-outline { color: #86efac; border-color: rgba(134,239,172,0.4); }
      .apd-h1 {
        margin: 0 0 6px;
        font-size: 26px; font-weight: 900;
        color: #ecfdf5;
        text-shadow: 0 2px 12px rgba(0,0,0,0.35);
      }
      .apd-desc { margin: 0 0 14px; font-size: 13px; line-height: 1.55; color: #ecfdf5; opacity: 0.95; max-width: 640px; }
      .apd-actions { display: flex; gap: 8px; flex-wrap: wrap; }

      .apd-grid {
        margin-top: 18px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 14px;
      }
      .apd-panel {
        padding: 14px 16px;
        background: rgba(3,12,8,0.85);
        border: 1px solid rgba(134,239,172,0.20);
        border-radius: 14px;
      }
      .apd-panel-wide { grid-column: 1 / -1; }
      .apd-panel-title {
        display: inline-flex; align-items: center; gap: 6px;
        margin: 0 0 8px;
        font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: #86efac; font-weight: 800;
      }
      .apd-panel-head { display: flex; align-items: center; justify-content: space-between; }
      .apd-inline { display: flex; flex-wrap: wrap; gap: 6px; }
      .apd-chip {
        padding: 4px 10px;
        background: rgba(6,20,14,0.55);
        border: 1px solid rgba(134,239,172,0.25);
        border-radius: 999px;
        color: #bbf7d0;
        font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
      }
      .apd-code {
        display: inline-block;
        padding: 4px 8px;
        background: rgba(6,20,14,0.75);
        border: 1px solid rgba(134,239,172,0.2);
        border-radius: 6px;
        color: #86efac;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
      }
      .apd-panel-dl { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
      .apd-panel-dl div { display: flex; justify-content: space-between; gap: 8px; }
      .apd-panel-dl dt { margin: 0; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(134,239,172,0.6); font-weight: 700; }
      .apd-panel-dl dd { margin: 0; font-size: 11.5px; color: #ecfdf5; font-weight: 600; }
      .apd-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .apd-muted { color: rgba(187,247,208,0.55); font-size: 11px; }

      .apd-panel textarea {
        width: 100%;
        margin-top: 4px;
        padding: 10px 12px;
        background: rgba(6,20,14,0.65);
        border: 1px solid rgba(134,239,172,0.25);
        border-radius: 10px;
        color: #ecfdf5;
        font-family: inherit; font-size: 13px; line-height: 1.5;
        resize: vertical; min-height: 96px;
      }
      .apd-notes-hint { margin-top: 6px; font-size: 10.5px; }

      .apd-json pre {
        margin: 4px 0 0;
        padding: 12px 14px;
        background: #030d09;
        border: 1px solid rgba(134,239,172,0.15);
        border-radius: 10px;
        max-height: 280px; overflow: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; color: #86efac;
        white-space: pre; word-break: normal;
      }

      @media (max-width: 640px) {
        .apd-hero { grid-template-columns: 76px 1fr; padding: 14px; }
        .apd-hero-emoji { width: 76px; height: 76px; font-size: 42px; }
        .apd-h1 { font-size: 22px; }
      }
    `}</style>
  );
}
