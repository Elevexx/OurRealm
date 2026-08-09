import React from "react";

/* Canonical animated gold coin — the ONE shared render path for the Coins
   engagement resource everywhere it appears (Fire Vault, HUDs, results,
   placements, admin). Transform-only animation inside a fixed-size wrapper
   so there is never layout movement; prefers-reduced-motion shows the
   polished static gold frame (CSS in index.css). */
export const GoldCoin = ({ src, size = 16, alt = "Coins", className = "", testid }) => (
  <span className={`or-coin-wrap ${className}`} style={{ width: size, height: size }}
    data-testid={testid || "gold-coin"}>
    <img src={src} alt={alt} className="or-coin-anim" draggable={false}
      style={{ width: size, height: size }} />
  </span>
);
