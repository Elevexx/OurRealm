import React from "react";
import { Image as ImageIcon, Video, Radio, Music2, FileText, Lightbulb, ArrowRight } from "lucide-react";

const TYPES = [
  { id: "image",    label: "Images",   Icon: ImageIcon },
  { id: "video",    label: "Videos",   Icon: Video },
  { id: "live",     label: "Lives",    Icon: Radio },
  { id: "sound",    label: "Sounds",   Icon: Music2 },
  { id: "post",     label: "Posts",    Icon: FileText },
  { id: "thought",  label: "Thoughts", Icon: Lightbulb },
];

/**
 * Persistent Media Type bar (Images / Videos / Lives / Sounds / Posts / Thoughts → )
 * `value` is an array of selected type ids (multi-select toggle).
 * `onChange(nextArray)` is the controlled setter.
 * `onNext` is invoked when the user presses the arrow.
 */
export default function MediaTypeBar({ value = [], onChange, onNext, embedded = false }) {
  const toggle = (id) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange?.([...set]);
  };
  const isAll = value.length === 0;

  return (
    <div
      className={`flex items-center gap-2 overflow-x-auto no-scrollbar ${embedded ? "" : "or-surface p-2.5"}`}
      data-testid="media-type-bar"
    >
      <button
        className="or-chip shrink-0"
        data-active={isAll}
        onClick={() => onChange?.([])}
        data-testid="media-type-all"
      >
        All
      </button>
      {TYPES.map(({ id, label, Icon }) => (
        <button
          key={id}
          className="or-chip shrink-0"
          data-active={value.includes(id)}
          onClick={() => toggle(id)}
          data-testid={`media-type-${id}`}
        >
          <Icon size={14} /> {label}
        </button>
      ))}
      <button
        className="or-chip shrink-0 ml-auto"
        onClick={() => onNext?.()}
        data-testid="media-type-next"
        title="Next"
      >
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

export { TYPES as MEDIA_TYPES };
