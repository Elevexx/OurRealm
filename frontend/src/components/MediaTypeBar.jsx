import React from "react";
import { Radio, Video, Image as ImageIcon, Music2, Lightbulb, ArrowRight, BarChart3 } from "lucide-react";

// Lives → Videos → Images → Sounds → Thoughts.
// Polls is appended as a regular filter on the For You page only
// (see `trailing` prop) so home/customize keeps the Next arrow.
const BASE_TYPES = [
  { id: "live",    label: "Lives",    Icon: Radio,     color: "#FF3F5A" },
  { id: "video",   label: "Videos",   Icon: Video,     color: "var(--brand-blue)" },
  { id: "image",   label: "Images",   Icon: ImageIcon, color: "var(--brand-green)" },
  { id: "sound",   label: "Sounds",   Icon: Music2,    color: "#C26BFF" },
  { id: "thought", label: "Thoughts", Icon: Lightbulb, color: "#F4C84A" },
];

const POLL_TYPE = { id: "poll", label: "Polls", Icon: BarChart3, color: "#5BE3C8" };

/**
 * Persistent Media Selection bar.
 *
 * `trailing` controls the last chip:
 *   - "next"  → arrow that calls `onNext()` (Home / Customize page)
 *   - "poll"  → 6th filter chip toggling the "poll" media type
 *     (For You page only — feed surfaces polls when this is active)
 *
 * Mobile (<sm): icon-only — every chip + the trailing element fit on
 *   one row with no horizontal scroll.
 * Desktop (≥sm): icon + label.
 */
export default function MediaTypeBar({
  value = [],
  onChange,
  onNext,
  embedded = false,
  trailing = "next",
}) {
  const toggle = (id) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange?.([...set]);
  };
  const types = trailing === "poll" ? [...BASE_TYPES, POLL_TYPE] : BASE_TYPES;
  return (
    <div
      className={`flex items-center gap-1.5 sm:gap-2 ${embedded ? "" : "or-surface p-2 sm:p-2.5"}`}
      data-testid="media-type-bar"
      style={{ minWidth: 0 }}
    >
      <div
        className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0 justify-between sm:justify-start"
        data-testid="media-type-chips"
      >
        {types.map(({ id, label, Icon, color }) => {
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
        {trailing === "next" && (
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
        )}
      </div>
    </div>
  );
}

export { BASE_TYPES as MEDIA_TYPES };
