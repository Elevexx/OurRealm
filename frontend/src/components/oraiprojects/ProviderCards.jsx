import { Plug, PlugZap, Star } from "lucide-react";

export const ProviderCapabilityBadge = ({ label }) => (
  <span className="text-[9px] px-1.5 py-0.5 rounded-full"
    style={{ background: "rgba(255,255,255,.06)", color: "var(--text-muted)" }}>{label}</span>
);

export const ProviderSelectionCard = ({ p, selected, onToggle }) => {
  const usable = p.connected && p.enabled;
  return (
    <button role="checkbox" aria-checked={selected} disabled={!usable}
      aria-label={`${p.name} provider ${usable ? "" : "(not connected)"}`}
      onClick={() => onToggle(p.id)} data-testid={`provider-card-${p.id}`}
      className="text-left rounded-xl p-3 transition-all duration-150 focus:outline-none focus:ring-2 disabled:cursor-not-allowed"
      style={{
        background: selected ? "rgba(46,160,255,.10)" : "rgba(255,255,255,.03)",
        border: `1.5px solid ${selected ? "#2EA0FF" : "rgba(255,255,255,.09)"}`,
        opacity: usable ? 1 : 0.45,
      }}>
      <div className="flex items-center gap-2">
        {usable ? <PlugZap size={14} style={{ color: "#10E670" }} /> : <Plug size={14} style={{ color: "#FF6B6B" }} />}
        <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{p.name}</span>
        {p.recommended && usable && (
          <span className="flex items-center gap-0.5 text-[9px] px-1.5 rounded-full font-bold"
            style={{ background: "rgba(244,167,59,.18)", color: "#F4A73B" }} data-testid={`provider-recommended-${p.id}`}>
            <Star size={8} /> Recommended
          </span>
        )}
      </div>
      <div className="text-[9.5px] mt-1" style={{ color: usable ? "#10E670" : "#FF6B6B" }}
        data-testid={`provider-status-${p.id}`}>
        {usable ? `Connected${p.via && p.via !== "internal" && p.via !== "direct" ? ` via ${p.via}` : ""}` : p.disabled_reason || "Not connected"}
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {(p.tools || []).map((t) => <ProviderCapabilityBadge key={t} label={t} />)}
        <ProviderCapabilityBadge label={p.type} />
      </div>
      {(p.models || []).length > 0 && (
        <div className="text-[9px] mt-1 truncate" style={{ color: "var(--text-muted)" }}>{p.models.join(", ")}</div>
      )}
    </button>
  );
};

export const ProviderGrid = ({ providers, tools, selected, onToggle }) => {
  const relevant = providers.filter((p) => !tools.length || p.tools.some((t) => tools.includes(t)));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2" data-testid="provider-grid">
      {relevant.map((p) => (
        <ProviderSelectionCard key={p.id} p={p} selected={selected.includes(p.id)} onToggle={onToggle} />
      ))}
    </div>
  );
};

export default ProviderGrid;
