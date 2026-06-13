import React from "react";
import { Radio, Video, Image as ImageIcon, Music2, Lightbulb, ArrowRight } from "lucide-react";

// Exact order from the design spec:
// Lives → Videos → Images → Sounds → Thoughts → Next →
const TYPES = [
  { id: "live",    label: "Lives",    Icon: Radio,     color: "#FF3F5A" },
  { id: "video",   label: "Videos",   Icon: Video,     color: "var(--brand-blue)" },
  { id: "image",   label: "Images",   Icon: ImageIcon, color: "var(--brand-green)" },
  { id: "sound",   label: "Sounds",   Icon: Music2,    color: "#C26BFF" },
  { id: "thought", label: "Thoughts", Icon: Lightbulb, color: "#F4C84A" },
];

/**
 * Persistent Media Selection bar (Lives / Videos / Images / Sounds / Thoughts → )
 * - Each chip toggles on/off and affects the parent's feed
 * - Empty array = "all" (no filter)
 * - `onNext()` fires when the arrow is clicked
 */
export default function MediaTypeBar({ value = [], onChange, onNext, embedded = false }) {
  const toggle = (id) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange?.([...set]);
  };
  return (
    <div
      className={`flex items-center gap-2 ${embedded ? "" : "or-surface p-2.5"}`}
      data-testid="media-type-bar"
      style={{ minWidth: 0 }}
    >
      {/* Scrollable chip row — Next button stays pinned to the right (sibling, not inside) */}
      <div
        className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 min-w-0"
        data-testid="media-type-chips"
        style={{ scrollSnapType: "x proximity" }}
      >
        {TYPES.map(({ id, label, Icon, color }) => {
          const active = value.includes(id);
          return (
            <button
              key={id}
              className="or-chip shrink-0"
              data-active={active}
              onClick={() => toggle(id)}
              data-testid={`media-type-${id}`}
              style={active ? { scrollSnapAlign: "start" } : { color, scrollSnapAlign: "start" }}
              aria-pressed={active}
            >
              <Icon size={14} /> {label}
            </button>
          );
        })}
      </div>
      <button
        className="or-chip shrink-0"
        onClick={() => onNext?.()}
        data-testid="media-type-next"
        title="Next"
        aria-label="Next"
      >
        Next <ArrowRight size={14} />
      </button>
    </div>
  );
}

export { TYPES as MEDIA_TYPES };
