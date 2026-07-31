import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Upload, History, RotateCcw, Copy, Image as ImageIcon, Check } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { refreshRcManifest } from "@/lib/rcAssets";

const fmt = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
};

const SECTIONS = [
  { id: "branding", label: "Branding" },
  { id: "landing", label: "Landing Page" },
  { id: "center_types", label: "Center Types" },
  { id: "dashboard", label: "Dashboard" },
  { id: "education", label: "Education" },
  { id: "admin_system", label: "Admin & System" },
  { id: "all", label: "All Assets" },
  { id: "branding_settings", label: "Branding Settings" },
];

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Responsibility Center — Admin Media Manager (Bundle B).
// Uploads reuse the existing /api/images/upload R2 pipeline; assets are
// referenced by stable keys and update every linked page automatically.
export default function AdminRcMedia() {
  const navigate = useNavigate();
  const [section, setSection] = useState("branding");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [uploadAsset, setUploadAsset] = useState(null);
  const [versionsAsset, setVersionsAsset] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get("/admin/responsibility-center/media/assets");
      setData(r.data);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not load Responsibility Center media");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="max-w-3xl mx-auto or-surface p-8 text-center text-sm" style={{ color: "#FF6B6B" }} data-testid="rc-media-error">{err}</div>;
  if (!data) return <div className="max-w-3xl mx-auto or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>;

  const assets = section === "all"
    ? Object.values(data.sections).flat()
    : data.sections[section] || [];

  return (
    <div className="max-w-6xl mx-auto" data-testid="rc-media-page">
      <button className="or-btn or-btn-ghost mb-4" onClick={() => navigate("/admin/responsibility-center")} data-testid="rc-media-back">
        <ChevronLeft size={14} /> Responsibility Center Admin
      </button>
      <div className="mb-5">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Admin · Media</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
          <ImageIcon size={24} className="inline mr-2" style={{ color: "#2EE6FF" }} />Responsibility Center Media
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Replace logos, icons, and illustrations without code changes. Every activation is audited and updates all linked pages automatically.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto no-scrollbar">
        {SECTIONS.map((s) => (
          <button key={s.id} className="or-chip shrink-0" data-active={section === s.id}
            onClick={() => setSection(s.id)} data-testid={`rc-media-section-${s.id}`}>{s.label}</button>
        ))}
      </div>

      {section === "branding_settings" ? (
        <BrandingSettings branding={data.branding} reload={load} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="rc-media-grid">
          {assets.map((a) => (
            <AssetCard key={a.asset_key} asset={a}
              onReplace={() => setUploadAsset(a)}
              onVersions={() => setVersionsAsset(a)}
              reload={load} />
          ))}
        </div>
      )}

      {uploadAsset && <UploadModal asset={uploadAsset} close={() => setUploadAsset(null)} reload={load} />}
      {versionsAsset && <VersionsModal asset={versionsAsset} close={() => setVersionsAsset(null)} reload={load} />}
    </div>
  );
}

function AssetCard({ asset, onReplace, onVersions, reload }) {
  const active = asset.active;
  const copyKey = () => {
    navigator.clipboard?.writeText(asset.asset_key);
    toast.success("Asset key copied");
  };
  const reset = async () => {
    const reason = window.prompt(`Reset "${asset.display_name}" to the built-in default?\nWritten reason (required):`);
    if (!reason || reason.trim().length < 5) { if (reason !== null) toast.error("A reason of at least 5 characters is required"); return; }
    try {
      await apiClient.post(`/admin/responsibility-center/media/assets/${asset.asset_key}/reset`, { reason });
      toast.success("Reset to built-in default");
      refreshRcManifest();
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Reset failed"); }
  };
  const editAlt = async () => {
    const alt = window.prompt("Accessibility alt text:", asset.alt_text || "");
    if (alt === null) return;
    const reason = window.prompt("Written reason (required):");
    if (!reason || reason.trim().length < 5) { toast.error("A reason of at least 5 characters is required"); return; }
    try {
      await apiClient.patch(`/admin/responsibility-center/media/assets/${asset.asset_key}`, { alt_text: alt, reason });
      toast.success("Alt text updated");
      refreshRcManifest();
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Update failed"); }
  };
  return (
    <div className="or-surface p-3 flex flex-col" data-testid={`rc-media-card-${asset.asset_key}`}>
      <div className="rounded flex items-center justify-center mb-2 overflow-hidden"
        style={{ height: 110, background: "var(--surface-1, rgba(255,255,255,0.04))" }}>
        {active ? (
          <img src={active.url} alt={asset.alt_text} loading="lazy"
            style={{ maxHeight: 100, maxWidth: "95%", objectFit: "contain" }}
            data-testid={`rc-media-preview-${asset.asset_key}`} />
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid={`rc-media-default-${asset.asset_key}`}>Built-in default</span>
        )}
      </div>
      <div className="text-sm font-semibold">{asset.display_name}</div>
      <button className="text-[10px] font-mono text-left truncate" style={{ color: "var(--text-muted)" }}
        onClick={copyKey} title="Copy asset key" data-testid={`rc-media-key-${asset.asset_key}`}>
        <Copy size={9} className="inline mr-1" />{asset.asset_key}
      </button>
      <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{asset.description}</div>
      <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
        Recommended {asset.recommended_width}×{asset.recommended_height}
        {active?.file_meta?.width ? ` · current ${active.file_meta.width}×${active.file_meta.height}` : ""}
        {active ? ` · v${active.version} by @${active.uploaded_by_username} · ${fmt(active.activated_at)}` : ` · ${asset.version_count} version(s)`}
      </div>
      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Used in: {asset.usage.join(" · ")}</div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <button className="or-btn text-xs" onClick={onReplace} data-testid={`rc-media-replace-${asset.asset_key}`}><Upload size={11} /> Replace</button>
        <button className="or-btn or-btn-ghost text-xs" onClick={onVersions} data-testid={`rc-media-versions-${asset.asset_key}`}><History size={11} /> Versions</button>
        {active && <button className="or-btn or-btn-ghost text-xs" onClick={reset} data-testid={`rc-media-reset-${asset.asset_key}`}><RotateCcw size={11} /> Reset</button>}
        <button className="or-btn or-btn-ghost text-xs" onClick={editAlt} data-testid={`rc-media-alt-${asset.asset_key}`}>Alt</button>
      </div>
    </div>
  );
}

function UploadModal({ asset, close, reload }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dims, setDims] = useState(null);
  const [reason, setReason] = useState("");
  const [theme, setTheme] = useState("default");
  const [device, setDevice] = useState("default");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(null); // inactive version awaiting activation
  const inputRef = useRef(null);

  const pick = (f) => {
    if (!f) return;
    if (!ALLOWED_TYPES.includes(f.type)) { toast.error("Allowed formats: PNG, JPEG, WebP"); return; }
    if (f.size > MAX_UPLOAD_BYTES) { toast.error("File exceeds the 3 MB limit"); return; }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => setDims({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = url;
    setFile(f);
    setPreview(url);
    setUploaded(null);
  };

  const upload = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await apiClient.post("/images/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (!data?.url) throw new Error("Upload failed");
      const r = await apiClient.post(`/admin/responsibility-center/media/assets/${asset.asset_key}/versions`, {
        url: data.url, reason, theme_variant: theme, device_variant: device,
        file_meta: { ...dims, file_type: file.type, file_size: file.size },
      });
      setUploaded(r.data.version);
      toast.success(`Version ${r.data.version.version} uploaded (inactive) — preview then activate`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || "Upload failed");
    } finally { setBusy(false); }
  };

  const activate = async () => {
    setBusy(true);
    try {
      await apiClient.post(
        `/admin/responsibility-center/media/assets/${asset.asset_key}/versions/${uploaded.id}/activate`,
        { reason });
      toast.success(`"${asset.display_name}" updated everywhere`);
      refreshRcManifest();
      reload();
      close();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Activation failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6 overflow-y-auto" style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={close} data-testid="rc-media-upload-modal">
      <div className="or-surface p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg mb-1" style={{ fontFamily: "var(--font-display)" }}>Replace — {asset.display_name}</h3>
        <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Recommended {asset.recommended_width}×{asset.recommended_height}px · PNG, JPEG, or WebP · max 3 MB
          {asset.transparency_supported ? " · transparency supported" : ""}
        </div>
        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <div className="text-[10px] uppercase mb-1" style={{ color: "var(--text-muted)" }}>Current</div>
            <div className="rounded flex items-center justify-center" style={{ height: 90, background: "var(--surface-1, rgba(255,255,255,0.04))" }}>
              {asset.active ? <img src={asset.active.url} alt="" style={{ maxHeight: 80, maxWidth: "95%", objectFit: "contain" }} />
                : <span className="text-xs" style={{ color: "var(--text-muted)" }}>Built-in default</span>}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase mb-1" style={{ color: "var(--text-muted)" }}>New</div>
            <div className="rounded flex items-center justify-center" style={{ height: 90, background: "var(--surface-1, rgba(255,255,255,0.04))" }}>
              {preview ? <img src={preview} alt="" style={{ maxHeight: 80, maxWidth: "95%", objectFit: "contain" }} data-testid="rc-media-upload-preview" />
                : <span className="text-xs" style={{ color: "var(--text-muted)" }}>No file selected</span>}
            </div>
            {dims && <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{dims.width}×{dims.height}px</div>}
          </div>
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => pick(e.target.files?.[0])} data-testid="rc-media-file-input" />
        <div className="flex flex-wrap gap-2 mb-3">
          <button className="or-btn or-btn-ghost text-xs" onClick={() => inputRef.current?.click()} data-testid="rc-media-choose-file">Choose file</button>
          <select className="or-input text-xs py-1" value={theme} onChange={(e) => setTheme(e.target.value)} data-testid="rc-media-theme-variant">
            {["default", "neon", "millennium", "stealth", "business", "light", "dark", "high_contrast"].map((t) => <option key={t} value={t}>Theme: {t}</option>)}
          </select>
          <select className="or-input text-xs py-1" value={device} onChange={(e) => setDevice(e.target.value)} data-testid="rc-media-device-variant">
            {["default", "desktop", "tablet", "mobile", "compact"].map((t) => <option key={t} value={t}>Device: {t}</option>)}
          </select>
        </div>
        <input className="or-input w-full mb-3" placeholder="Written reason (required, min 5 characters)"
          value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rc-media-upload-reason" />
        <div className="flex justify-end gap-2">
          <button className="or-btn or-btn-ghost" onClick={close} disabled={busy}>Cancel</button>
          {!uploaded ? (
            <button className="or-btn" disabled={busy || !file || reason.trim().length < 5} onClick={upload} data-testid="rc-media-upload-btn">
              {busy ? "Uploading…" : "Upload (saved inactive)"}
            </button>
          ) : (
            <button className="or-btn" disabled={busy} onClick={activate} data-testid="rc-media-activate-btn">
              <Check size={13} /> {busy ? "Activating…" : `Activate v${uploaded.version} everywhere`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VersionsModal({ asset, close, reload }) {
  const [versions, setVersions] = useState(null);
  const load = useCallback(() =>
    apiClient.get(`/admin/responsibility-center/media/assets/${asset.asset_key}/versions`)
      .then((r) => setVersions(r.data.versions)), [asset.asset_key]);
  useEffect(() => { load(); }, [load]);

  const restore = async (v) => {
    const reason = window.prompt(`Restore version ${v.version}?\nWritten reason (required):`);
    if (!reason || reason.trim().length < 5) { if (reason !== null) toast.error("A reason of at least 5 characters is required"); return; }
    try {
      await apiClient.post(`/admin/responsibility-center/media/assets/${asset.asset_key}/versions/${v.id}/activate`, { reason });
      toast.success(`Version ${v.version} restored`);
      refreshRcManifest();
      load();
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || "Restore failed"); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6 overflow-y-auto" style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={close} data-testid="rc-media-versions-modal">
      <div className="or-surface p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Version History — {asset.display_name}</h3>
        {!versions ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>
          : versions.length === 0 ? <div className="text-sm" style={{ color: "var(--text-muted)" }}>No versions yet — the built-in default is in use.</div>
          : versions.map((v) => (
            <div key={v.id} className="flex items-center gap-3 py-2" style={{ borderBottom: "1px solid var(--border-col, rgba(255,255,255,0.08))" }}
              data-testid={`rc-media-version-${v.version}`}>
              <img src={v.url} alt="" loading="lazy" style={{ width: 52, height: 40, objectFit: "contain", background: "rgba(255,255,255,0.04)", borderRadius: 6 }} />
              <div className="min-w-0 flex-1 text-xs" style={{ color: "var(--text-muted)" }}>
                <div className="text-sm" style={{ color: "var(--text-main)" }}>
                  v{v.version} · <b style={{ color: v.status === "active" ? "#7BD88F" : "var(--text-muted)" }}>{v.status}</b>
                  {(v.theme_variant !== "default" || v.device_variant !== "default") && ` · ${v.theme_variant}/${v.device_variant}`}
                </div>
                <div>@{v.uploaded_by_username} · {fmt(v.created_at)} — {v.upload_reason}</div>
                {v.activated_at && <div>Active {fmt(v.activated_at)}{v.deactivated_at ? ` → ${fmt(v.deactivated_at)}` : ""}</div>}
              </div>
              {v.status !== "active" && (
                <button className="or-btn or-btn-ghost text-xs" onClick={() => restore(v)} data-testid={`rc-media-restore-${v.version}`}>Restore</button>
              )}
            </div>
          ))}
        <div className="flex justify-end mt-3">
          <button className="or-btn or-btn-ghost" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

const BRAND_FIELDS = [
  { key: "product_name", label: "Product Display Name", type: "text" },
  { key: "short_name", label: "Short Display Name", type: "text" },
  { key: "tagline", label: "Tagline", type: "text" },
  { key: "center_branding_enabled", label: "Center-Specific Branding Allowed", type: "bool" },
  { key: "template_logo_overrides_enabled", label: "Template Logo Overrides Allowed", type: "bool" },
  { key: "user_center_logo_allowed", label: "User-Uploaded Center Logos Allowed", type: "bool" },
  { key: "user_center_cover_allowed", label: "User-Uploaded Center Covers Allowed", type: "bool" },
];

function BrandingSettings({ branding, reload }) {
  const [draft, setDraft] = useState(branding);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiClient.patch("/admin/responsibility-center/media/branding", { updates: draft, reason });
      toast.success(r.data.changed.length ? "Branding updated everywhere" : "No changes detected");
      setReason("");
      refreshRcManifest();
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Branding update failed");
    } finally { setBusy(false); }
  };
  return (
    <div className="or-surface p-5 max-w-xl" data-testid="rc-media-branding">
      <h3 className="text-sm font-semibold mb-1">Branding Configuration</h3>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Global Responsibility Center branding — ordinary Center owners cannot change these. Every change is audited.
      </p>
      <div className="space-y-3">
        {BRAND_FIELDS.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3">
            <label className="text-xs flex-1" style={{ color: "var(--text-muted)" }}>{f.label}</label>
            {f.type === "bool" ? (
              <button className="or-chip" data-active={!!draft[f.key]}
                onClick={() => setDraft((d) => ({ ...d, [f.key]: !d[f.key] }))}
                data-testid={`rc-brand-${f.key}`}>{draft[f.key] ? "ON" : "OFF"}</button>
            ) : (
              <input className="or-input text-sm py-1" style={{ width: 260 }} value={draft[f.key] || ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                data-testid={`rc-brand-${f.key}`} />
            )}
          </div>
        ))}
      </div>
      <input className="or-input w-full mt-4 mb-2" placeholder="Written reason for this change (required)"
        value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rc-brand-reason" />
      <button className="or-btn" disabled={busy || reason.trim().length < 5} onClick={save} data-testid="rc-brand-save">
        {busy ? "Saving…" : "Save Branding"}
      </button>
    </div>
  );
}
