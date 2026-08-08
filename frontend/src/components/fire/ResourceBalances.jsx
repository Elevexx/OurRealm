import React, { useEffect, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";

const ExchangePanel = ({ balances, onDone }) => {
  const [opts, setOpts] = useState(null);
  const [f, setF] = useState({ from: "", to: "", amount: "" });
  const [quote, setQuote] = useState(null);
  useEffect(() => { apiClient.get("/resources/exchange/options").then((r) => setOpts(r.data)).catch(() => {}); }, []);
  if (!opts || opts.frozen || !(opts.pairs || []).length) return null;
  const srcs = [...new Set(opts.pairs.map((p) => p[0]))];
  const dsts = [...new Set(opts.pairs.filter((p) => p[0] === f.from).map((p) => p[1]))];
  const meta = (k) => (opts.resources || []).find((r) => r.key === k) || {};
  return (
    <div className="mt-2 p-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-col)" }}
      data-testid="resource-exchange-panel">
      <div className="text-[9.5px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
        Resource Exchange — no monetary value</div>
      <div className="flex gap-1.5 flex-wrap items-center text-[11px]">
        <select className="or-input text-xs" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: "" })}
          data-testid="exchange-from-select">
          <option value="">Burn…</option>
          {srcs.map((k) => <option key={k} value={k}>{meta(k).icon} {meta(k).name}</option>)}
        </select>
        <select className="or-input text-xs" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}
          disabled={!f.from} data-testid="exchange-to-select">
          <option value="">Receive…</option>
          {dsts.map((k) => <option key={k} value={k}>{meta(k).icon} {meta(k).name}</option>)}
        </select>
        <input className="or-input text-xs w-16" placeholder="amt" value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="exchange-amount-input" />
        <button className="or-btn or-btn-ghost text-[10px]" data-testid="exchange-quote-btn"
          onClick={async () => {
            try {
              const r = await apiClient.post("/resources/exchange/quote",
                { from: f.from, to: f.to, amount: Number(f.amount) });
              setQuote(r.data.quote);
            } catch (e) { toast.error(e?.response?.data?.detail || "Quote failed"); }
          }}>Preview</button>
      </div>
      {quote && (
        <div className="mt-1.5 text-[10.5px] flex items-center gap-2 flex-wrap" data-testid="exchange-quote-row">
          <span>Burn <b style={{ color: "#FF8A5A" }}>{quote.amount} {meta(quote.src).name}</b> → receive{" "}
            <b style={{ color: "#10E670" }}>{quote.receive} {meta(quote.dst).name}</b>
            {quote.fee_fire > 0 && <> · fee {quote.fee_fire}🔥</>} · ratio v{quote.rule_version}</span>
          <button className="or-btn text-[10px]" data-testid="exchange-confirm-btn"
            onClick={async () => {
              try {
                await apiClient.post("/resources/exchange/execute",
                  { quote_id: quote.id, request_id: `ex-${quote.id}` });
                toast.success("Exchange complete!"); setQuote(null); setF({ from: "", to: "", amount: "" }); onDone();
              } catch (e) { toast.error(e?.response?.data?.detail || "Exchange failed"); }
            }}>Confirm Exchange</button>
          <button className="or-btn or-btn-ghost text-[10px]" onClick={() => setQuote(null)}>Cancel</button>
        </div>)}
    </div>
  );
};

/* Shared engagement resource balances (Stars, Keys, Coins, Gems, …) —
   one canonical account balance across all games. Fire Power keeps its
   own Pending → Collectable → Vault card above. */
export const ResourceBalances = () => {
  const [data, setData] = useState(null);
  const load = () => apiClient.get("/resources/me").then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!data) return null;
  const rows = (data.balances || []).filter((b) => b.key !== "fire");
  if (!rows.length) return null;
  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border-col)" }} data-testid="resource-balances">
      <div className="text-[9.5px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
        Resources — shared across all OurRealm games</div>
      <div className="flex gap-2 flex-wrap">
        {rows.map((b) => (
          <div key={b.key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
            style={{ background: `color-mix(in srgb, ${b.color} 12%, transparent)`, border: `1px solid ${b.color}55` }}
            data-testid={`resource-balance-${b.key}`} title={b.description}>
            {b.icon_url ? <img src={b.icon_url} alt={b.name} className="w-4 h-4" /> : <span className="text-sm">{b.icon}</span>}
            <b className="text-xs" style={{ color: b.color }}>{Number(b.balance || 0).toLocaleString()}</b>
            <span className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{b.name}</span>
          </div>
        ))}
      </div>
      <ExchangePanel balances={rows} onDone={load} />
    </div>
  );
};
