/**
 * AlbumPicker — shared multi-image album grid (up to 6 images) used by
 * BOTH post composers (For You inline + global "+"). Wraps the app-wide
 * ImageUploadPicker with multi-select + client-side compression, so
 * multiple images upload reliably.
 */
import React, { useState } from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import ImageUploadPicker from "@/components/ImageUploadPicker";

export const MAX_ALBUM_IMAGES = 6;

export default function AlbumPicker({ images, onChange, accent = "var(--brand-green)", testidPrefix = "create-image" }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replaceSlot, setReplaceSlot] = useState(null);

  const handlePicked = ({ url, thumbnailUrl }) => {
    if (typeof replaceSlot === "number" && replaceSlot < images.length) {
      const next = [...images];
      next[replaceSlot] = { url, thumbnailUrl };
      onChange(next);
    } else if (images.length < MAX_ALBUM_IMAGES) {
      // Functional-style append via latest prop happens in parent; here we
      // rely on ImageUploadPicker calling onPicked sequentially per image.
      onChange((prev) => {
        const base = Array.isArray(prev) ? prev : images;
        if (base.length >= MAX_ALBUM_IMAGES) return base;
        return [...base, { url, thumbnailUrl }];
      });
    }
  };

  const openPicker = (slot) => { setReplaceSlot(slot); setPickerOpen(true); };
  const remaining = MAX_ALBUM_IMAGES - images.length;

  return (
    <>
      <div className="grid grid-cols-3 gap-2 mb-2" data-testid={`${testidPrefix}-grid`}>
        {Array.from({ length: MAX_ALBUM_IMAGES }).map((_, i) => {
          const img = images[i];
          return (
            <div
              key={i}
              className="aspect-square or-surface overflow-hidden relative"
              style={{ background: "var(--surface-2)", borderStyle: img ? "solid" : "dashed" }}
            >
              {img ? (
                <>
                  <img src={img.thumbnailUrl || img.url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => openPicker(i)}
                    className="absolute inset-0"
                    aria-label="Replace image"
                    data-testid={`${testidPrefix}-slot-${i}`}
                    style={{ background: "transparent" }}
                  />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onChange(images.filter((_, x) => x !== i)); }}
                    className="absolute top-1 right-1 rounded-full"
                    style={{
                      width: 24, height: 24, background: "rgba(0,0,0,0.65)", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                    aria-label="Remove image"
                    data-testid={`${testidPrefix}-slot-${i}-remove`}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => openPicker(null)}
                  className="w-full h-full flex items-center justify-center"
                  aria-label="Add image"
                  data-testid={`${testidPrefix}-slot-${i}`}
                >
                  <ImageIcon size={20} style={{ color: accent }} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
        {images.length}/{MAX_ALBUM_IMAGES} images — you can select multiple files at once. Tap a filled tile to replace it.
      </div>
      <ImageUploadPicker
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); setReplaceSlot(null); }}
        onPicked={handlePicked}
        multiple={typeof replaceSlot !== "number"}
        maxCount={typeof replaceSlot === "number" ? 1 : Math.max(1, remaining)}
        title={typeof replaceSlot === "number" ? "Replace image" : "Add images to album"}
        testid={`${testidPrefix}-picker`}
      />
    </>
  );
}
