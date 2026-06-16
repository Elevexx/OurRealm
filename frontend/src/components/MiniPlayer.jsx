// Global sticky mini-player. Renders only when a track is loaded.
// Sits above the bottom nav. Tap the title to expand details (TODO P1).
import React, { useEffect, useState } from "react";
import { Play, Pause, X, Loader2, Volume2 } from "lucide-react";
import {
  subscribe, toggle, seek, stop, setVolume, formatTime,
} from "@/lib/audioPlayer";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
function abs(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${BACKEND}${u}`;
  return u;
}

export default function MiniPlayer() {
  const [s, setS] = useState(null);
  useEffect(() => subscribe(setS), []);
  if (!s?.track) return null;
  const t = s.track;
  const progress = s.duration > 0 ? (s.position / s.duration) * 100 : 0;
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 56px)" }}
      data-testid="mini-player"
    >
      <div
        className="pointer-events-auto or-surface flex items-center gap-3 px-3 py-2 mx-2"
        style={{
          maxWidth: 760,
          width: "calc(100% - 16px)",
          background: "var(--surface-2)",
          boxShadow: "0 10px 32px rgba(0,0,0,0.4)",
        }}
      >
        {t.cover_url ? (
          <img
            src={abs(t.cover_url)} alt=""
            className="rounded shrink-0 object-cover"
            style={{ width: 40, height: 40, border: "1px solid var(--border-col)" }}
          />
        ) : (
          <div
            className="rounded shrink-0 flex items-center justify-center"
            style={{
              width: 40, height: 40,
              background: "color-mix(in srgb, var(--primary) 16%, transparent)",
              color: "var(--primary)",
              border: "1px solid var(--primary)",
            }}
          >
            <Volume2 size={18} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }} data-testid="mini-title">
            {t.title}
          </div>
          <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
            {t.artist_username ? `@${t.artist_username}` : ""}
            {t.genre ? ` · ${t.genre}` : ""}
          </div>
          {/* progress */}
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
              {formatTime(s.position)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(1, s.duration)}
              step={0.1}
              value={Math.min(s.position, s.duration || 0)}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="flex-1 accent-current"
              style={{ color: "var(--primary)", height: 4 }}
              data-testid="mini-seek"
            />
            <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
              {formatTime(s.duration)}
            </span>
          </div>
          {/* fallback non-fancy progress for browsers without input[type=range] styles */}
          <div className="sr-only">progress {progress.toFixed(0)}%</div>
        </div>
        <button
          onClick={() => toggle()}
          className="starbar-icon shrink-0"
          style={{ width: 40, height: 40, background: "var(--primary)", color: "var(--primary-fg)" }}
          data-testid="mini-toggle"
          aria-label={s.playing ? "Pause" : "Play"}
        >
          {s.loading ? <Loader2 size={18} className="animate-spin" />
            : s.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          onClick={() => stop()}
          className="starbar-icon shrink-0"
          style={{ width: 32, height: 32 }}
          data-testid="mini-close"
          aria-label="Close player"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
