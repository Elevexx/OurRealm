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

// Bubble metrics — small, subtle status dot at the bottom-right *edge*
// of the circular avatar (sits ON the border, partially overlapping it
// like the original OurRealm online indicator).
function dotMetrics(size) {
  // ~22 % of the avatar — keeps the dot readable but never huge.
  const dot = Math.max(7, Math.round(size * 0.22));
  // 1-px punch-out ring on small avatars, 2-px on larger ones.
  const pad = size <= 36 ? 1 : 2;
  // Inset from the wrapper's right/bottom edge so the dot sits on the
  // lower-right of the circle, partially overlapping the border.
  const inset = Math.max(0, Math.round(size * 0.04));
  return { dot, pad, inset };
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
  const wrapperStyle = {
    position: "relative",
    display: "inline-block",
    lineHeight: 0,
    // Guarantees the wrapper is square so the circular border-radius
    // never produces a stretched/elliptical avatar even when a parent
    // passes width: 100% / height: 100%.
    aspectRatio: "1 / 1",
    ...style,
  };
  // The img itself enforces perfect-circle geometry — never an ellipse,
  // never with visible square corners.
  const imgStyle = ring
    ? {
        width: size, height: size,
        aspectRatio: "1 / 1",
        border: `2px solid ${ring}`,
        boxShadow: `0 0 10px ${ring}55`,
        objectFit: "cover",
        borderRadius: "50%",
      }
    : {
        width: size, height: size,
        aspectRatio: "1 / 1",
        objectFit: "cover",
        borderRadius: "50%",
      };

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
            // Bottom-right edge of the circular avatar.
            right: m.inset,
            bottom: m.inset,
            // Subtle punch-out ring + faint shadow — keeps the dot legible
            // against any background without making it look "floating".
            background: "var(--bgc, #0a0a0f)",
            borderRadius: "50%",
            padding: m.pad,
            display: "inline-flex",
            lineHeight: 0,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
            zIndex: 1,
          }}
          data-testid={testid ? `${testid}-presence` : "user-avatar-presence"}
        >
          <PresenceDot status={liveStatus} size={m.dot} />
        </span>
      )}
    </span>
  );
}
