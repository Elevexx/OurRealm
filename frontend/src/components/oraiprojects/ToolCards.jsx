import { Image, Video, Music, FileText, Gamepad2, GraduationCap, Check } from "lucide-react";

const ICONS = { image: Image, video: Video, audio: Music, text: FileText, game: Gamepad2, course: GraduationCap };

export const ToolSelectionCard = ({ tool, selected, disabled, disabledReason, onToggle }) => {
  const Icon = ICONS[tool.id] || Image;
  return (
    <button role="checkbox" aria-checked={selected} aria-label={`${tool.name} tool`}
      disabled={disabled} onClick={() => onToggle(tool.id)}
      data-testid={`tool-card-${tool.id}`}
      className="relative text-left rounded-xl p-3 sm:p-4 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: selected ? `linear-gradient(140deg, ${tool.color}33, ${tool.color}14)` : "rgba(255,255,255,.03)",
        border: `1.5px solid ${selected ? tool.color : "rgba(255,255,255,.09)"}`,
        boxShadow: selected ? `0 0 18px ${tool.color}30` : "none",
      }}>
      {selected && (
        <span className="absolute top-2 right-2 rounded-full p-0.5" style={{ background: tool.color }}
          data-testid={`tool-selected-${tool.id}`}>
          <Check size={11} color="#0B0B14" strokeWidth={3} />
        </span>
      )}
      <Icon size={22} style={{ color: tool.color }} />
      <div className="mt-2 text-sm font-bold" style={{ color: "var(--text-primary)" }}>{tool.name}</div>
      <div className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>
        {disabled ? (disabledReason || "Unavailable") : tool.desc}
      </div>
    </button>
  );
};

export const ToolGrid = ({ tools, selected, onToggle, disabledMap = {} }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3" data-testid="tool-grid">
    {tools.map((t) => (
      <ToolSelectionCard key={t.id} tool={t} selected={selected.includes(t.id)}
        disabled={!!disabledMap[t.id]} disabledReason={disabledMap[t.id]} onToggle={onToggle} />
    ))}
  </div>
);

export default ToolGrid;
