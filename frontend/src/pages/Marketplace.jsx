import React from "react";
import { DollarSign, Megaphone } from "lucide-react";
import { MARKETPLACE_ADS } from "@/data/mockData";

export default function Marketplace() {
  return (
    <div className="max-w-7xl mx-auto" data-testid="marketplace-page">
      <div className="mb-6 flex items-center gap-3">
        <Megaphone size={28} style={{ color: "var(--primary)" }} />
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Ad marketplace</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Marketplace</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>Browse campaigns, place ad widgets on your profile, earn commissions.</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {MARKETPLACE_ADS.map((a) => (
          <div key={a.id} className="or-surface overflow-hidden" data-testid={`market-ad-${a.id}`}>
            <div className="aspect-[16/10] overflow-hidden">
              <img src={a.cover} alt="" className="w-full h-full object-cover transition-transform duration-500 hover:scale-105" />
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>{a.brand}</div>
                <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5"
                  style={{ background: "var(--surface-2)", color: "var(--text-muted)", borderRadius: 4 }}>
                  {a.size}
                </span>
              </div>
              <div className="text-xs mt-1 mb-3" style={{ color: "var(--text-muted)" }}>{a.category}</div>
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-1 text-sm" style={{ color: "var(--primary)" }}>
                  <DollarSign size={14} /> {a.payout}
                </div>
                <button className="or-btn" style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }} data-testid={`market-place-${a.id}`}>
                  Place ad
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
