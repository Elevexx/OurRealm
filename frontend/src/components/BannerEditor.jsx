/**
 * BannerEditor — banner upload with the shared professional crop editor.
 *
 * Pipeline (June 2026):
 *   1. Choose file → shared ImageCropperModal (exact 4:1 banner aspect,
 *      wheel/pinch zoom, drag reposition, reset).
 *   2. Apply → the crop is baked via canvas at full quality and uploaded
 *      through the existing /api/images/upload R2 pipeline (durable
 *      /api/media/... URL — never blobs or local paths).
 *   3. Save → emits { banner_url, banner_offset_y: 50, banner_scale: 1 }.
 *
 * Animated GIFs bypass cropping (canvas would freeze the animation) and
 * upload as-is. Existing banners saved with the legacy offset/scale
 * values keep rendering exactly as before via <BannerView />.
 */
import React, { useEffect, useRef, useState } from "react";
import apiClient from "@/api/client";
import { absoluteImageUrl } from "@/components/ImageUploadPicker";
import ImageCropperModal from "@/components/ImageCropperModal";
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cropSrc, setCropSrc] = useState(null);   // local object URL while cropping
  const fileRef = useRef(null);

  // Revoke object URLs when the modal unmounts.
  useEffect(() => () => { if (cropSrc) URL.revokeObjectURL(cropSrc); }, [cropSrc]);

  if (!open) return null;

  const pickFile = () => fileRef.current?.click();

  const uploadBlob = async (blob, filename) => {
    const fd = new FormData();
    fd.append("file", new File([blob], filename, { type: blob.type || "image/jpeg" }));
    const { data } = await apiClient.post("/images/upload", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    if (!data?.url) throw new Error("Upload failed");
    return data.url;
  };

  const handleFile = (e) => {
    setErr("");
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!ACCEPTED.split(",").includes(f.type)) { setErr("Use JPG, PNG, GIF, or WebP."); return; }
    if (f.size > MAX_BYTES) { setErr("Max 8 MB."); return; }
    if (f.type === "image/gif") {
      // Cropping would freeze GIF animation — upload as-is.
      setBusy(true);
      uploadBlob(f, f.name)
        .then((url) => setUploadedUrl(url))
        .catch((e2) => setErr(e2?.response?.data?.detail || e2?.message || "Upload failed"))
        .finally(() => setBusy(false));
      return;
    }
    setCropSrc(URL.createObjectURL(f));
  };

  const handleCropApply = async (blob) => {
    setErr("");
    try {
      const url = await uploadBlob(blob, "banner.jpg");
      setUploadedUrl(url);
      setCropSrc(null);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || e2?.message || "Upload failed");
      setCropSrc(null);
    }
  };

  const doSave = async () => {
    setBusy(true);
    try {
      await onSave?.({
        banner_url: uploadedUrl,
        // Crop is baked into the image itself — neutral render transform.
        banner_offset_y: 50,
        banner_scale: 1,
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

        {/* Preview rectangle — exact 4:1 banner aspect. */}
        <div
          className="overflow-hidden mb-3"
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: `${ASPECT} / 1`,
            borderRadius: "var(--radius)",
            border: "1px solid var(--border-col)",
            background: "var(--surface-2)",
          }}
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
                // Legacy banners keep their saved offset/scale view.
                objectPosition: `50% ${Number.isFinite(initial.banner_offset_y) && uploadedUrl === initial.banner_url ? initial.banner_offset_y : 50}%`,
                transform: `scale(${Number.isFinite(initial.banner_scale) && uploadedUrl === initial.banner_url ? initial.banner_scale : 1})`,
                transformOrigin: "50% 50%",
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

      <ImageCropperModal
        open={!!cropSrc}
        src={cropSrc}
        aspect={ASPECT}
        cropShape="rect"
        title="Adjust banner"
        maxWidth={2560}
        onApply={handleCropApply}
        onCancel={() => setCropSrc(null)}
        testid={`${testid}-cropper`}
      />
    </div>
  );
}


/**
 * <BannerView /> — render-only helper that surfaces a saved banner with
 * the saved offset/scale applied. Used in the Profile / Public profile /
 * Group / Realm headers. Legacy banners (saved before the baked-crop
 * editor) keep their non-destructive transform view.
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
