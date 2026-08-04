import { Trophy, Scale, PiggyBank, Zap } from "lucide-react";

const META = {
  best: { icon: Trophy, color: "#F4A73B" },
  balanced: { icon: Scale, color: "#2EA0FF" },
  budget: { icon: PiggyBank, color: "#10E670" },
};

export const SmartSuggestionCard = ({ s, providerNames, active, onUse }) => {
  const m = META[s.id] || META.balanced;
  const Icon = m.icon;
  return (
    <div className="rounded-xl p-3 flex flex-col" data-testid={`suggestion-card-${s.id}`}
      style={{ background: active ? `${m.color}14` : "rgba(255,255,255,.03)",
               border: `1.5px solid ${active ? m.color : "rgba(255,255,255,.09)"}` }}>
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: m.color }} />
        <span className="text-xs font-bold" style={{ color: m.color }}>{s.name}</span>
        <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--text-primary)" }}
          data-testid={`suggestion-cost-${s.id}`}>
          ${s.est_range[0].toFixed(2)}–${s.est_range[1].toFixed(2)}
        </span>
      </div>
      <div className="mt-2 space-y-0.5">
        {s.roles.map((r, i) => (
          <div key={i} className="text-[10px] flex justify-between gap-2">
            <span style={{ color: "var(--text-muted)" }}>{r.role}</span>
            <span style={{ color: "var(--text-primary)" }}>{providerNames[r.provider] || r.provider}</span>
          </div>
        ))}
      </div>
      <div className="text-[9.5px] mt-2" style={{ color: "#10E670" }}>+ {s.advantages}</div>
      <div className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>− {s.tradeoffs}</div>
      <button className="or-btn text-xs mt-2 w-full flex items-center justify-center gap-1"
        onClick={() => onUse(s)} data-testid={`suggestion-use-${s.id}`}>
        <Zap size={11} /> Use This Combination
      </button>
    </div>
  );
};

export const SmartSuggestions = ({ suggestions, providerNames, activeId, onUse }) => {
  if (!suggestions.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="smart-suggestions">
      {suggestions.map((s) => (
        <SmartSuggestionCard key={s.id} s={s} providerNames={providerNames}
          active={activeId === s.id} onUse={onUse} />
      ))}
    </div>
  );
};

export default SmartSuggestions;
