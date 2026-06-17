/**
 * UserAvatar — the single reusable avatar primitive for OurRealm.
 *
 * Renders a circular avatar image + a presence bubble overlay using the
 * already-existing PresenceDot. The presence bubble:
 *   - is positioned at the bottom-right of the avatar
 *   - sits in a small "punch-out" ring matching the surrounding surface
 *     so the dot reads as attached to the image rather than floating on
 *     top of it
 *   - scales with the avatar (size prop drives both)
 *
 * Status sources (in priority order):
 *   1. an explicit `status` prop
 *   2. the live `usePresence().statuses[user.id]` value
 *   3. `user.presence_status` from the API
 *   4. fallback "offline" → bubble is hidden (no UI noise)
 *
 * Falls back to dicebear initials when no avatar_url is set.
 */
import React from "react";
import PresenceDot from "@/components/PresenceDot";
import { usePresence } from "@/contexts/PresenceContext";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");

function abs(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${BACKEND}${u}`;
  return u;
}

function dicebear(seed) {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed || "OurRealm")}`;
}

// Map avatar size → presence dot size + offset, kept consistent everywhere.
function dotMetrics(size) {
  if (size <= 24)  return { dot: 8,  pad: 1, offset: -1 };
  if (size <= 36)  return { dot: 9,  pad: 1, offset: -1 };
  if (size <= 48)  return { dot: 11, pad: 2, offset: 0 };
  if (size <= 72)  return { dot: 13, pad: 2, offset: 1 };
  if (size <= 96)  return { dot: 15, pad: 2, offset: 2 };
  return { dot: 18, pad: 3, offset: 3 };
}

export default function UserAvatar({
  user,
  size = 40,
  status,
  showPresence = true,
  ring,
  className = "",
  style,
  alt,
  onClick,
  testid,
}) {
  // Defensive: never crash if a parent renders before user is loaded.
  const u = user || {};
  // useContext is safe even without a PresenceProvider — falls back to
  // the default {statuses: {}} value baked into the context.
  const { statuses } = usePresence();
  const liveStatus = status
    || (u.id && statuses ? statuses[u.id] : undefined)
    || u.presence_status
    || "offline";

  const src = abs(u.avatar_url) || dicebear(u.name || u.username || "OurRealm");
  const m = dotMetrics(size);
  const imgClass = `rounded-full object-cover block ${className}`;
  const wrapperStyle = { position: "relative", display: "inline-block", lineHeight: 0, ...style };
  // Optional accent ring around the avatar (e.g. featured creators).
  const imgStyle = ring
    ? { width: size, height: size, border: `2px solid ${ring}`, boxShadow: `0 0 10px ${ring}55` }
    : { width: size, height: size };

  const Img = (
    <img
      src={src}
      alt={alt ?? (u.username ? `@${u.username}` : "avatar")}
      className={imgClass}
      style={imgStyle}
      loading="lazy"
      decoding="async"
      data-testid={testid ? `${testid}-img` : undefined}
    />
  );

  return (
    <span
      style={wrapperStyle}
      onClick={onClick}
      data-testid={testid}
      data-avatar-user-id={u.id || undefined}
    >
      {Img}
      {showPresence && liveStatus && liveStatus !== "offline" && liveStatus !== "invisible" && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: m.offset,
            bottom: m.offset,
            // The "punch-out" ring lifts the dot off the avatar so it
            // never blurs into the photo. Uses the page background so it
            // matches every surface.
            background: "var(--bgc, #0a0a0f)",
            borderRadius: "50%",
            padding: m.pad,
            display: "inline-flex",
            lineHeight: 0,
          }}
          data-testid={testid ? `${testid}-presence` : undefined}
        >
          <PresenceDot status={liveStatus} size={m.dot} />
        </span>
      )}
    </span>
  );
}
