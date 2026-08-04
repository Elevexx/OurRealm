import { Calculator } from "lucide-react";

export const CostEstimatePanel = ({ estimate, loading, sticky }) => (
  <div className={`or-surface p-3 ${sticky ? "lg:sticky lg:top-4" : ""}`} data-testid="cost-estimate-panel">
    <div className="flex items-center gap-2 mb-2">
      <Calculator size={13} style={{ color: "#10E670" }} />
      <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#10E670" }}>
        Real-Time Estimate
      </span>
      {loading && <span className="text-[9px] animate-pulse" style={{ color: "var(--text-muted)" }}>updating…</span>}
    </div>
    {!estimate ? (
      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Select tools to see an estimate</div>
    ) : (
      <>
        <div className="space-y-1 mb-2">
          {estimate.items.map((it, i) => (
            <div key={i} className="flex justify-between gap-2 text-[10.5px]">
              <span style={{ color: "var(--text-muted)" }}>{it.label}
                {it.note && <span className="block text-[8.5px] opacity-70">{it.note}</span>}
              </span>
              <span className="font-mono" style={{ color: "var(--text-primary)" }}>${it.cost.toFixed(3)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between pt-2 text-xs font-bold"
          style={{ borderTop: "1px solid rgba(255,255,255,.08)", color: "var(--text-primary)" }}>
          <span>Estimated total</span>
          <span className="font-mono" style={{ color: "#10E670" }} data-testid="estimate-total">
            ${estimate.range[0].toFixed(2)}–${estimate.range[1].toFixed(2)}
          </span>
        </div>
        <p className="text-[8.5px] mt-1.5 leading-snug" style={{ color: "var(--text-muted)" }}>
          {estimate.disclaimer} Tier: {estimate.power_tier?.label} ({estimate.power_tier?.provider}/{estimate.power_tier?.model})
        </p>
      </>
    )}
  </div>
);

export default CostEstimatePanel;
