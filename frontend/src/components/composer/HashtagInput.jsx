/**
 * HashtagInput — shared hashtag chips input used by every post composer
 * (For You inline composer + the global "+" workflows). Tags are appended
 * to the post text on submit via `appendHashtags`, so the existing
 * backend extraction/indexing and clickable HashtagText all just work.
 */
import React, { useState } from "react";
import { Hash, X } from "lucide-react";

const MAX_TAGS = 10;

export function normalizeTag(raw) {
  return (raw || "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase().slice(0, 40);
}

export function appendHashtags(content, tags) {
  const text = (content || "").trim();
  const existing = new Set((text.match(/#([A-Za-z0-9_]+)/g) || []).map((t) => t.slice(1).toLowerCase()));
  const fresh = (tags || []).map(normalizeTag).filter((t) => t && !existing.has(t));
  if (fresh.length === 0) return text;
  const tagLine = fresh.map((t) => `#${t}`).join(" ");
  return text ? `${text}\n\n${tagLine}` : tagLine;
}

export default function HashtagInput({ tags, onChange, accent = "var(--primary)", testidPrefix = "hashtag" }) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const t = normalizeTag(draft);
    setDraft("");
    if (!t || tags.includes(t) || tags.length >= MAX_TAGS) return;
    onChange([...tags, t]);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="mt-2" data-testid={`${testidPrefix}-input-wrap`}>
      <div
        className="flex flex-wrap items-center gap-1.5 px-2 py-1.5"
        style={{
          borderRadius: "calc(var(--radius) - 4px)",
          border: "1px solid var(--border-col)",
          background: "var(--surface-2)",
        }}
      >
        <Hash size={13} style={{ color: accent, flexShrink: 0 }} />
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{
              background: `color-mix(in srgb, ${accent} 16%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accent} 40%, transparent)`,
              color: "var(--text-main)",
            }}
            data-testid={`${testidPrefix}-chip-${t}`}
          >
            #{t}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              aria-label={`Remove #${t}`}
              data-testid={`${testidPrefix}-chip-${t}-remove`}
              style={{ display: "inline-flex", color: "var(--text-muted)" }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={tags.length ? "Add another…" : "Add hashtags (press Enter)"}
          className="flex-1 min-w-[110px] text-xs bg-transparent outline-none"
          style={{ color: "var(--text-main)" }}
          maxLength={41}
          data-testid={`${testidPrefix}-input`}
        />
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{tags.length}/{MAX_TAGS}</span>
      </div>
    </div>
  );
}
