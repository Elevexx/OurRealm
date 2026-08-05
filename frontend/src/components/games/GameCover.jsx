import React, { useState } from "react";
import { Gamepad2 } from "lucide-react";

// Shared cover resolver — identical priority everywhere:
// cover → thumbnail → generated/spec cover → platform placeholder.
export const resolveCover = (g) =>
  g?.cover_url || g?.thumbnail_url || g?.thumbnail ||
  g?.spec?.cover_url || g?.spec?.thumbnail || null;

// Platform-wide game cover: fixed aspect (no layout shift), lazy loading,
// graceful placeholder instead of a broken image icon. Overlays via children.
export const GameCover = ({ game, aspect = "4/5", className = "", imgClassName = "", children }) => {
  const [broken, setBroken] = useState(false);
  const src = resolveCover(game);
  return (
    <div className={`relative w-full overflow-hidden ${className}`}
      style={{ aspectRatio: aspect, background: "linear-gradient(160deg, #101b33 0%, #1a1030 100%)" }}
      data-testid="game-cover">
      {src && !broken ? (
        <img src={src} alt={game?.title || "Game cover"} loading="lazy"
          onError={() => setBroken(true)}
          className={`absolute inset-0 w-full h-full object-cover ${imgClassName}`} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3"
          data-testid="game-cover-placeholder">
          <Gamepad2 size={26} style={{ color: "#C26BFF", opacity: 0.8 }} />
          <b className="text-[11px] text-center leading-tight" style={{ color: "rgba(234,242,255,0.55)" }}>
            {game?.title || "OurRealm Game"}</b>
        </div>
      )}
      {children}
    </div>
  );
};
