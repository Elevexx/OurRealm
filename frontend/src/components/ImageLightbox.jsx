/**
 * ImageLightbox — centered full-view modal for tapped image posts.
 *
 *   • Portal-mounted at document.body.
 *   • Dark backdrop, Escape closes, backdrop-click closes, X button closes.
 *   • Preserves the image aspect ratio, fits the viewport, no nav change.
 *   • Used in Feed, Profile, and PostPopup. The component is purely
 *     presentational — callers manage the open/url state.
 */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function ImageLightbox({ open, src, alt, onClose, testid = "image-lightbox" }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      className="fixed inset-0 z-[260] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid={`${testid}-overlay`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 14px)",
          right: 14,
          background: "rgba(255,255,255,0.12)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 999,
          width: 36, height: 36,
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 2,
        }}
        data-testid={`${testid}-close`}
      >
        <X size={16} />
      </button>

      <img
        src={src}
        alt={alt || ""}
        className="max-w-full max-h-full"
        style={{ width: "auto", height: "auto", objectFit: "contain", display: "block" }}
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
      />
    </div>,
    document.body,
  );
}
