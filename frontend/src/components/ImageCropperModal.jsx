/**
 * ImageCropperModal — shared professional crop editor for banners and
 * profile pictures (June 2026).
 *
 * Built on react-easy-crop (locked @5.5.6): wheel zoom, touch drag,
 * pinch-to-zoom, aspect-locked crop box. Adds zoom in/out buttons,
 * a zoom slider, Reset, Cancel and Apply. The crop is baked via canvas
 * (see lib/cropImage.js) and returned as a Blob — the caller uploads it
 * through the existing R2 pipeline so only durable URLs are stored.
 */
import React, { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import { ZoomIn, ZoomOut, RotateCcw, Check, X, Loader2 } from "lucide-react";
import { getCroppedBlob } from "@/lib/cropImage";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export default function ImageCropperModal({
  open,
  src,                    // local object URL or same-origin image URL
  aspect = 1,
  cropShape = "rect",     // "rect" | "round"
  title = "Adjust image",
  maxWidth = 2560,
  outputMime = "image/jpeg",   // pass "image/png" to preserve transparency
  onApply,                // async (blob) => void
  onCancel,
  testid = "image-cropper",
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onCropComplete = useCallback((_, pixels) => setAreaPixels(pixels), []);

  if (!open || !src) return null;

  const reset = () => { setCrop({ x: 0, y: 0 }); setZoom(1); };

  const apply = async () => {
    if (!areaPixels) return;
    setBusy(true); setErr("");
    try {
      const blob = await getCroppedBlob(src, areaPixels, { maxWidth, mime: outputMime });
      await onApply?.(blob);
    } catch (e) {
      setErr(e?.message || "Could not crop image");
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center px-3"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(10px)" }}
      data-testid={testid}
    >
      <div className="or-surface w-full max-w-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>{title}</h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onCancel} aria-label="Cancel" data-testid={`${testid}-close`}>
            <X size={16} />
          </button>
        </div>

        {/* Crop stage — react-easy-crop handles mouse wheel, touch drag
            and pinch-to-zoom natively. */}
        <div
          className="relative w-full overflow-hidden"
          style={{
            height: "min(52vh, 420px)",
            borderRadius: "var(--radius)",
            background: "#000",
            touchAction: "none",
          }}
          data-testid={`${testid}-stage`}
        >
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            aspect={aspect}
            cropShape={cropShape}
            showGrid
            zoomWithScroll
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-2 mt-3">
          <button
            className="starbar-icon shrink-0" style={{ width: 34, height: 34 }}
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.25).toFixed(2)))}
            aria-label="Zoom out" data-testid={`${testid}-zoom-out`}
          >
            <ZoomOut size={15} />
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="flex-1"
            aria-label="Zoom"
            data-testid={`${testid}-zoom-slider`}
          />
          <button
            className="starbar-icon shrink-0" style={{ width: 34, height: 34 }}
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.25).toFixed(2)))}
            aria-label="Zoom in" data-testid={`${testid}-zoom-in`}
          >
            <ZoomIn size={15} />
          </button>
          <span className="text-xs w-12 text-right" style={{ color: "var(--text-muted)" }} data-testid={`${testid}-zoom-val`}>
            {zoom.toFixed(2)}×
          </span>
        </div>
        <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          Drag to reposition · scroll or pinch to zoom.
        </div>

        {err && (
          <div className="text-xs mt-2 px-3 py-2"
            style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}
            data-testid={`${testid}-error`}>
            {err}
          </div>
        )}

        <div className="flex gap-2 mt-3">
          <button className="or-btn or-btn-ghost" onClick={reset} disabled={busy} data-testid={`${testid}-reset`}>
            <RotateCcw size={13} /> Reset
          </button>
          <button className="or-btn or-btn-ghost flex-1" onClick={onCancel} disabled={busy} data-testid={`${testid}-cancel`}>
            Cancel
          </button>
          <button className="or-btn" onClick={apply} disabled={busy || !areaPixels} data-testid={`${testid}-apply`}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Apply
          </button>
        </div>
      </div>
    </div>
  );
}
