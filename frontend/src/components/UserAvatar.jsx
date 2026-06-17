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
import { resolvePresence, shouldRenderPresenceDot } from "@/lib/presence";

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
// of the circular avatar. Sized like a classic IM online indicator
// (~10-12 % of the avatar, never huge).
function dotMetrics(size) {
  // ~11 % of the avatar with a 7 px floor, capped at 16 px so very large
  // profile photos still get a compact dot (matches the iPhone reference
  // mockup the founder shared).
  const dot = Math.min(16, Math.max(7, Math.round(size * 0.11)));
  // 2-3 px border matching the surrounding card background — keeps the
  // dot crisp against any photo without a translucent halo.
  const pad = size <= 36 ? 1 : (size <= 80 ? 2 : 3);
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
  // Single source of truth for presence color/visibility. Funnels every
  // call site through the feature-flagged resolver so red NEVER renders
  // while ENABLE_LIVE_PRESENCE is off.
  const liveStatus = resolvePresence({ user: u, statuses, override: status });

  const src = abs(u.avatar_url) || dicebear(u.name || u.username || "OurRealm");
  const m = dotMetrics(size);
  const imgClass = `rounded-full object-cover block ${className}`;
  // Wrapper is intentionally **decoration-free**. Any background/border/
  // shadow passed via `style` is forwarded to the circular <img> below
  // so it can NEVER paint as a visible square behind the avatar.
  const wrapperStyle = {
    position: "relative",
    display: "inline-block",
    lineHeight: 0,
    aspectRatio: "1 / 1",
  };
  // Merge ring (legacy accent) + caller style onto the IMG itself. The
  // image is the only element with `border-radius: 50%`, so every
  // decoration lands on the circle, not a square wrapper.
  const ringStyle = ring
    ? { border: `2px solid ${ring}`, boxShadow: `0 0 10px ${ring}55` }
    : {};
  const imgStyle = {
    width: size,
    height: size,
    aspectRatio: "1 / 1",
    objectFit: "cover",
    borderRadius: "50%",
    overflow: "hidden",
    ...ringStyle,
    ...style,
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
      {showPresence && shouldRenderPresenceDot(liveStatus) && (
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
