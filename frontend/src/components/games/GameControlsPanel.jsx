import React, { useEffect, useState } from "react";
import { Gamepad2, Keyboard, Smartphone } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const SLIDERS = [["sensitivity", "Sensitivity"], ["button_size", "Button size"],
  ["touch_opacity", "Touch opacity"], ["joystick_size", "Joystick size"], ["swipe_sensitivity", "Swipe sensitivity"]];
const TOGGLES = [["left_handed", "Left-handed layout"], ["haptics", "Haptic feedback"],
  ["reduced_motion", "Reduced motion"], ["high_contrast", "High-contrast controls"], ["show_guide", "Show control guide before play"]];

export default function GameControlsPanel({ gameId, onChanged }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [km, setKm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiClient.get(`/admin/games/${gameId}/controls`).then((r) => {
    setData(r.data);
    const base = {};
    Object.entries(r.data.runtime_actions || {}).forEach(([a, keys]) => {
      base[a] = (r.data.controls.keyboard_map?.[a]) || keys;
    });
    setKm(base);
  }).catch(() => {});
  useEffect(() => { if (open && !data) load(); }, [open]); // eslint-disable-line
  const cfg = data?.controls;

  const patch = async (body) => {
    setBusy(true);
    try {
      const r = await apiClient.patch(`/admin/games/${gameId}/controls`, body);
      setData((d) => ({ ...d, controls: r.data.controls }));
      toast.success("Controls saved — new version created");
      onChanged && onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Controls validation failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="or-surface p-3 mt-3" data-testid="game-controls-panel">
      <button className="w-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "#2EE6FF" }} onClick={() => setOpen(!open)} data-testid="controls-toggle">
        <Gamepad2 size={11} /> Controls & Input Modes {open ? "▾" : "▸"}
        {cfg && <span className="font-normal normal-case tracking-normal" style={{ color: "var(--text-muted)" }}>
          ({[cfg.desktop_enabled && "desktop", cfg.mobile_enabled && "mobile"].filter(Boolean).join(" + ") || "NONE — invalid"})
        </span>}
      </button>
      {open && cfg && (
        <div className="mt-3">
          <div className="flex gap-4 flex-wrap mb-2">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={!!cfg.desktop_enabled} className="accent-[#2EE6FF]" disabled={busy}
                onChange={(e) => patch({ desktop_enabled: e.target.checked })} data-testid="controls-desktop" />
              <Keyboard size={12} /> <b>Desktop keyboard</b>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={!!cfg.mobile_enabled} className="accent-[#10E670]" disabled={busy}
                onChange={(e) => patch({ mobile_enabled: e.target.checked })} data-testid="controls-mobile" />
              <Smartphone size={12} /> <b>Mobile touch</b>
            </label>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Touch layout: <b style={{ color: "#10E670" }}>{data.touch_layout_default}</b>
            </span>
          </div>
          {Object.keys(data.runtime_actions || {}).length > 0 && (
            <div className="mb-2" data-testid="controls-keymap">
              <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                Keyboard mapping (comma-separated keys per action)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(km || {}).map(([a, keyz]) => (
                  <div key={a}>
                    <div className="text-[9.5px] capitalize" style={{ color: "var(--text-muted)" }}>{a}</div>
                    <input className="or-input w-full text-xs" value={(keyz || []).join(",")}
                      onChange={(e) => setKm({ ...km, [a]: e.target.value.split(",").map((s) => s.trim() === "Space" ? " " : s.trim()).filter((s) => s !== "") })}
                      data-testid={`controls-key-${a}`} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-1.5">
                <button className="or-btn text-[10px]" disabled={busy}
                  onClick={() => patch({ keyboard_map: km })} data-testid="controls-save-keys">Save mapping</button>
                <button className="or-btn or-btn-ghost text-[10px]" disabled={busy}
                  onClick={() => patch({ action: "reset_keys" }).then(load)} data-testid="controls-reset-keys">Reset to defaults</button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
            {SLIDERS.map(([k, l]) => (
              <div key={k}>
                <div className="flex justify-between text-[9.5px]" style={{ color: "var(--text-muted)" }}>
                  <span>{l}</span><span>{Math.round((cfg[k] ?? 1) * 100)}%</span>
                </div>
                <input type="range" min={30} max={200} value={(cfg[k] ?? 1) * 100} className="w-full accent-[#2EE6FF]"
                  onMouseUp={(e) => patch({ [k]: Number(e.target.value) / 100 })}
                  onTouchEnd={(e) => patch({ [k]: Number(e.target.value) / 100 })}
                  onChange={() => {}} data-testid={`controls-${k}`} />
              </div>
            ))}
          </div>
          <div className="flex gap-3 flex-wrap mb-1">
            {TOGGLES.map(([k, l]) => (
              <label key={k} className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                <input type="checkbox" checked={!!cfg[k]} className="accent-[#2EE6FF]" disabled={busy}
                  onChange={(e) => patch({ [k]: e.target.checked })} data-testid={`controls-${k}`} />
                {l}
              </label>
            ))}
            <label className="flex items-center gap-1.5 text-[10px]">
              Button position
              <select className="or-input text-[10px] py-0.5" value={cfg.button_position} disabled={busy}
                onChange={(e) => patch({ button_position: e.target.value })} data-testid="controls-button-position">
                <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[10px]">
              Hold / toggle
              <select className="or-input text-[10px] py-0.5" value={cfg.hold_toggle} disabled={busy}
                onChange={(e) => patch({ hold_toggle: e.target.value })} data-testid="controls-hold-toggle">
                <option value="hold">Hold</option><option value="toggle">Toggle</option>
              </select>
            </label>
          </div>
          <p className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>
            Every change creates a new game version. Publishing is blocked when no control mode can fully play the game.
          </p>
        </div>
      )}
    </div>
  );
}
