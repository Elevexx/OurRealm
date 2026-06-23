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
 * Persistent Media Selection bar.
 *
 * Mobile (<sm, ≤639px): icon-only — every chip + the Next arrow fit on
 *   one row with no horizontal scrolling, no cut-off, no swiping.
 * Desktop (≥sm, 640px+): icon + text label like the original design.
 *
 * Same chip shape, glow, sizing, and border-radius across breakpoints —
 * we only swap the label visibility via the `hidden sm:inline` Tailwind
 * pair and let the chips lay out via flex so the row stays centered.
 */
export default function MediaTypeBar({ value = [], onChange, onNext, embedded = false }) {
  const toggle = (id) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange?.([...set]);
  };
  return (
    <div
      className={`flex items-center gap-1.5 sm:gap-2 ${embedded ? "" : "or-surface p-2 sm:p-2.5"}`}
      data-testid="media-type-bar"
      style={{ minWidth: 0 }}
    >
      {/* Chip row — no horizontal overflow on mobile so every type is
          visible at the same time. Even spacing via flex+gap, centred
          via justify-between to spread the icons across the bar. */}
      <div
        className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0 justify-between sm:justify-start"
        data-testid="media-type-chips"
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
              style={active ? undefined : { color }}
              aria-pressed={active}
              aria-label={label}
              title={label}
            >
              <Icon size={14} />
              <span className="hidden sm:inline ml-1">{label}</span>
            </button>
          );
        })}
        {/* Next button sits in the same flex row at the same chip size
            on mobile, so all six elements (5 types + Next) line up
            evenly. On ≥sm it keeps its "Next →" label. */}
        <button
          className="or-chip shrink-0"
          onClick={() => onNext?.()}
          data-testid="media-type-next"
          title="Next"
          aria-label="Next"
          style={{ color: "var(--primary)" }}
        >
          <span className="hidden sm:inline mr-1">Next</span>
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

export { TYPES as MEDIA_TYPES };
