const CX_LABELS = [[2, "Simple"], [4, "Basic"], [6, "Standard"], [8, "Advanced"], [10, "Maximum Complexity"]];
const PW_LABELS = [[2, "Economy"], [4, "Efficient"], [6, "Balanced"], [8, "Advanced"], [10, "Maximum Quality"]];

const labelFor = (v, table) => table.find(([max]) => v <= max)?.[1] || "";

const SliderBase = ({ id, title, value, onChange, table, color, explain, affects }) => (
  <div className="or-surface p-3" data-testid={`${id}-slider-panel`}>
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{title}</span>
      <span className="text-sm font-bold" style={{ color }} data-testid={`${id}-value`}>
        {value} <span className="text-[10px] font-normal">— {labelFor(value, table)}</span>
      </span>
    </div>
    <input type="range" min={1} max={10} step={1} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-5 cursor-pointer touch-manipulation"
      style={{ accentColor: color }}
      aria-label={`${title}: ${value} of 10, ${labelFor(value, table)}`}
      aria-valuetext={`${value} — ${labelFor(value, table)}`}
      data-testid={`${id}-slider`} />
    <p className="text-[10px] mt-1 leading-snug" style={{ color: "var(--text-muted)" }}>{explain}</p>
    <p className="text-[9.5px] mt-0.5" style={{ color: "var(--text-muted)" }}>
      Affecting: <span style={{ color: "var(--text-primary)" }}>{affects}</span>
    </p>
  </div>
);

export const ComplexitySlider = ({ value, onChange, tools }) => {
  const affected = [];
  if (tools.includes("image")) affected.push("asset count");
  if (tools.includes("text")) affected.push("sections");
  if (tools.includes("game")) affected.push("game levels & systems");
  if (tools.includes("course")) affected.push("modules & lessons");
  if (tools.includes("video")) affected.push("shots");
  return (
    <SliderBase id="complexity" title="Complexity" value={value} onChange={onChange}
      table={CX_LABELS} color="#F4A73B"
      explain="Structural size and scope — how MUCH gets made (scenes, assets, levels, modules)."
      affects={affected.join(", ") || "project scope"} />
  );
};

export const AIPowerSlider = ({ value, onChange, tierLabel }) => (
  <SliderBase id="ai-power" title="AI Power" value={value} onChange={onChange}
    table={PW_LABELS} color="#C26BFF"
    explain="Intelligence quality and depth — model tier, reasoning depth, refinement passes."
    affects={tierLabel || "model tier & review passes"} />
);
