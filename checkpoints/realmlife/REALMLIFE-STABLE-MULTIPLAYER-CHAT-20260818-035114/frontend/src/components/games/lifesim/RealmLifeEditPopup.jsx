// REALMLIFE PROPERTY EDIT MODE — contextual popup
// Compact, safe-area aware, top-center so it never covers the
// joystick, Jump, Interact, chat, Needs, POV/WORLD, HOME or MENU.
import React from "react";

const FLOOR_LABELS = {
  light_wood: "Light Wood",
  medium_wood: "Medium Wood",
  dark_wood: "Dark Wood",
  warm_tile: "Warm Tile",
  cool_tile: "Cool Tile",
  stone: "Stone",
  light_neutral: "Light Neutral",
  dark_neutral: "Dark Neutral",
};

const btnStyle = {
  background: "rgba(20,26,34,.92)",
  border: "1px solid rgba(122,212,229,.4)",
  color: "#dff3f8",
};

const Btn = ({ id, onClick, children, danger, disabled }) => (
  <button
    type="button"
    data-testid={id}
    disabled={disabled}
    onClick={onClick}
    className="px-2.5 py-1.5 rounded-lg text-[11px] font-black tracking-wide disabled:opacity-40"
    style={
      danger
        ? { ...btnStyle, border: "1px solid rgba(255,110,110,.55)", color: "#ffc9c9" }
        : btnStyle
    }
  >
    {children}
  </button>
);

export default function RealmLifeEditPopup({
  target,
  mode,
  busy,
  palette,
  wallPalette,
  floorPalette,
  addOpen,
  catalog,
  onNudge,
  onMoveDone,
  onRotate,
  onColorPick,
  onDuplicate,
  onRemove,
  onWallColor,
  onFloorFinish,
  onAddType,
  onOpenColor,
  onOpenMove,
  onClose,
}) {
  if (!target && !addOpen) return null;

  return (
    <div
      data-testid="realmlife-edit-popup"
      className="fixed left-1/2 -translate-x-1/2 z-[60] pointer-events-auto"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 56px)",
        maxWidth: "min(94vw, 360px)",
      }}
    >
      <div
        className="rounded-2xl px-3 py-2.5 shadow-2xl"
        style={{
          background: "rgba(10,14,20,.94)",
          border: "1px solid rgba(122,212,229,.35)",
          backdropFilter: "blur(14px)",
        }}
      >
        {addOpen ? (
          <>
            <div className="text-[10px] font-black text-cyan-300 mb-1.5 tracking-widest">
              ADD FURNITURE
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-[38vh] overflow-y-auto pr-1">
              {Object.entries(catalog || {}).map(([type, spec]) => (
                <button
                  key={type}
                  type="button"
                  data-testid={`edit-add-${type}`}
                  disabled={busy}
                  onClick={() => onAddType(type)}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-bold text-left disabled:opacity-40"
                  style={btnStyle}
                >
                  {spec.label}
                </button>
              ))}
            </div>
          </>
        ) : target.kind === "wall" ? (
          <>
            <div className="text-[10px] font-black text-cyan-300 mb-1.5 tracking-widest">
              WALL COLOR
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(wallPalette || []).map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`edit-wall-${c.replace("#", "")}`}
                  disabled={busy}
                  onClick={() => onWallColor(c)}
                  className="w-8 h-8 rounded-lg border border-white/25 disabled:opacity-40"
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </>
        ) : target.kind === "floor" ? (
          <>
            <div className="text-[10px] font-black text-cyan-300 mb-1.5 tracking-widest">
              FLOOR FINISH
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(floorPalette || {}).map(([id, hex]) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`edit-floor-${id}`}
                  disabled={busy}
                  onClick={() => onFloorFinish(id)}
                  className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-[10px] font-bold disabled:opacity-40"
                  style={btnStyle}
                >
                  <span
                    className="w-4 h-4 rounded border border-white/25 shrink-0"
                    style={{ background: hex }}
                  />
                  {FLOOR_LABELS[id] || id}
                </button>
              ))}
            </div>
          </>
        ) : mode === "move" ? (
          <>
            <div className="text-[10px] font-black text-cyan-300 mb-1.5 tracking-widest">
              MOVE — {target.label}
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="grid grid-cols-3 gap-1">
                <span />
                <Btn id="edit-move-up" onClick={() => onNudge(0, -1)}>▲</Btn>
                <span />
                <Btn id="edit-move-left" onClick={() => onNudge(-1, 0)}>◀</Btn>
                <Btn id="edit-move-down" onClick={() => onNudge(0, 1)}>▼</Btn>
                <Btn id="edit-move-right" onClick={() => onNudge(1, 0)}>▶</Btn>
              </div>
              <Btn id="edit-move-done" onClick={onMoveDone} disabled={busy}>
                ✓ DONE
              </Btn>
            </div>
          </>
        ) : mode === "color" ? (
          <>
            <div className="text-[10px] font-black text-cyan-300 mb-1.5 tracking-widest">
              COLOR — {target.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(palette || []).map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`edit-color-${c.replace("#", "")}`}
                  disabled={busy}
                  onClick={() => onColorPick(c)}
                  className="w-8 h-8 rounded-lg border border-white/25 disabled:opacity-40"
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="text-[10px] font-black text-cyan-300 mb-1.5 tracking-widest">
              {target.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Btn id="edit-btn-move" onClick={onOpenMove}>MOVE</Btn>
              <Btn id="edit-btn-rotate" onClick={onRotate} disabled={busy}>
                ROTATE 90°
              </Btn>
              {(palette || []).length > 0 && (
                <Btn id="edit-btn-color" onClick={onOpenColor}>COLOR</Btn>
              )}
              <Btn id="edit-btn-duplicate" onClick={onDuplicate} disabled={busy}>
                DUPLICATE
              </Btn>
              <Btn id="edit-btn-remove" onClick={onRemove} danger disabled={busy}>
                REMOVE
              </Btn>
            </div>
          </>
        )}

        <button
          type="button"
          data-testid="edit-popup-close"
          onClick={onClose}
          className="mt-2 w-full py-1 rounded-lg text-[10px] font-black tracking-widest"
          style={{
            background: "rgba(255,255,255,.06)",
            color: "#9fb4c4",
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}
