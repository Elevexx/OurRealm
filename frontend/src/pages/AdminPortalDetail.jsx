/**
 * OurRealm — /admin/portals/:realmId
 *
 * Founder-only Realm detail page. Portals 1.3 wires this to the
 * `/api/admin/portals/*` backend so notes, status, enable/disable,
 * platform readiness, asset scrolls, Unity deployment, roadmap +
 * performance notes all persist across sessions and devices.
 *
 * sessionStorage is retained ONLY as an offline fallback if the
 * backend save fails — server truth always wins on reload.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, PlayCircle, Save, Pencil, Sparkles, ShieldCheck,
  Layers, Cpu, Globe, Package, AlertCircle, Loader2, CheckCircle2, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import {
  getRealmMeta,
  REALM_STATUS,
  REALM_STATUS_LABEL,
  REALM_STATUS_COLOR,
} from "@/lib/portals/realmMetadata";
import { listPlayableRealmIds } from "@/lib/portals/registry";
import { portalsApi } from "@/lib/portals/portalsApi";

// Platform keys tracked server-side (must match backend PLATFORM_KEYS).
const PLATFORMS = [
  { key: "ios_arkit",              label: "iOS ARKit" },
  { key: "android_arcore",         label: "Android ARCore" },
  { key: "visionos",               label: "visionOS" },
  { key: "meta_quest",             label: "Meta Quest" },
  { key: "webxr",                  label: "WebXR" },
  { key: "desktop_preview",        label: "Desktop Preview" },
  { key: "mobile_non_ar_fallback", label: "Mobile Fallback" },
];

const STATUS_OPTIONS = [
  REALM_STATUS.DRAFT,
  REALM_STATUS.INTERNAL_TESTING,
  REALM_STATUS.FOUNDER_PREVIEW,
  REALM_STATUS.PRIVATE_BETA,
  REALM_STATUS.PUBLIC_BETA,
  REALM_STATUS.RELEASED,
  REALM_STATUS.DISABLED,
];

const UNITY_FIELDS = [
  ["unity_project_name",       "Unity Project Name"],
  ["unity_scene_name",         "Unity Scene Name"],
  ["unity_build_target",       "Build Target"],
  ["unity_bundle_id",          "Bundle ID"],
  ["unity_version",            "Unity Version"],
  ["asset_bundle_url",         "Asset Bundle URL"],
  ["addressables_catalog_url", "Addressables Catalog URL"],
  ["webgl_build_url",          "WebGL Build URL"],
  ["ios_build_status",         "iOS Build Status"],
  ["android_build_status",     "Android Build Status"],
  ["visionos_build_status",    "visionOS Build Status"],
  ["quest_build_status",       "Quest Build Status"],
  ["release_channel",          "Release Channel"],
];

export default function AdminPortalDetail() {
  const { user }     = useAuth();
  const navigate     = useNavigate();
  const { realmId }  = useParams();
  const meta         = useMemo(() => getRealmMeta(realmId), [realmId]);
  const isPlayable   = useMemo(() => listPlayableRealmIds().includes(realmId), [realmId]);

  // Persistent server state (loaded from backend).
  const [override, setOverride]   = useState(null);
  const [loading,  setLoading]    = useState(true);
  const [loadErr,  setLoadErr]    = useState(null);

  // Editable local state for each field.
  const [notes,     setNotes]     = useState("");
  const [status,    setStatus]    = useState("");
  const [enabled,   setEnabled]   = useState(true);
  const [roadmap,   setRoadmap]   = useState("");
  const [perfNotes, setPerfNotes] = useState("");
  const [unity,     setUnity]     = useState({});
  const [platform,  setPlatform]  = useState({});   // { [key]: { supported, status, notes, … } }

  // Ephemeral flags (last-saved / error banners for each field).
  const [savingKey, setSavingKey] = useState(null);
  const [flash,     setFlash]     = useState(null); // { kind: 'ok'|'err', msg, key }

  const notesKey = `portalsDevNotes:${realmId}`;

  // ── Load from backend, fall back to sessionStorage ───────────────
  const load = useCallback(async () => {
    if (!meta) { setLoading(false); return; }
    setLoading(true);
    setLoadErr(null);
    const resp = await portalsApi.getOverride(realmId);
    if (!resp.ok) {
      setLoadErr(resp.detail || "Failed to load override from backend");
      // Offline fallback for notes only.
      try {
        const saved = sessionStorage.getItem(notesKey);
        setNotes(saved || meta.notes || "");
      } catch (_) { setNotes(meta.notes || ""); }
      setStatus(meta.status || REALM_STATUS.DRAFT);
      setEnabled(true);
      setLoading(false);
      return;
    }
    const o = resp.override || {};
    setOverride(o);
    setNotes(o.notes ?? meta.notes ?? "");
    setStatus(o.status ?? meta.status ?? REALM_STATUS.DRAFT);
    setEnabled(o.enabled !== undefined ? o.enabled : (o.status !== REALM_STATUS.DISABLED));
    setRoadmap(o.roadmap_notes || "");
    setPerfNotes(o.performance_notes || "");
    setUnity(o.unity_deployment || {});
    setPlatform(o.platform_readiness || {});
    setLoading(false);
  }, [realmId, meta, notesKey]);

  useEffect(() => { load(); }, [load]);

  const showFlash = (kind, msg, key = null) => {
    setFlash({ kind, msg, key });
    setTimeout(() => setFlash(null), 2200);
  };

  const runSave = useCallback(async (key, fn, sessionKey = null, sessionValue = null) => {
    setSavingKey(key);
    const resp = await fn();
    setSavingKey(null);
    if (!resp.ok) {
      // sessionStorage offline fallback for TEXT fields only.
      if (sessionKey) {
        try { sessionStorage.setItem(sessionKey, sessionValue ?? ""); } catch (_) { /* noop */ }
        showFlash("err", `Saved locally (backend offline: ${resp.detail || "network error"})`, key);
      } else {
        showFlash("err", `Failed: ${resp.detail || "network error"}`, key);
      }
      return null;
    }
    setOverride(resp.override);
    showFlash("ok", "Saved", key);
    return resp.override;
  }, []);

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
          className="apd-btn apd-btn-primary mt-4"
          onClick={() => navigate("/admin/portals")}
          data-testid="admin-portal-detail-back"
        >
          <ArrowLeft size={14} /> Back to Portal Dev Hub
        </button>
      </div>
    );
  }

  const effectiveStatus = status || meta.status;

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

      {loading && (
        <div className="apd-loading" data-testid="admin-portal-detail-loading">
          <Loader2 size={16} className="apd-spin" /> Loading realm from backend…
        </div>
      )}
      {loadErr && !loading && (
        <div className="apd-banner apd-banner-err" data-testid="admin-portal-detail-load-err">
          <AlertCircle size={14} /> Backend load failed — showing catalogue defaults. {loadErr}
          <button
            type="button"
            className="apd-btn apd-btn-tiny"
            onClick={load}
            data-testid="admin-portal-detail-retry"
          ><RefreshCw size={12} /> Retry</button>
        </div>
      )}

      {/* HERO */}
      <section className="apd-hero" style={{ background: meta.thumbnail }}>
        <div className="apd-hero-emoji" aria-hidden="true">{meta.emoji || "✦"}</div>
        <div className="apd-hero-body">
          <div className="apd-hero-badges">
            <span
              className="apd-badge"
              style={{ color: REALM_STATUS_COLOR[effectiveStatus], borderColor: REALM_STATUS_COLOR[effectiveStatus] }}
              data-testid="admin-portal-detail-status"
            >
              {REALM_STATUS_LABEL[effectiveStatus] || effectiveStatus}
            </span>
            <span className="apd-badge apd-badge-outline">v{meta.version}</span>
            {!isPlayable && <span className="apd-badge apd-badge-outline">Placeholder gameplay</span>}
            <span className={`apd-badge apd-badge-outline ${enabled ? "apd-badge-on" : "apd-badge-off"}`}>
              {enabled ? "Enabled" : "Disabled"}
            </span>
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

      {/* CONTROLS */}
      <section className="apd-grid">
        <PanelCard title="Status & Toggle" icon={<Sparkles size={13} />}>
          <div className="apd-field">
            <label>Status</label>
            <div className="apd-inline">
              <select
                value={effectiveStatus}
                onChange={async (e) => {
                  const next = e.target.value;
                  setStatus(next);
                  await runSave("status", () => portalsApi.setStatus(realmId, next));
                }}
                data-testid="admin-portal-detail-status-select"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{REALM_STATUS_LABEL[s] || s}</option>
                ))}
              </select>
              {savingKey === "status" && <Loader2 size={12} className="apd-spin" />}
              {flash?.key === "status" && (
                <span className={flash.kind === "ok" ? "apd-flash-ok" : "apd-flash-err"}>
                  {flash.kind === "ok" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />} {flash.msg}
                </span>
              )}
            </div>
          </div>
          <div className="apd-field">
            <label>Enabled</label>
            <div className="apd-inline">
              <button
                type="button"
                className={`apd-btn ${enabled ? "apd-btn-danger" : "apd-btn-primary"} apd-btn-tiny`}
                onClick={async () => {
                  const next = !enabled;
                  setEnabled(next);
                  await runSave("toggle", () => portalsApi.toggleEnabled(realmId, next));
                }}
                data-testid="admin-portal-detail-toggle"
              >
                {enabled ? "Disable Realm" : "Enable Realm"}
              </button>
              {savingKey === "toggle" && <Loader2 size={12} className="apd-spin" />}
              {flash?.key === "toggle" && (
                <span className={flash.kind === "ok" ? "apd-flash-ok" : "apd-flash-err"}>
                  {flash.kind === "ok" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />} {flash.msg}
                </span>
              )}
            </div>
          </div>
        </PanelCard>

        <PanelCard title="Realm Profile (catalogue defaults)" icon={<Cpu size={13} />}>
          <dl className="apd-panel-dl">
            <div><dt>Audio</dt><dd>{meta.audioProfile || "—"}</dd></div>
            <div><dt>Lighting</dt><dd>{meta.lightingProfile || "—"}</dd></div>
            <div><dt>Weather</dt><dd>{meta.weatherProfile || "—"}</dd></div>
            <div><dt>Performance</dt><dd>{meta.performanceLevel || "—"}</dd></div>
            <div><dt>Est. FPS</dt><dd>{meta.estimatedFps || "—"}</dd></div>
            <div><dt>Updated</dt><dd>{meta.lastUpdated || "—"}</dd></div>
          </dl>
        </PanelCard>

        <PanelCard title="Platforms (default)" icon={<Globe size={13} />}>
          <div className="apd-inline">
            {(meta.supportedPlatforms || []).map((p) => (
              <span key={p} className="apd-chip">{p.toUpperCase()}</span>
            ))}
          </div>
        </PanelCard>

        <PanelCard title="Required Capabilities" icon={<Layers size={13} />}>
          <div className="apd-inline">
            {(meta.requiredCapabilities || ["—"]).map((c) => (
              <code key={c} className="apd-code">{c}</code>
            ))}
          </div>
        </PanelCard>

        {/* Notes */}
        <PanelCard wide title="Notes" icon={<Pencil size={13} />}
          right={
            <SaveButton
              testid="admin-portal-detail-notes-save"
              saving={savingKey === "notes"}
              flash={flash?.key === "notes" ? flash : null}
              onClick={() => runSave("notes",
                () => portalsApi.setNotes(realmId, notes),
                notesKey, notes,
              )}
            />
          }
        >
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Leave a TODO for tomorrow…"
            rows={4}
            data-testid="admin-portal-detail-notes"
          />
        </PanelCard>

        <PanelCard wide title="Roadmap Notes" icon={<Sparkles size={13} />}
          right={
            <SaveButton
              testid="admin-portal-detail-roadmap-save"
              saving={savingKey === "roadmap"}
              flash={flash?.key === "roadmap" ? flash : null}
              onClick={() => runSave("roadmap", () => portalsApi.setRoadmapNotes(realmId, roadmap))}
            />
          }
        >
          <textarea
            value={roadmap}
            onChange={(e) => setRoadmap(e.target.value)}
            placeholder="Portals 1.4 → real fish flocking + caustics shader…"
            rows={3}
            data-testid="admin-portal-detail-roadmap"
          />
        </PanelCard>

        <PanelCard wide title="Performance Notes" icon={<Cpu size={13} />}
          right={
            <SaveButton
              testid="admin-portal-detail-perf-save"
              saving={savingKey === "perfNotes"}
              flash={flash?.key === "perfNotes" ? flash : null}
              onClick={() => runSave("perfNotes", () => portalsApi.setPerformanceNotes(realmId, perfNotes))}
            />
          }
        >
          <textarea
            value={perfNotes}
            onChange={(e) => setPerfNotes(e.target.value)}
            placeholder="Draw calls, LOD budget, mobile fallback FPS…"
            rows={3}
            data-testid="admin-portal-detail-perf"
          />
        </PanelCard>

        {/* Platform Readiness */}
        <PanelCard wide title="Platform Readiness" icon={<Globe size={13} />}
          hint="Persisted per platform. Only filled fields are sent to the backend."
        >
          <div className="apd-plat-grid" data-testid="admin-portal-detail-platform-grid">
            {PLATFORMS.map((p) => {
              const entry = platform[p.key] || {};
              const update = (patch) => setPlatform((prev) => ({ ...prev, [p.key]: { ...(prev[p.key] || {}), ...patch } }));
              const savingThis = savingKey === `plat:${p.key}`;
              const thisFlash = flash?.key === `plat:${p.key}` ? flash : null;
              const save = async () => {
                setSavingKey(`plat:${p.key}`);
                const resp = await portalsApi.setPlatformReadiness(realmId, p.key, entry);
                setSavingKey(null);
                if (resp.ok) { setOverride(resp.override); showFlash("ok", "Saved", `plat:${p.key}`); }
                else showFlash("err", resp.detail || "Save failed", `plat:${p.key}`);
              };
              return (
                <div key={p.key} className="apd-plat-card" data-testid={`admin-portal-plat-${p.key}`}>
                  <div className="apd-plat-head">
                    <label className="apd-plat-title">
                      <input
                        type="checkbox"
                        checked={!!entry.supported}
                        onChange={(e) => update({ supported: e.target.checked })}
                        data-testid={`admin-portal-plat-${p.key}-supported`}
                      />
                      {p.label}
                    </label>
                    <SaveButton
                      testid={`admin-portal-plat-${p.key}-save`}
                      saving={savingThis}
                      flash={thisFlash}
                      onClick={save}
                      tiny
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Testing status (e.g. QA in progress)"
                    value={entry.testing_status || ""}
                    onChange={(e) => update({ testing_status: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Min. device (e.g. iPhone 12 Pro)"
                    value={entry.minimum_device_requirements || ""}
                    onChange={(e) => update({ minimum_device_requirements: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Unity build profile"
                    value={entry.unity_build_profile || ""}
                    onChange={(e) => update({ unity_build_profile: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Known limitations"
                    value={entry.known_limitations || ""}
                    onChange={(e) => update({ known_limitations: e.target.value })}
                  />
                </div>
              );
            })}
          </div>
        </PanelCard>

        {/* Unity Deployment */}
        <PanelCard wide title="Unity Deployment Metadata" icon={<Package size={13} />}
          hint="Reserved schema — future Unity-built Realms will pick these up automatically."
          right={
            <SaveButton
              testid="admin-portal-detail-unity-save"
              saving={savingKey === "unity"}
              flash={flash?.key === "unity" ? flash : null}
              onClick={async () => {
                setSavingKey("unity");
                // Send only non-empty fields.
                const payload = {};
                for (const [k] of UNITY_FIELDS) if (unity[k]) payload[k] = unity[k];
                if (unity.deployment_notes) payload.deployment_notes = unity.deployment_notes;
                const resp = await portalsApi.setUnityDeployment(realmId, payload);
                setSavingKey(null);
                if (resp.ok) { setOverride(resp.override); showFlash("ok", "Saved", "unity"); }
                else showFlash("err", resp.detail || "Save failed", "unity");
              }}
            />
          }
        >
          <div className="apd-unity-grid" data-testid="admin-portal-detail-unity-grid">
            {UNITY_FIELDS.map(([k, label]) => (
              <label key={k} className="apd-unity-field">
                <span>{label}</span>
                <input
                  type="text"
                  value={unity[k] || ""}
                  onChange={(e) => setUnity((prev) => ({ ...prev, [k]: e.target.value }))}
                  data-testid={`admin-portal-detail-unity-${k}`}
                />
              </label>
            ))}
          </div>
          <label className="apd-unity-field apd-unity-field-wide">
            <span>Deployment notes</span>
            <textarea
              rows={2}
              value={unity.deployment_notes || ""}
              onChange={(e) => setUnity((prev) => ({ ...prev, deployment_notes: e.target.value }))}
              data-testid="admin-portal-detail-unity-deployment_notes"
            />
          </label>
        </PanelCard>

        {/* Asset Scrolls */}
        <PanelCard wide title="OurRealm Asset Scrolls" icon={<Layers size={13} />}
          hint="Approved modular assets referenced by this Realm. Full marketplace ships later."
          right={
            <SaveButton
              testid="admin-portal-detail-assets-save"
              saving={savingKey === "assets"}
              flash={flash?.key === "assets" ? flash : null}
              onClick={async () => {
                setSavingKey("assets");
                const list = override?.asset_scrolls || [];
                const resp = await portalsApi.setAssetScrolls(realmId, list);
                setSavingKey(null);
                if (resp.ok) { setOverride(resp.override); showFlash("ok", "Saved", "assets"); }
                else showFlash("err", resp.detail || "Save failed", "assets");
              }}
            />
          }
        >
          <AssetScrollsEditor
            realmId={realmId}
            override={override}
            onChange={(next) => setOverride((prev) => ({ ...(prev || {}), asset_scrolls: next }))}
          />
        </PanelCard>

        {/* Audit trail */}
        <PanelCard wide title="Audit History" icon={<ShieldCheck size={13} />}>
          <ol className="apd-audit" data-testid="admin-portal-detail-audit">
            {!override?.audit_history?.length && <li className="apd-muted">No changes yet.</li>}
            {(override?.audit_history || []).slice().reverse().slice(0, 20).map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="apd-audit-when">{new Date(h.at).toLocaleString()}</span>
                <span className="apd-audit-who">@{h.by_username}</span>
                <span className="apd-audit-what">{h.action} <code>{h.field}</code></span>
              </li>
            ))}
          </ol>
        </PanelCard>

        {/* Raw JSON */}
        <div className="apd-panel apd-panel-wide apd-json">
          <h3 className="apd-panel-title">Raw Persisted Override</h3>
          <pre data-testid="admin-portal-detail-json">{JSON.stringify(override ?? {}, null, 2)}</pre>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────
function PanelCard({ title, icon, right, hint, wide, children }) {
  return (
    <div className={`apd-panel ${wide ? "apd-panel-wide" : ""}`}>
      <div className="apd-panel-head">
        <h3 className="apd-panel-title">{icon}{title}</h3>
        {right}
      </div>
      {hint && <div className="apd-hint">{hint}</div>}
      {children}
    </div>
  );
}

function SaveButton({ onClick, saving, flash, testid, tiny }) {
  return (
    <div className="apd-inline">
      {flash && (
        <span className={flash.kind === "ok" ? "apd-flash-ok" : "apd-flash-err"}>
          {flash.kind === "ok" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          {flash.msg}
        </span>
      )}
      <button
        type="button"
        className={`apd-btn apd-btn-primary ${tiny ? "apd-btn-tiny" : "apd-btn-small"}`}
        onClick={onClick}
        disabled={saving}
        data-testid={testid}
      >
        {saving ? <Loader2 size={12} className="apd-spin" /> : <Save size={12} />}
        Save
      </button>
    </div>
  );
}

function AssetScrollsEditor({ realmId, override, onChange }) {
  const list = override?.asset_scrolls || [];
  const [draft, setDraft] = useState({ asset_scroll_id: "", name: "", category: "", source_type: "" });
  const add = () => {
    if (!draft.asset_scroll_id || !draft.name) return;
    onChange([...list, { ...draft }]);
    setDraft({ asset_scroll_id: "", name: "", category: "", source_type: "" });
  };
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));

  return (
    <div className="apd-assets" data-testid="admin-portal-detail-assets">
      {list.length === 0 && <div className="apd-muted">No asset scrolls attached yet.</div>}
      {list.map((a, i) => (
        <div key={`${a.asset_scroll_id}-${i}`} className="apd-asset-row" data-testid={`admin-portal-asset-${a.asset_scroll_id}`}>
          <div className="apd-asset-main">
            <div className="apd-asset-name"><b>{a.name}</b> <code>{a.asset_scroll_id}</code></div>
            <div className="apd-asset-meta">
              {a.category && <span className="apd-chip">{a.category}</span>}
              {a.source_type && <span className="apd-chip">{a.source_type}</span>}
              {(a.supported_platforms || []).map((p) => (
                <span key={p} className="apd-chip">{p}</span>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="apd-btn apd-btn-danger apd-btn-tiny"
            onClick={() => remove(i)}
            data-testid={`admin-portal-asset-remove-${a.asset_scroll_id}`}
          >Remove</button>
        </div>
      ))}
      <div className="apd-asset-add">
        <input type="text" placeholder="asset_scroll_id (e.g. tree_001)"
          value={draft.asset_scroll_id}
          onChange={(e) => setDraft({ ...draft, asset_scroll_id: e.target.value })}
          data-testid="admin-portal-asset-draft-id" />
        <input type="text" placeholder="name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          data-testid="admin-portal-asset-draft-name" />
        <input type="text" placeholder="category (trees, rocks, animals…)"
          value={draft.category}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          data-testid="admin-portal-asset-draft-category" />
        <input type="text" placeholder="source_type (unity_prefab, web, gltf…)"
          value={draft.source_type}
          onChange={(e) => setDraft({ ...draft, source_type: e.target.value })}
          data-testid="admin-portal-asset-draft-source" />
        <button
          type="button"
          className="apd-btn apd-btn-primary apd-btn-tiny"
          onClick={add}
          data-testid="admin-portal-asset-add"
        >Add</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
function DetailStyles() {
  return (
    <style>{`
      .admin-portal-detail-root {
        max-width: 1120px; margin: 0 auto;
        padding: 8px 6px 40px;
        color: var(--text, #E6FFF3);
        font-family: var(--font-display, "Inter", system-ui, sans-serif);
      }
      .apd-topbar { display: flex; align-items: center; gap: 10px; padding: 8px 4px 14px; }
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
      .apd-btn:disabled { opacity: 0.55; cursor: default; }
      .apd-btn-ghost { background: transparent; }
      .apd-btn-primary {
        background: linear-gradient(180deg, #22C55E, #15803D);
        color: #022C1A; border-color: transparent;
        box-shadow: 0 6px 18px rgba(34,197,94,0.35);
      }
      .apd-btn-danger { border-color: rgba(239,68,68,0.5); color: #fecaca; }
      .apd-btn-small { padding: 6px 12px; font-size: 11px; }
      .apd-btn-tiny  { padding: 5px 10px; font-size: 10px; }

      .apd-loading, .apd-banner {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 12px;
        border-radius: 10px;
        font-size: 12px;
        margin-bottom: 10px;
      }
      .apd-loading { color: #86efac; background: rgba(6,20,14,0.55); border: 1px solid rgba(134,239,172,0.2); }
      .apd-banner  { color: #fca5a5; background: rgba(60,10,10,0.4); border: 1px solid rgba(239,68,68,0.35); }
      .apd-spin    { animation: apd-spin 900ms linear infinite; }
      @keyframes apd-spin { to { transform: rotate(360deg); } }

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
      .apd-badge-on  { color: #86efac; border-color: rgba(134,239,172,0.55); }
      .apd-badge-off { color: #fca5a5; border-color: rgba(239,68,68,0.5); }
      .apd-h1 { margin: 0 0 6px; font-size: 26px; font-weight: 900; color: #ecfdf5; text-shadow: 0 2px 12px rgba(0,0,0,0.35); }
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
      .apd-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .apd-inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
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
        padding: 3px 8px;
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
      .apd-muted { color: rgba(187,247,208,0.55); font-size: 11px; }
      .apd-hint  { margin: -4px 0 8px; font-size: 10.5px; color: rgba(187,247,208,0.55); }

      .apd-panel textarea, .apd-panel input, .apd-panel select {
        width: 100%;
        margin-top: 4px;
        padding: 8px 10px;
        background: rgba(6,20,14,0.65);
        border: 1px solid rgba(134,239,172,0.25);
        border-radius: 8px;
        color: #ecfdf5;
        font-family: inherit; font-size: 13px; line-height: 1.5;
      }
      .apd-panel textarea { resize: vertical; min-height: 60px; }

      .apd-field { margin-top: 6px; }
      .apd-field label { display: block; font-size: 10px; letter-spacing: 0.14em; color: #86efac; text-transform: uppercase; font-weight: 800; margin-bottom: 4px; }

      .apd-flash-ok  { display: inline-flex; align-items: center; gap: 4px; color: #86efac; font-size: 11px; }
      .apd-flash-err { display: inline-flex; align-items: center; gap: 4px; color: #fca5a5; font-size: 11px; }

      /* Platform grid */
      .apd-plat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
      .apd-plat-card {
        padding: 10px 12px;
        background: rgba(6,20,14,0.55);
        border: 1px solid rgba(134,239,172,0.18);
        border-radius: 10px;
      }
      .apd-plat-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; }
      .apd-plat-title {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #ecfdf5; font-weight: 800;
      }
      .apd-plat-title input[type=checkbox] { width: auto; margin: 0; }
      .apd-plat-card input { margin-top: 6px; font-size: 11.5px; padding: 5px 8px; }

      /* Unity fields */
      .apd-unity-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
      .apd-unity-field { display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; color: #86efac; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
      .apd-unity-field input, .apd-unity-field textarea { font-size: 12px; padding: 6px 8px; }
      .apd-unity-field-wide { margin-top: 8px; }

      /* Asset Scrolls */
      .apd-assets { display: flex; flex-direction: column; gap: 8px; }
      .apd-asset-row {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 8px 10px;
        background: rgba(6,20,14,0.55);
        border: 1px solid rgba(134,239,172,0.15);
        border-radius: 10px;
      }
      .apd-asset-main { display: flex; flex-direction: column; gap: 4px; }
      .apd-asset-name { font-size: 12px; color: #ecfdf5; }
      .apd-asset-meta { display: flex; flex-wrap: wrap; gap: 4px; }
      .apd-asset-add {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 6px; align-items: end;
        padding: 10px;
        background: rgba(6,20,14,0.3);
        border: 1px dashed rgba(134,239,172,0.25);
        border-radius: 10px;
      }
      .apd-asset-add input { font-size: 12px; padding: 6px 8px; }
      .apd-asset-add button { grid-column: -2 / -1; }

      /* Audit */
      .apd-audit { margin: 0; padding-left: 18px; font-size: 11px; color: #ecfdf5; }
      .apd-audit li { margin: 4px 0; display: grid; grid-template-columns: 160px 100px 1fr; gap: 8px; }
      .apd-audit-when { color: rgba(187,247,208,0.7); font-family: monospace; }
      .apd-audit-who  { color: #86efac; font-weight: 700; }
      .apd-audit-what { color: #ecfdf5; }
      .apd-audit-what code { color: #f0abfc; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

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
        .apd-audit li { grid-template-columns: 1fr; gap: 2px; }
      }
    `}</style>
  );
}
