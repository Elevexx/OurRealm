/**
 * In-feed sound player card. Renders a self-contained <audio> element
 * for a sound post.
 *
 * Why an HTML5 <audio> instead of the singleton player?
 *   - In-feed cards must be independent of each other and unaffected by
 *     the global player picking up other tracks.
 *   - The singleton player has a single src — multiple cards on screen
 *     would fight over it.
 *   - The global MiniPlayer is reserved for the dedicated Sounds page;
 *     individual posts get a self-contained element here.
 *
 * Auto-pause-others behaviour is enforced via a module-level WeakSet:
 *   when any SoundPlayerCard starts playing it pauses all the others.
 */
import React, { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
function abs(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${BACKEND}${u}`;
  return u;
}

const activeAudios = new Set();   // <audio> elements that have ever played
function pauseOthers(current) {
  for (const el of activeAudios) {
    if (el !== current && !el.paused) {
      try { el.pause(); } catch { /* ignore */ }
    }
  }
}

export default function SoundPlayerCard({ post, testid }) {
  const audioRef = useRef(null);
  const [ready, setReady] = useState(false);
  const url = post?.sound_url || post?.media_url;
  const cover = post?.sound_cover_url || null;
  const title = post?.sound_title || post?.content || "Untitled sound";

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    activeAudios.add(el);
    const onPlay = () => { pauseOthers(el); };
    el.addEventListener("play", onPlay);
    return () => {
      el.removeEventListener("play", onPlay);
      activeAudios.delete(el);
    };
  }, []);

  if (!url) return null;
  const fullUrl = abs(url);

  return (
    <div
      className="overflow-hidden mb-3"
      style={{
        borderRadius: "var(--radius)",
        border: "1px solid var(--border-col)",
        background: "var(--surface-2)",
      }}
      data-testid={testid || "feed-sound-card"}
    >
      <div className="flex items-center gap-3 p-3">
        {cover ? (
          <img
            src={abs(cover)}
            alt=""
            className="rounded shrink-0 object-cover"
            style={{ width: 56, height: 56, border: "1px solid var(--border-col)" }}
          />
        ) : (
          <div
            className="rounded shrink-0 flex items-center justify-center"
            style={{
              width: 56, height: 56,
              background: "color-mix(in srgb, var(--primary) 16%, transparent)",
              color: "var(--primary)",
              border: "1px solid var(--primary)",
            }}
          >
            <Music2 size={20} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>{title}</div>
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Sound · {ready ? "Ready" : "Loading…"}
          </div>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={fullUrl}
        controls
        preload="metadata"
        onCanPlay={() => setReady(true)}
        onLoadedMetadata={() => setReady(true)}
        className="w-full"
        style={{ display: "block", width: "100%" }}
        data-testid={`${testid || "feed-sound-card"}-audio`}
      />
    </div>
  );
}
