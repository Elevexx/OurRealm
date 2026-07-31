/**
 * AdminWebsiteMedia — founder-only (@stealth) Website Media console.
 * Route: /admin/WebsiteMedia
 *
 * Section 1: Logos & Wordmarks per mode (upload → crop → draft →
 *            preview → publish / discard / rollback).
 * Section 2: New User Tutorial Builder (slides, settings, draft /
 *            preview / publish / rollback).
 *
 * All uploads go through the existing R2 pipelines (/api/images/upload,
 * /api/videos/upload) — only durable URLs are stored. All mutations are
 * founder-gated server-side.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import AdminBackButton from "@/components/AdminBackButton";
import ImageCropperModal from "@/components/ImageCropperModal";
import TutorialPopup from "@/components/TutorialPopup";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import { invalidateWebsiteMediaCache, LOGO_URL } from "@/components/Logo";
import {
  Image as ImageIcon, Upload, Eye, Trash2, RotateCcw, Loader2, Search,
  CheckCircle2, GripVertical, ArrowUp, ArrowDown, Copy, Pencil, Plus,
  PlayCircle, Settings2, X,
} from "lucide-react";
import { toast } from "sonner";

const FILTERS = ["All Modes", "Draft Changes", "Published"];

function Badge({ children, color = "#2EA0FF" }) {
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: `${color}22`, color, border: `1px solid ${color}` }}>
      {children}
    </span>
  );
}

function Thumb({ url, label, wide = false }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center justify-center overflow-hidden"
           style={{ width: wide ? 110 : 54, height: 54, borderRadius: 8,
                    background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-col)" }}>
        {url ? (
          <img src={resolveMediaUrl(url)} alt={label} loading="lazy"
               style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
               onError={(e) => { e.currentTarget.style.display = "none"; }} />
        ) : (
          <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>none</span>
        )}
      </div>
      <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// ─── Section 1: Logos & Wordmarks ────────────────────────────────────
function ModesManager() {
  const [modes, setModes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("All Modes");
  const [q, setQ] = useState("");
  const [crop, setCrop] = useState(null); // {modeKey, kind, src}
  const [previewMode, setPreviewMode] = useState(null);
  const fileRef = useRef(null);
  const pendingRef = useRef(null);

  const load = useCallback(async () => {
    try { const { data } = await apiClient.get("/admin/website-media"); setModes(data.modes); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to load Website Media"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pick = (modeKey, kind) => { pendingRef.current = { modeKey, kind }; fileRef.current?.click(); };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !pendingRef.current) return;
    const okTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!okTypes.includes(f.type)) { toast.error("Use PNG, JPG, or WebP (transparent PNG/WebP recommended)."); return; }
    if (f.size > 5 * 1024 * 1024) { toast.error("Max 5 MB per image."); return; }
    setCrop({ ...pendingRef.current, src: URL.createObjectURL(f) });
  };

  const applyCrop = async (blob) => {
    const { modeKey, kind } = crop;
    setCrop(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", new File([blob], `${modeKey}-${kind}.png`, { type: "image/png" }));
      const { data } = await apiClient.post("/images/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (!data?.url) throw new Error("Upload failed");
      const body = kind === "logo" ? { draft_logo_url: data.url } : { draft_wordmark_url: data.url };
      const res = await apiClient.patch(`/admin/website-media/modes/${modeKey}`, body);
      setModes((prev) => prev.map((m) => (m.mode_key === modeKey ? res.data.mode : m)));
      toast.success(`${kind === "logo" ? "Logo" : "Wordmark"} draft saved.`);
    } catch (e) { toast.error(e.response?.data?.detail || "Upload failed."); }
    setBusy(false);
  };

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); await load(); invalidateWebsiteMediaCache(); }
    catch (e) { toast.error(e.response?.data?.detail || "Action failed. The live version was not changed."); }
    setBusy(false);
  };

  const drafts = (modes || []).filter((m) => m.draft_logo_url || m.draft_wordmark_url);
  const shown = (modes || []).filter((m) => {
    if (q && !m.mode_name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "Draft Changes") return m.draft_logo_url || m.draft_wordmark_url;
    if (filter === "Published") return m.published_logo_url || m.published_wordmark_url;
    return true;
  });

  if (!modes) return <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="inline animate-spin mr-2" />Loading modes…</div>;

  return (
    <div data-testid="wm-modes-section">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {FILTERS.map((f) => (
          <button key={f} className="or-chip" onClick={() => setFilter(f)}
                  style={filter === f ? { background: "var(--primary)", color: "var(--primary-fg)" } : {}}
                  data-testid={`wm-filter-${f.replace(/ /g, "-")}`}>{f}</button>
        ))}
        <div className="flex items-center gap-1 ml-auto px-2 py-1" style={{ background: "var(--surface-2)", borderRadius: 8 }}>
          <Search size={12} style={{ color: "var(--text-muted)" }} />
          <input className="bg-transparent text-xs outline-none" placeholder="Search modes…" value={q}
                 onChange={(e) => setQ(e.target.value)} style={{ color: "var(--text-main)", width: 110 }}
                 data-testid="wm-mode-search" />
        </div>
      </div>

      {drafts.length > 0 && (
        <div className="or-surface p-3 mb-3 flex items-center gap-3 flex-wrap" data-testid="wm-publish-bar">
          <span className="text-xs" style={{ color: "#F4C84A" }}>● {drafts.length} mode{drafts.length > 1 ? "s" : ""} with unsaved draft changes</span>
          <button className="or-btn ml-auto" disabled={busy}
                  onClick={() => {
                    const names = drafts.map((d) => d.mode_name).join(", ");
                    if (window.confirm(`Publish these Website Media changes to all users?\n\nAffected modes: ${names}`)) {
                      act(() => apiClient.post("/admin/website-media/publish", { mode_keys: drafts.map((d) => d.mode_key) }),
                          "Website Media published.");
                    }
                  }}
                  data-testid="wm-publish-all" style={{ padding: "0.4rem 1rem" }}>
            Publish Changes
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} data-testid="wm-file-input" />

      <div className="space-y-2">
        {shown.map((m) => {
          const hasDraft = m.draft_logo_url || m.draft_wordmark_url;
          return (
            <div key={m.mode_key} className="or-surface p-3" data-testid={`wm-mode-${m.mode_key}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="rounded-full shrink-0" style={{ width: 10, height: 10, background: m.accent }} />
                <div className="min-w-[110px]">
                  <div className="text-sm font-bold" style={{ color: "var(--text-main)" }}>{m.mode_name}</div>
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {m.published_at ? `published ${m.published_at.slice(0, 10)}` : "never published"} · v{m.version}
                  </div>
                </div>
                <Thumb url={m.draft_logo_url || m.published_logo_url} label={m.draft_logo_url ? "logo (draft)" : "logo"} />
                <Thumb url={m.draft_wordmark_url || m.published_wordmark_url} label={m.draft_wordmark_url ? "wordmark (draft)" : "wordmark"} wide />
                <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                  {hasDraft ? <Badge color="#F4C84A">DRAFT</Badge> : (m.published_logo_url || m.published_wordmark_url) ? <Badge color="#10E670">PUBLISHED</Badge> : <Badge color="#8899AA">EMPTY</Badge>}
                  <button className="or-chip" disabled={busy} onClick={() => pick(m.mode_key, "logo")} data-testid={`wm-replace-logo-${m.mode_key}`}><Upload size={11} /> Logo</button>
                  <button className="or-chip" disabled={busy} onClick={() => pick(m.mode_key, "wordmark")} data-testid={`wm-replace-wordmark-${m.mode_key}`}><Upload size={11} /> Wordmark</button>
                  <button className="or-chip" onClick={() => setPreviewMode(m)} data-testid={`wm-preview-${m.mode_key}`}><Eye size={11} /></button>
                  {hasDraft && (
                    <button className="or-chip" disabled={busy} style={{ color: "#FF6B6B" }}
                            onClick={() => act(() => apiClient.post("/admin/website-media/discard-draft", { mode_key: m.mode_key }), "Draft discarded — published assets restored.")}
                            data-testid={`wm-discard-${m.mode_key}`}><Trash2 size={11} /></button>
                  )}
                  {m.version > 0 && (
                    <button className="or-chip" disabled={busy}
                            onClick={() => { if (window.confirm(`Restore the previous published version for ${m.mode_name}?`)) act(() => apiClient.post("/admin/website-media/rollback", { mode_key: m.mode_key }), "Previous version restored."); }}
                            data-testid={`wm-rollback-${m.mode_key}`}><RotateCcw size={11} /></button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ImageCropperModal
        open={!!crop}
        src={crop?.src}
        aspect={crop?.kind === "logo" ? 1 : 5}
        cropShape="rect"
        title={crop?.kind === "logo" ? "Crop logo (1:1 — 320×320 recommended)" : "Crop wordmark (5:1 — 600×120 recommended)"}
        maxWidth={crop?.kind === "logo" ? 640 : 1200}
        outputMime="image/png"
        onApply={applyCrop}
        onCancel={() => setCrop(null)}
        testid="wm-cropper"
      />

      {previewMode && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center px-3"
             style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
             onClick={() => setPreviewMode(null)} data-testid="wm-nav-preview">
          <div className="or-surface w-full max-w-xl p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold" style={{ color: "var(--text-main)" }}>Top navigation preview — {previewMode.mode_name}</h4>
              <button className="starbar-icon" style={{ width: 28, height: 28 }} onClick={() => setPreviewMode(null)}><X size={13} /></button>
            </div>
            <div className="flex items-center gap-2 px-4 py-3"
                 style={{ background: "var(--bgc, #05080d)", borderRadius: "var(--radius)", border: "1px solid var(--border-col)" }}>
              <img src={resolveMediaUrl(previewMode.draft_logo_url || previewMode.published_logo_url || LOGO_URL)} alt="logo"
                   style={{ width: 44, height: 44, objectFit: "contain" }} />
              {(previewMode.draft_wordmark_url || previewMode.published_wordmark_url) && (
                <img src={resolveMediaUrl(previewMode.draft_wordmark_url || previewMode.published_wordmark_url)} alt="wordmark"
                     style={{ height: 24, maxWidth: 180, objectFit: "contain" }} />
              )}
              <span className="or-chip ml-auto" style={{ borderColor: previewMode.accent, color: previewMode.accent }}>{previewMode.mode_name.toUpperCase()}</span>
            </div>
            <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
              {previewMode.draft_logo_url || previewMode.draft_wordmark_url ? "Showing DRAFT assets — publish to go live." : "Showing published assets."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section 2: Tutorial Builder ─────────────────────────────────────
const EMPTY_SLIDE = {
  media_type: "image", media_url: "", poster_url: null, title: "", description: "",
  alt_text: "", button_label: "", button_action: "none", button_target: "",
  background: "", text_align: "center", image_fit: "cover", autoplay: true,
  loop: false, muted: true, show_controls: true, duration_ms: null, enabled: true,
};

function SlideEditor({ slide, onSave, onClose, busy }) {
  const [s, setS] = useState({ ...EMPTY_SLIDE, ...slide });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const set = (k, v) => setS((p) => ({ ...p, [k]: v }));

  const upload = async (f) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const isVideo = f.type.startsWith("video/");
      if (isVideo && f.size > 100 * 1024 * 1024) { toast.error("Max 100 MB per video."); setUploading(false); return; }
      if (!isVideo && f.size > 10 * 1024 * 1024) { toast.error("Max 10 MB per image."); setUploading(false); return; }
      const { data } = await apiClient.post(isVideo ? "/videos/upload" : "/images/upload", fd,
        { headers: { "Content-Type": "multipart/form-data" } });
      const url = data?.url || data?.video?.url;
      if (!url) throw new Error("Upload failed");
      setS((p) => ({ ...p, media_url: url, media_type: isVideo ? "video" : "image",
                     poster_url: isVideo ? (data?.video?.thumbnail_url || p.poster_url) : null }));
      toast.success(isVideo ? "Video uploaded." : "Image uploaded.");
    } catch (e) { toast.error(e.response?.data?.detail || "Upload failed."); }
    setUploading(false);
  };

  return (
    <div className="fixed inset-0 z-[215] flex items-center justify-center px-3"
         style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }} data-testid="wm-slide-editor">
      <div className="or-surface w-full max-w-lg p-4" style={{ maxHeight: "90dvh", overflow: "auto" }}>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold" style={{ color: "var(--text-main)" }}>{slide?.id ? "Edit slide" : "New slide"}</h4>
          <button className="starbar-icon" style={{ width: 28, height: 28 }} onClick={onClose}><X size={13} /></button>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
               className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }}
               data-testid="wm-slide-file" />
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <button className="or-btn" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="wm-slide-upload">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {s.media_url ? "Replace media" : "Upload image or video"}
            </button>
            {s.media_url && <Badge color="#10E670">{s.media_type.toUpperCase()} READY</Badge>}
          </div>
          {s.media_url && (s.media_type === "image"
            ? <img src={resolveMediaUrl(s.media_url)} alt="" style={{ maxHeight: 140, borderRadius: 8 }} />
            : <video src={resolveMediaUrl(s.media_url)} controls muted playsInline style={{ maxHeight: 140, borderRadius: 8 }} />)}
          <input className="or-input w-full" placeholder="Title (optional)" value={s.title || ""} maxLength={120}
                 onChange={(e) => set("title", e.target.value)} data-testid="wm-slide-title" />
          <textarea className="or-input w-full" rows={2} placeholder="Short description (optional)" value={s.description || ""}
                    maxLength={500} onChange={(e) => set("description", e.target.value)} data-testid="wm-slide-desc" />
          <input className="or-input w-full" placeholder="Alt text / video caption (accessibility)" value={s.alt_text || ""}
                 maxLength={200} onChange={(e) => set("alt_text", e.target.value)} data-testid="wm-slide-alt" />
          <div className="grid grid-cols-2 gap-2">
            <input className="or-input" placeholder="Button label" value={s.button_label || ""} maxLength={40}
                   onChange={(e) => set("button_label", e.target.value)} data-testid="wm-slide-btn-label" />
            <select className="or-input" value={s.button_action} onChange={(e) => set("button_action", e.target.value)} data-testid="wm-slide-btn-action">
              <option value="none">No button</option>
              <option value="next">Next slide</option>
              <option value="finish">Finish tutorial</option>
              <option value="route">Open internal route</option>
            </select>
          </div>
          {s.button_action === "route" && (
            <input className="or-input w-full" placeholder="/foryou" value={s.button_target || ""}
                   onChange={(e) => set("button_target", e.target.value)} data-testid="wm-slide-btn-target" />
          )}
          <div className="grid grid-cols-2 gap-2">
            <select className="or-input" value={s.text_align} onChange={(e) => set("text_align", e.target.value)}>
              <option value="center">Text: center</option><option value="left">Text: left</option>
            </select>
            <select className="or-input" value={s.image_fit} onChange={(e) => set("image_fit", e.target.value)}>
              <option value="cover">Image fit: cover</option><option value="contain">Image fit: contain</option>
            </select>
          </div>
          {s.media_type === "video" && (
            <div className="flex gap-3 flex-wrap text-xs" style={{ color: "var(--text-muted)" }}>
              {[["autoplay", "Autoplay (muted)"], ["loop", "Loop"], ["show_controls", "Controls"]].map(([k, l]) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="checkbox" checked={!!s[k]} onChange={(e) => set(k, e.target.checked)} /> {l}
                </label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <input type="checkbox" checked={!!s.enabled} onChange={(e) => set("enabled", e.target.checked)} data-testid="wm-slide-enabled" /> Enabled
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button className="or-btn or-btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button className="or-btn" disabled={busy || uploading || !s.media_url}
                  onClick={() => onSave(s)} data-testid="wm-slide-save">
            <CheckCircle2 size={13} /> Save slide
          </button>
        </div>
      </div>
    </div>
  );
}

function TutorialBuilder() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);       // slide object or {} for new
  const [preview, setPreview] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [showToEveryone, setShowToEveryone] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await apiClient.get("/admin/tutorial"); setData(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to load tutorial"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const t = data?.tutorial;
  const slides = t?.draft_slides || [];

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); await load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Action failed."); }
    setBusy(false);
  };

  const saveSlide = (s) => act(async () => {
    if (s.id) await apiClient.patch(`/admin/tutorial/slides/${s.id}`, s);
    else await apiClient.post("/admin/tutorial/slides", s);
    setEditing(null);
  }, "Slide saved to draft.");

  const move = (i, dir) => {
    const ids = slides.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act(() => apiClient.post("/admin/tutorial/slides/reorder", { slide_ids: ids }));
  };

  const patchSettings = (body) => act(() => apiClient.patch("/admin/tutorial", body), "Tutorial draft saved.");

  if (!data) return <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}><Loader2 size={14} className="inline animate-spin mr-2" />Loading tutorial…</div>;

  const enabledSlides = slides.filter((s) => s.enabled);
  const imgCount = enabledSlides.filter((s) => s.media_type === "image").length;
  const vidCount = enabledSlides.filter((s) => s.media_type === "video").length;

  return (
    <div data-testid="wm-tutorial-section">
      <div className="or-surface p-3 mb-3 flex items-center gap-2 flex-wrap">
        <Badge color={t.status === "published" ? "#10E670" : t.status === "disabled" ? "#FF3F5A" : "#F4C84A"}>{(t.status || "draft").toUpperCase()}</Badge>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>v{t.version} · {slides.length} draft slides · audience: {t.audience}</span>
        <div className="ml-auto flex gap-2 flex-wrap">
          <button className="or-chip" onClick={() => setShowSettings((v) => !v)} data-testid="wm-tutorial-settings-toggle"><Settings2 size={11} /> Settings</button>
          <button className="or-chip" onClick={() => setEditing({})} data-testid="wm-add-slide"><Plus size={11} /> Add Slide</button>
        </div>
      </div>

      {showSettings && (
        <div className="or-surface p-4 mb-3 grid sm:grid-cols-2 gap-3 text-sm" data-testid="wm-tutorial-settings">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>Tutorial name
            <input className="or-input w-full mt-1" defaultValue={t.name} maxLength={80}
                   onBlur={(e) => e.target.value !== t.name && patchSettings({ name: e.target.value })}
                   data-testid="wm-tutorial-name" />
          </label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>Audience
            <select className="or-input w-full mt-1" value={t.audience} onChange={(e) => patchSettings({ audience: e.target.value })} data-testid="wm-tutorial-audience">
              <option value="new_users">Brand-new users only</option>
              <option value="not_completed">Users who never completed this version</option>
              <option value="all_users">All users (testing)</option>
              <option value="founder_only">Founder preview only</option>
            </select>
          </label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>Status
            <select className="or-input w-full mt-1" value={t.status} onChange={(e) => patchSettings({ status: e.target.value })} data-testid="wm-tutorial-status">
              <option value="draft">Draft</option><option value="published">Published</option><option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>Show delay (ms)
            <input className="or-input w-full mt-1" type="number" min={0} max={60000} defaultValue={t.show_delay_ms}
                   onBlur={(e) => patchSettings({ show_delay_ms: parseInt(e.target.value || "0", 10) })} />
          </label>
          <div className="flex gap-4 flex-wrap text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>
            {[["allow_skip", "Allow Skip"], ["allow_close", "Allow Close"], ["show_progress", "Progress dots"]].map(([k, l]) => (
              <label key={k} className="flex items-center gap-1">
                <input type="checkbox" checked={!!t[k]} onChange={(e) => patchSettings({ [k]: e.target.checked })} data-testid={`wm-setting-${k}`} /> {l}
              </label>
            ))}
          </div>
        </div>
      )}

      {slides.length === 0 ? (
        <div className="or-surface p-8 text-center mb-3" data-testid="wm-tutorial-empty">
          <PlayCircle size={24} className="mx-auto mb-2" style={{ color: "var(--primary)" }} />
          <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>No slides yet</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Add image or video slides to build the new-user tutorial.</div>
        </div>
      ) : (
        <div className="space-y-2 mb-3">
          {slides.map((s, i) => (
            <div key={s.id} className="or-surface p-2.5 flex items-center gap-2.5" data-testid={`wm-slide-row-${i}`}>
              <GripVertical size={13} style={{ color: "var(--text-muted)" }} />
              <span className="text-xs font-bold w-5 text-center" style={{ color: "var(--text-muted)" }}>{i + 1}</span>
              <div className="overflow-hidden shrink-0 flex items-center justify-center"
                   style={{ width: 56, height: 36, borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
                <img src={resolveMediaUrl(s.media_type === "video" ? (s.poster_url || s.media_url) : s.media_url)} alt=""
                     loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }}
                     onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </div>
              <Badge color={s.media_type === "video" ? "#C26BFF" : "#2EA0FF"}>{s.media_type.toUpperCase()}</Badge>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate" style={{ color: "var(--text-main)" }}>{s.title || "Untitled slide"}</div>
                <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{s.description || "—"}</div>
              </div>
              {!s.enabled && <Badge color="#8899AA">DISABLED</Badge>}
              <div className="flex gap-1">
                <button className="starbar-icon" style={{ width: 26, height: 26 }} disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move up" data-testid={`wm-slide-up-${i}`}><ArrowUp size={12} /></button>
                <button className="starbar-icon" style={{ width: 26, height: 26 }} disabled={busy || i === slides.length - 1} onClick={() => move(i, 1)} aria-label="Move down" data-testid={`wm-slide-down-${i}`}><ArrowDown size={12} /></button>
                <button className="starbar-icon" style={{ width: 26, height: 26 }} onClick={() => setEditing(s)} aria-label="Edit slide" data-testid={`wm-slide-edit-${i}`}><Pencil size={12} /></button>
                <button className="starbar-icon" style={{ width: 26, height: 26 }} disabled={busy}
                        onClick={() => act(() => apiClient.post(`/admin/tutorial/slides/${s.id}/duplicate`), "Slide duplicated.")}
                        aria-label="Duplicate slide" data-testid={`wm-slide-dup-${i}`}><Copy size={12} /></button>
                <button className="starbar-icon" style={{ width: 26, height: 26, color: "#FF6B6B" }} disabled={busy}
                        onClick={() => { if (window.confirm("Delete this draft slide?")) act(() => apiClient.delete(`/admin/tutorial/slides/${s.id}`), "Slide deleted."); }}
                        aria-label="Delete slide" data-testid={`wm-slide-del-${i}`}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="or-surface p-3 flex items-center gap-2 flex-wrap" data-testid="wm-tutorial-actions">
        <button className="or-chip" style={{ color: "#FF6B6B" }} disabled={busy || slides.length === 0}
                onClick={() => {
                  const phrase = window.prompt('Type "DELETE DRAFT" to remove all draft slides:');
                  if (phrase === "DELETE DRAFT") act(() => apiClient.delete("/admin/tutorial/draft"), "Tutorial draft deleted.");
                }}
                data-testid="wm-tutorial-delete-draft"><Trash2 size={11} /> Delete Draft</button>
        <button className="or-chip" disabled={busy || enabledSlides.length === 0}
                onClick={() => setPreview({ version: 0, name: t.name, settings: t, slides: enabledSlides })}
                data-testid="wm-tutorial-preview"><Eye size={11} /> Preview Tutorial</button>
        {(data.versions || []).length > 0 && (
          <button className="or-chip" disabled={busy}
                  onClick={() => { if (window.confirm("Restore the previous published tutorial version?")) act(() => apiClient.post("/admin/tutorial/rollback"), "Previous tutorial version restored."); }}
                  data-testid="wm-tutorial-rollback"><RotateCcw size={11} /> Rollback</button>
        )}
        <button className="or-btn ml-auto" disabled={busy || enabledSlides.length === 0}
                onClick={() => setPublishOpen(true)} data-testid="wm-tutorial-publish" style={{ padding: "0.4rem 1rem" }}>
          Publish Tutorial
        </button>
      </div>

      {publishOpen && (
        <div className="fixed inset-0 z-[215] flex items-center justify-center px-3"
             style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }} data-testid="wm-publish-modal">
          <div className="or-surface w-full max-w-sm p-4">
            <h4 className="text-sm font-bold mb-2" style={{ color: "var(--text-main)" }}>Publish tutorial v{(t.version || 0) + 1}?</h4>
            <div className="text-xs space-y-1 mb-3" style={{ color: "var(--text-muted)" }}>
              <div>{enabledSlides.length} slides ({imgCount} image · {vidCount} video)</div>
              <div>Audience: {t.audience} · Skip: {t.allow_skip ? "on" : "off"} · Close: {t.allow_close ? "on" : "off"}</div>
            </div>
            <label className="flex items-center gap-1.5 text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={showToEveryone} onChange={(e) => setShowToEveryone(e.target.checked)} data-testid="wm-publish-everyone" />
              Show this new version to all users (including those who completed older versions)
            </label>
            <div className="flex gap-2">
              <button className="or-btn or-btn-ghost flex-1" onClick={() => setPublishOpen(false)}>Cancel</button>
              <button className="or-btn" disabled={busy}
                      onClick={() => { setPublishOpen(false); act(() => apiClient.post("/admin/tutorial/publish", { show_to_everyone: showToEveryone }), "Tutorial published successfully."); }}
                      data-testid="wm-publish-confirm">Publish</button>
            </div>
          </div>
        </div>
      )}

      {editing && <SlideEditor slide={editing.id ? editing : null} onSave={saveSlide} onClose={() => setEditing(null)} busy={busy} />}
      {preview && <TutorialPopup preview={preview} onClosePreview={() => setPreview(null)} />}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function AdminWebsiteMedia() {
  const { user } = useAuth();
  if ((user?.username || "").toLowerCase() !== "stealth") {
    return (
      <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="wm-forbidden">
        Only Stealth can modify Website Media.
      </div>
    );
  }
  return (
    <div className="max-w-6xl mx-auto" data-testid="admin-website-media">
      <AdminBackButton />
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-main)", fontFamily: "var(--font-display)" }}>Website Media</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Manage website logos, wordmarks, and the swipe-through tutorial shown to new users.
          </p>
        </div>
        <Badge color="#2EA0FF">STEALTH ONLY ACCESS</Badge>
      </div>

      <div className="or-surface p-4 mb-5 flex flex-wrap items-center justify-between gap-3" data-testid="wm-rc-media-link">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>Responsibility Center</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            Logos, navigation icons, illustrations, Center type artwork, and branding for the Responsibility Center.
          </div>
        </div>
        <button className="or-btn" onClick={() => (window.location.href = "/admin/media/responsibility-center")}
          data-testid="wm-open-rc-media">Open Responsibility Center Media</button>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div>
          <h2 className="text-base font-bold mb-3 flex items-center gap-2" style={{ color: "var(--text-main)" }}>
            <ImageIcon size={15} style={{ color: "#2EA0FF" }} /> Logos & Wordmarks
          </h2>
          <ModesManager />
        </div>
        <div>
          <h2 className="text-base font-bold mb-3 flex items-center gap-2" style={{ color: "var(--text-main)" }}>
            <PlayCircle size={15} style={{ color: "#C26BFF" }} /> New User Tutorial Builder
          </h2>
          <TutorialBuilder />
        </div>
      </div>
    </div>
  );
}
