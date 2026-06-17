/**
 * HashtagText — render a string with #hashtags turned into <Link>s that
 * route to `/hashtag/:tag`. Reusable in post bodies, comments, popups,
 * messages — anywhere the system has free-form user text.
 *
 * Unknown hashtags are still rendered as clickable links (per spec) —
 * the destination feed page handles "0 posts" gracefully.
 */
import React from "react";
import { Link } from "react-router-dom";

const RE = /#([A-Za-z0-9_]+)/g;

export default function HashtagText({ text, className, testid }) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  let m;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tag = m[1].toLowerCase();
    parts.push(
      <Link
        key={`${m.index}-${tag}`}
        to={`/hashtag/${tag}`}
        onClick={(e) => e.stopPropagation()}
        style={{ color: "var(--primary)", fontWeight: 600 }}
        data-testid={`hashtag-link-${tag}`}
      >
        #{m[1]}
      </Link>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={className} data-testid={testid}>{parts}</span>;
}
