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
import { Music2, AlertCircle, ListPlus } from "lucide-react";
import { resolveMediaUrl, isPlayableMediaUrl, probeMediaUrl, markMediaUrlBroken } from "@/lib/mediaUrl";
import SoundFireControl from "@/components/SoundFireControl";
import AddToPlaylistPopup from "@/components/AddToPlaylistPopup";

const activeAudios = new Set();   // <audio> elements that have ever played
function pauseOthers(current) {
  for (const el of activeAudios) {
    if (el !== current && !el.paused) {
      try { el.pause(); } catch { /* ignore */ }
    }
  }
}

// URL patterns that are OBVIOUSLY not audio — used as a guard so we
// don't pipe seed-post image URLs into an <audio> element and watch
// ffmpeg's demuxer throw a `DEMUXER_ERROR_COULD_NOT_OPEN` for every
// scroll-by. Conservative on purpose: when in doubt we still mount.
const OBVIOUSLY_NOT_AUDIO = [
  /^https?:\/\/images\.unsplash\.com\//i,
  /^https?:\/\/[^/]+\/api\/images\//i,
  /\.(jpe?g|png|webp|gif)(\?|#|$)/i,
];

function looksLikeAudio(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  for (const re of OBVIOUSLY_NOT_AUDIO) {
    if (re.test(s)) return false;
  }
  return true;
}

export default function SoundPlayerCard({ post, testid }) {
  const audioRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const tid = testid || "feed-sound-card";
  // Prefer the explicit sound url; only fall back to `media_url` when
  // the parent post is genuinely a sound post AND `media_url` isn't an
  // image / generic URL. This stops seed posts that carry an Unsplash
  // image in `media_url` from being piped into the <audio> element.
  const rawUrl = post?.sound_url || (looksLikeAudio(post?.media_url) ? post?.media_url : null);
  const cover = post?.sound_cover_url || null;
  const title = post?.sound_title || post?.content || "Untitled sound";
  const fullUrl = resolveMediaUrl(rawUrl);
  const initiallyPlayable = isPlayableMediaUrl(rawUrl);

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

  // Background HEAD probe — flips us to the placeholder if the
  // backend file is gone. Cached across the page lifetime.
  useEffect(() => {
    if (!initiallyPlayable || !fullUrl) return;
    let cancelled = false;
    probeMediaUrl(fullUrl).then((ok) => {
      if (!cancelled && !ok) setUnavailable(true);
    });
    return () => { cancelled = true; };
  }, [fullUrl, initiallyPlayable]);

  if (!rawUrl) return null;
  if (!initiallyPlayable || unavailable) {
    return (
      <div
        className="overflow-hidden mb-3 p-3 flex items-center gap-3"
        style={{
          borderRadius: "var(--radius)",
          border: "1px solid var(--border-col)",
          background: "var(--surface-2)",
          color: "var(--text-muted)",
        }}
        data-testid={`${testid || "feed-sound-card"}-unavailable`}
      >
        <AlertCircle size={16} style={{ color: "#FF8080", flexShrink: 0 }} />
        <div className="text-sm">Sound unavailable</div>
      </div>
    );
  }

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
            src={resolveMediaUrl(cover)}
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
        // `crossOrigin=anonymous` lets the browser send proper CORS
        // GET/Range requests against R2 (the bucket's CORS policy now
        // permits the production origin) and lets iOS Safari decode
        // cross-origin audio without throwing CodecError.
        crossOrigin="anonymous"
        onCanPlay={() => setReady(true)}
        onLoadedMetadata={() => setReady(true)}
        onError={(e) => {
          // Surface the real MediaError code in the console so we
          // can triage failed-playback reports without re-creating
          // the user's browser state. Codes:
          //   1 MEDIA_ERR_ABORTED     2 MEDIA_ERR_NETWORK
          //   3 MEDIA_ERR_DECODE      4 MEDIA_ERR_SRC_NOT_SUPPORTED
          const code = e?.currentTarget?.error?.code;
          const msg  = e?.currentTarget?.error?.message;
          console.warn(`[sound] playback failed — url=${fullUrl} code=${code} msg=${msg}`);
          setUnavailable(true);
          markMediaUrlBroken(fullUrl);
        }}
        className="w-full"
        style={{ display: "block", width: "100%" }}
        data-testid={`${tid}-audio`}
      />
      {post?.sound_track_id && (
        <div className="flex items-center justify-end gap-1 px-2 py-1.5"
          style={{ borderTop: "1px solid var(--border-col)" }}
          data-testid={`${tid}-actions`}>
          <button
            onClick={() => setPlaylistOpen(true)}
            className="starbar-icon"
            style={{ width: 32, height: 32, color: "var(--text-muted)" }}
            data-testid={`${tid}-add-playlist`}
            aria-label="Add to playlist"
            title="Add to playlist"
          >
            <ListPlus size={14} />
          </button>
          <SoundFireControl trackId={post.sound_track_id} testidPrefix={`${tid}-fire`} />
          <AddToPlaylistPopup open={playlistOpen} trackId={post.sound_track_id}
            onClose={() => setPlaylistOpen(false)} testid={`${tid}-playlist-popup`} />
        </div>
      )}
    </div>
  );
}
