import React from "react";
import { useNavigate } from "react-router-dom";

/* Prominent Game Maker CTA for the /games hubs (public + member).
   Always rendered on every width — never hidden behind responsive
   classes. Access policy is enforced after the click by /gamemaker. */
export const GameMakerCTA = () => {
  const navigate = useNavigate();
  return (
    <button type="button"
      onClick={() => navigate("/gamemaker")}
      data-testid="games-gamemaker-cta"
      aria-label="Create your own game with OurRealm Game Maker"
      className="text-left leading-tight rounded-2xl px-3 py-1.5 shrink-0 transition-transform duration-150 hover:-translate-y-0.5"
      style={{
        minHeight: 44,
        background: "linear-gradient(135deg, rgba(16,230,112,0.16), rgba(46,160,255,0.14))",
        border: "1.5px solid rgba(16,230,112,0.55)",
        boxShadow: "0 0 14px rgba(16,230,112,0.22)",
      }}>
      <span className="block font-black text-[10.5px] sm:text-xs tracking-wide whitespace-nowrap" style={{ color: "#10E670" }}>
        CREATE YOUR OWN GAME!</span>
      <span className="block text-[9px] sm:text-[10px] whitespace-nowrap" style={{ color: "#EAF2FF" }}>
        OurRealm Game Maker</span>
    </button>
  );
};
