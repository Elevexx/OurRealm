/**
 * ModePreviewArt — CSS/SVG-only themed background art for each mode preview.
 * Zero external images = fastest loading + zero copyright risk.
 * Used by both Landing (2x2 quadrants) and ModesPage (mode cards).
 */
import React from "react";

function NeonArt() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Deep purple→cyan base */}
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at 30% 30%, #2A0F66 0%, #060410 60%, #020208 100%)",
      }} />
      {/* Holographic horizontal lines */}
      <div className="absolute inset-0" style={{
        backgroundImage: "repeating-linear-gradient(0deg, transparent 0 5px, rgba(0,220,255,0.05) 5px 6px)",
      }} />
      {/* Floating hologram panels */}
      <div className="absolute" style={{
        top: "18%", left: "12%", width: "44%", height: "30%",
        background: "linear-gradient(135deg, rgba(178,38,255,0.28), rgba(46,160,255,0.18))",
        border: "1px solid rgba(178,38,255,0.55)",
        borderRadius: 8,
        backdropFilter: "blur(3px)",
        boxShadow: "0 0 24px rgba(178,38,255,0.4)",
      }} />
      <div className="absolute" style={{
        top: "44%", left: "48%", width: "36%", height: "28%",
        background: "linear-gradient(135deg, rgba(16,230,112,0.22), rgba(0,220,255,0.18))",
        border: "1px solid rgba(16,230,112,0.55)",
        borderRadius: 8,
        backdropFilter: "blur(3px)",
        boxShadow: "0 0 24px rgba(16,230,112,0.35)",
      }} />
      <div className="absolute" style={{
        bottom: "10%", left: "20%", width: "32%", height: "18%",
        background: "rgba(0,220,255,0.18)",
        border: "1px solid rgba(0,220,255,0.5)",
        borderRadius: 8,
      }} />
      {/* Particle dots */}
      <div className="absolute inset-0" style={{
        backgroundImage: "radial-gradient(circle, rgba(178,38,255,0.8) 1px, transparent 1.5px), radial-gradient(circle, rgba(16,230,112,0.55) 1px, transparent 1.5px)",
        backgroundSize: "60px 60px, 90px 90px",
        backgroundPosition: "0 0, 30px 45px",
        opacity: 0.7,
      }} />
    </div>
  );
}

function BusinessArt() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0" style={{
        background: "linear-gradient(135deg, #F5EFE0 0%, #DACFB6 100%)",
      }} />
      {/* Metallic shimmer band */}
      <div className="absolute inset-0" style={{
        background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.65) 50%, transparent 70%)",
        mixBlendMode: "soft-light",
      }} />
      {/* Frosted dashboard card */}
      <div className="absolute" style={{
        top: "16%", left: "12%", width: "60%", height: "38%",
        background: "rgba(255,255,255,0.78)",
        border: "1px solid rgba(200,162,74,0.5)",
        borderRadius: 10,
        boxShadow: "0 14px 36px rgba(0,0,0,0.12)",
        backdropFilter: "blur(6px)",
      }}>
        {/* Mock analytics bars */}
        <div className="absolute" style={{ bottom: "15%", left: "10%", right: "10%", height: "55%", display: "flex", alignItems: "flex-end", gap: 6 }}>
          {[40, 65, 50, 80, 70, 95, 60].map((h, i) => (
            <div key={i} style={{
              flex: 1, height: `${h}%`,
              background: i === 5 ? "#C8A24A" : "linear-gradient(180deg, #8C7A3E 0%, #C8A24A 100%)",
              borderRadius: 3,
            }} />
          ))}
        </div>
      </div>
      {/* Silver pill */}
      <div className="absolute" style={{
        bottom: "12%", left: "10%", width: "32%", height: "12%",
        background: "linear-gradient(135deg, #D9D5C9 0%, #B7AC8E 100%)",
        borderRadius: 999,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 8px 18px rgba(140,122,62,0.25)",
      }} />
      <div className="absolute" style={{
        bottom: "12%", right: "10%", width: "26%", height: "20%",
        background: "rgba(255,255,255,0.85)",
        border: "1px solid #C8A24A",
        borderRadius: 8,
      }} />
    </div>
  );
}

function MillenniumArt() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Sky-blue → green gradient */}
      <div className="absolute inset-0" style={{
        background: "linear-gradient(180deg, #7FD9FF 0%, #B7F0E0 55%, #7CE5A6 100%)",
      }} />
      {/* Soft clouds */}
      <div className="absolute" style={{
        top: "10%", left: "8%", width: "44%", height: "20%",
        background: "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.85), rgba(255,255,255,0) 70%)",
        filter: "blur(2px)",
      }} />
      <div className="absolute" style={{
        top: "20%", right: "10%", width: "32%", height: "16%",
        background: "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.7), rgba(255,255,255,0) 70%)",
        filter: "blur(2px)",
      }} />
      {/* Glossy 3D widget — chat bubble */}
      <div className="absolute" style={{
        top: "32%", left: "14%", width: "30%", height: "32%",
        background: "linear-gradient(180deg, #FFFFFF 0%, #BCE6FF 50%, #6DB6F2 100%)",
        border: "1px solid rgba(46,120,214,0.45)",
        borderRadius: 22,
        boxShadow: "0 12px 28px rgba(46,120,214,0.3), inset 0 2px 6px rgba(255,255,255,0.85)",
      }} />
      {/* Glossy 3D widget — green orb */}
      <div className="absolute" style={{
        bottom: "12%", right: "18%", width: "22%", height: "32%",
        background: "radial-gradient(circle at 30% 30%, #FFFFFF 0%, #93E7B3 50%, #2EA85F 100%)",
        borderRadius: "50%",
        boxShadow: "0 10px 22px rgba(46,168,95,0.4), inset 0 4px 8px rgba(255,255,255,0.8)",
      }} />
      {/* Floating translucent card */}
      <div className="absolute" style={{
        bottom: "16%", left: "20%", width: "30%", height: "22%",
        background: "linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.45))",
        border: "1px solid rgba(46,120,214,0.4)",
        borderRadius: 14,
        backdropFilter: "blur(4px)",
      }} />
    </div>
  );
}

function StealthArt() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0" style={{ background: "#03060A" }} />
      {/* Grid */}
      <div className="absolute inset-0" style={{
        backgroundImage:
          "linear-gradient(rgba(0,255,102,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,102,0.08) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }} />
      {/* Scan lines */}
      <div className="absolute inset-0" style={{
        backgroundImage: "repeating-linear-gradient(0deg, transparent 0 3px, rgba(0,255,102,0.04) 3px 4px)",
      }} />
      {/* Radar */}
      <div className="absolute" style={{
        top: "20%", left: "20%", width: "60%", height: "60%",
        borderRadius: "50%",
      }}>
        {[1, 2, 3].map((r) => (
          <div key={r} className="absolute" style={{
            inset: `${r * 12}%`,
            border: "1px solid rgba(0,255,102,0.4)",
            borderRadius: "50%",
          }} />
        ))}
        {/* Radar sweep wedge */}
        <div className="absolute inset-0" style={{
          background: "conic-gradient(from 0deg, rgba(0,255,102,0) 0deg, rgba(0,255,102,0.35) 45deg, rgba(0,255,102,0) 60deg)",
          borderRadius: "50%",
          animation: "or-radar-sweep 5s linear infinite",
        }} />
        {/* Center dot */}
        <div className="absolute" style={{
          left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          width: 10, height: 10, borderRadius: "50%",
          background: "#00FF66",
          boxShadow: "0 0 16px #00FF66",
        }} />
      </div>
      {/* Telemetry panel */}
      <div className="absolute" style={{
        top: 12, left: 12, padding: "6px 10px",
        background: "rgba(0,30,12,0.7)",
        border: "1px solid rgba(0,255,102,0.4)",
        borderRadius: 4,
        fontFamily: "monospace",
        fontSize: 9,
        color: "#00FF66",
        letterSpacing: 1,
      }}>● LIVE · 43.21N 75.42W</div>
      <style>{`@keyframes or-radar-sweep { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

const ART = { neon: NeonArt, business: BusinessArt, millennium: MillenniumArt, stealth: StealthArt };

export default function ModePreviewArt({ mode }) {
  const C = ART[mode] || NeonArt;
  return <C />;
}
