import React, { useEffect, useRef } from "react";
import { oraiVoice } from "@/lib/oraiVoiceEngine";

// Live waveform for ORAi voice — renders mic input while listening and
// speech output while ORAi talks. Idle: a soft resting line.
export const OraiWaveform = ({ height = 30, color = "#C26BFF", testid }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    let raf;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const bars = 24;
      const levels = oraiVoice.getLevels(bars);
      const bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const lvl = levels ? Math.max(0.06, levels[i]) : 0.06 + 0.02 * Math.sin(Date.now() / 600 + i);
        const h = Math.max(2, lvl * H);
        ctx.fillStyle = levels ? color : "rgba(255,255,255,0.18)";
        ctx.beginPath();
        ctx.roundRect(i * bw + bw * 0.2, (H - h) / 2, bw * 0.6, h, 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [color]);

  return (
    <canvas ref={canvasRef} width={220} height={height}
      style={{ width: "100%", height }} data-testid={testid || "orai-waveform"} />
  );
};
