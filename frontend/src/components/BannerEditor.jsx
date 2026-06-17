/**
 * BannerEditor — reusable banner upload + crop/zoom/reposition tool.
 *
 * Pipeline:
 *   1. User taps Choose file → upload via the existing /api/images/upload.
 *   2. Preview rectangle (same aspect ratio as the destination banner)
 *      shows the image inside, supports drag-to-reposition and a zoom
 *      slider.
 *   3. Save → emits { banner_url, banner_offset_y, banner_scale }.
 *
 * The crop is fully **non-destructive**: we never re-encode the image.
 * Display surfaces use `object-position: 50% <banner_offset_y>%` and an
 * inner-scale transform to render the same view the user adjusted.
 *
 * Works for user profile banners, group banners, and realm banners — the
 * caller just decides where to PATCH the returned values.
 */
import React, { useRef, useState } from "react";
import apiClient from "@/api/client";
import { absoluteImageUrl } from "@/components/ImageUploadPicker";
import { X, Upload, Loader2, Image as ImageIcon, AlertCircle, Trash2 } from "lucide-react";

const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif";
const MAX_BYTES = 8 * 1024 * 1024;   // 8 MB
const ASPECT = 4;                    // 4:1 banner aspect

export default function BannerEditor({
  open,
  onClose,
  initial = {},
  onSave,
  onRemove,
  testid = "banner-editor",
}) {
  const [uploadedUrl, setUploadedUrl] = useState(initial.banner_url || "");
  const [offsetY, setOffsetY] = useState(Number.isFinite(initial.banner_offset_y) ? initial.banner_offset_y : 50);
  const [scale, setScale]   = useState(Number.isFinite(initial.banner_scale) ? initial.banner_scale : 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const previewRef = useRef(null);
  const dragRef = useRef({ active: false, startY: 0, startOffset: 50 });

  if (!open) return null;

  const pickFile = () => fileRef.current?.click();

  const handleFile = async (e) => {
    setErr("");
    const f = e.target.files?.[0];
    e.target.value = "";   // allow re-picking same file
    if (!f) return;
    if (!ACCEPTED.split(",").includes(f.type)) { setErr("Use JPG, PNG, GIF, or WebP."); return; }
    if (f.size > MAX_BYTES) { setErr("Max 8 MB."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await apiClient.post("/images/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (!data?.url) throw new Error("Upload failed");
      setUploadedUrl(data.url);
      setOffsetY(50);
      setScale(1);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || e2?.message || "Upload failed");
    } finally { setBusy(false); }
  };

  // Drag — vertical only (banner crop is along the Y axis since the
  // image already fills width via object-cover).
  const onPointerDown = (e) => {
    if (!uploadedUrl) return;
    e.target.setPointerCapture?.(e.pointerId);
    dragRef.current = { active: true, startY: e.clientY, startOffset: offsetY };
  };
  const onPointerMove = (e) => {
    if (!dragRef.current.active) return;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dyPct = ((e.clientY - dragRef.current.startY) / rect.height) * 100;
    // Dragging DOWN should reveal the TOP of the image (lower offset).
    const next = Math.max(0, Math.min(100, dragRef.current.startOffset - dyPct));
    setOffsetY(next);
  };
  const onPointerUp = (e) => {
    dragRef.current.active = false;
    try { e.target.releasePointerCapture?.(e.pointerId); } catch { /* */ }
  };

  const doSave = async () => {
    setBusy(true);
    try {
      await onSave?.({
        banner_url: uploadedUrl,
        banner_offset_y: Math.round(offsetY * 10) / 10,
        banner_scale: Math.round(scale * 100) / 100,
      });
      onClose?.();
    } catch (e2) {
      setErr(e2?.message || "Could not save banner");
    } finally { setBusy(false); }
  };

  const doRemove = async () => {
    setBusy(true);
    try { await onRemove?.(); onClose?.(); }
    catch (e2) { setErr(e2?.message || "Could not remove banner"); }
    finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-3"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid={testid}
    >
      <div className="or-surface w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Banner image</h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose} aria-label="Close" data-testid={`${testid}-close`}><X size={16} /></button>
        </div>

        {/* Preview rectangle — same 4:1 ratio as the rendered banner. */}
        <div
          ref={previewRef}
          className="overflow-hidden mb-3"
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: `${ASPECT} / 1`,
            borderRadius: "var(--radius)",
            border: "1px solid var(--border-col)",
            background: "var(--surface-2)",
            cursor: uploadedUrl ? "grab" : "default",
            touchAction: "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid={`${testid}-preview`}
        >
          {uploadedUrl ? (
            <img
              src={absoluteImageUrl(uploadedUrl)}
              alt="banner preview"
              className="absolute inset-0 w-full h-full"
              draggable={false}
              style={{
                objectFit: "cover",
                objectPosition: `50% ${offsetY}%`,
                transform: `scale(${scale})`,
                transformOrigin: `50% ${offsetY}%`,
                userSelect: "none",
                pointerEvents: "none",
              }}
              data-testid={`${testid}-preview-img`}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color: "var(--text-muted)" }}>
              <ImageIcon size={28} />
              <div className="text-sm mt-1">No banner yet — pick a file below.</div>
            </div>
          )}
        </div>

        {uploadedUrl && (
          <div className="mb-3">
            <label className="text-xs flex items-center justify-between" style={{ color: "var(--text-muted)" }}>
              <span>Zoom</span>
              <span data-testid={`${testid}-zoom-val`}>{scale.toFixed(2)}×</span>
            </label>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="w-full"
              data-testid={`${testid}-zoom`}
            />
            <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
              Tip: drag the image inside the preview to reposition.
            </div>
          </div>
        )}

        {err && (
          <div className="flex items-start gap-2 text-xs px-3 py-2 mb-3"
            style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}
            data-testid={`${testid}-error`}
          >
            <AlertCircle size={14} /> {err}
          </div>
        )}

        <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" onChange={handleFile} data-testid={`${testid}-file`} />
        <div className="flex flex-wrap gap-2">
          <button className="or-btn" onClick={pickFile} disabled={busy} data-testid={`${testid}-choose`}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {uploadedUrl ? "Replace image" : "Choose image"}
          </button>
          <button className="or-btn or-btn-ghost flex-1" onClick={onClose} disabled={busy} data-testid={`${testid}-cancel`}>Cancel</button>
          <button className="or-btn" onClick={doSave} disabled={busy || !uploadedUrl} data-testid={`${testid}-save`}>Save banner</button>
        </div>
        {onRemove && initial.banner_url && (
          <button
            type="button"
            onClick={doRemove}
            disabled={busy}
            className="or-btn or-btn-ghost w-full mt-2"
            style={{ color: "#FF6B6B", borderColor: "rgba(255,107,107,0.4)" }}
            data-testid={`${testid}-remove`}
          >
            <Trash2 size={14} /> Remove banner
          </button>
        )}
      </div>
    </div>
  );
}


/**
 * <BannerView /> — render-only helper that surfaces a saved banner with
 * the saved offset/scale applied. Used in the Profile / Public profile /
 * Group / Realm headers.
 */
export function BannerView({ url, offsetY = 50, scale = 1, className = "", style, testid }) {
  if (!url) return null;
  return (
    <img
      src={absoluteImageUrl(url)}
      alt=""
      className={`absolute inset-0 w-full h-full ${className}`}
      draggable={false}
      style={{
        objectFit: "cover",
        objectPosition: `50% ${offsetY}%`,
        transform: `scale(${scale})`,
        transformOrigin: `50% ${offsetY}%`,
        userSelect: "none",
        pointerEvents: "none",
        ...style,
      }}
      data-testid={testid}
    />
  );
}
