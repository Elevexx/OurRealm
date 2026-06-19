import React, { useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { TrendingUp, ArrowUpRight, Wallet as WalletIcon, Clock, History, X, Info } from "lucide-react";
import { WALLET as RAW_WALLET } from "@/data/mockData";

// Phase A — wallet is reset to $0.00 across the board until real payments
// ship. We deep-clone the mockData object and zero every numeric value so
// the existing layout, recharts, and grids render identically with empty
// state. NO historical values remain visible.
const WALLET = {
  ...RAW_WALLET,
  balance: 0,
  pending: 0,
  thirty_day: 0,
  lifetime: 0,
  monthly_change_pct: 0,
  rows: RAW_WALLET.rows.map((r) => ({ ...r, amount: 0 })),
  history: RAW_WALLET.history.map((h) => ({
    month: h.month, creator: 0, merch: 0, music: 0, subscription: 0, ads: 0, tips: 0,
  })),
  transactions: [],
};

export default function Wallet() {
  const [modalOpen, setModalOpen] = useState(true);
  return (
    <div className="max-w-7xl mx-auto" data-testid="wallet-page">
      <div className="mb-6 flex items-center gap-3">
        <WalletIcon size={28} style={{ color: "var(--primary)" }} />
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Creator economy</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Wallet</h1>
        </div>
      </div>

      {/* Persistent "coming soon" notice — stays visible after the modal
          is dismissed. Doesn't intrude on the existing layout. */}
      <div
        className="or-surface p-3 mb-4 flex items-center gap-2"
        style={{
          background: "color-mix(in srgb, var(--primary) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--primary) 35%, transparent)",
        }}
        data-testid="wallet-coming-soon-banner"
      >
        <Info size={14} style={{ color: "var(--primary)", flexShrink: 0 }} />
        <span className="text-sm" style={{ color: "var(--text-main)" }}>
          <b>Wallet Support Coming Soon.</b> Payments, deposits, withdrawals, payouts, and creator earnings are not currently active.
        </span>
      </div>

      {/* Headline cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="or-surface p-5 grain" data-testid="wallet-current-balance">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Current balance</div>
          <div className="text-3xl mt-1 glow-text" style={{ fontFamily: "var(--font-display)" }}>${WALLET.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className="text-[11px] mt-1" style={{ color: "var(--brand-green)" }}><ArrowUpRight size={12} className="inline" /> +{WALLET.monthly_change_pct}% mo</div>
        </div>
        <div className="or-surface p-5" data-testid="wallet-pending">
          <div className="text-[11px] uppercase tracking-widest flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <Clock size={11} /> Pending balance
          </div>
          <div className="text-3xl mt-1" style={{ fontFamily: "var(--font-display)" }}>${WALLET.pending.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>clears in 3–7 days</div>
        </div>
        <div className="or-surface p-5" data-testid="wallet-30day">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>30-day revenue</div>
          <div className="text-3xl mt-1" style={{ fontFamily: "var(--font-display)" }}>${WALLET.thirty_day.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>last 30 days</div>
        </div>
        <div className="or-surface p-5" data-testid="wallet-lifetime">
          <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Lifetime revenue</div>
          <div className="text-3xl mt-1" style={{ fontFamily: "var(--font-display)" }}>${WALLET.lifetime.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>since you joined</div>
        </div>
      </div>

      {/* Action buttons — disabled until wallet/payments are legally
          ready. The structure is kept (no layout change) so the page can
          be re-enabled in one commit when the backing payment provider
          ships, but every action button is now an inert, read-only
          placeholder with a tooltip. */}
      <div className="flex flex-wrap gap-3 mb-5">
        <button
          className="or-btn"
          data-testid="wallet-withdraw"
          aria-disabled="true"
          disabled
          title="Withdrawals are not currently active."
          style={{ opacity: 0.45, cursor: "not-allowed" }}
        >
          Withdraw
        </button>
        <button
          className="or-btn or-btn-ghost"
          data-testid="wallet-deposit"
          aria-disabled="true"
          disabled
          title="Deposits are not currently active."
          style={{ opacity: 0.45, cursor: "not-allowed" }}
        >
          Deposit
        </button>
        <button
          className="or-btn or-btn-ghost"
          data-testid="wallet-payout-settings"
          aria-disabled="true"
          disabled
          title="Payout settings are not currently active."
          style={{ opacity: 0.45, cursor: "not-allowed" }}
        >
          Payout settings
        </button>
      </div>

      {/* Revenue sources */}
      <h3 className="text-xl mb-3" style={{ fontFamily: "var(--font-display)" }}>Revenue sources</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {WALLET.rows.map((r) => (
          <div key={r.id} className="or-surface p-4" data-testid={`wallet-row-${r.id}`}>
            <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{r.label}</div>
            <div className="text-2xl mt-2" style={{ fontFamily: "var(--font-display)", color: r.color }}>
              ${r.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="h-1 mt-3 rounded-full overflow-hidden" style={{ background: "var(--border-col)" }}>
              <div className="h-full rounded-full" style={{ background: r.color, width: `${Math.min(100, (r.amount / 7000) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-5 mb-6">
        <div className="or-surface p-5" data-testid="wallet-chart-line">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} style={{ color: "var(--primary)" }} />
            <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Revenue trend</h3>
          </div>
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer>
              <LineChart data={WALLET.history}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-col)" />
                <XAxis dataKey="month" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="creator" stroke="#2EA0FF" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="merch"   stroke="#10E670" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="music"   stroke="#C26BFF" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="subscription" stroke="#FF8AC2" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="or-surface p-5" data-testid="wallet-chart-pie">
          <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Revenue mix</h3>
          <div style={{ width: "100%", height: 250 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={WALLET.rows} dataKey="amount" nameKey="label" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2}>
                  {WALLET.rows.map((r) => <Cell key={r.id} fill={r.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Monthly comparison */}
      <div className="or-surface p-5 mb-6">
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Monthly breakdown</h3>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={WALLET.history}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-col)" />
              <XAxis dataKey="month" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
              <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="creator" stackId="rev" fill="#2EA0FF" />
              <Bar dataKey="ads"     stackId="rev" fill="#F4C84A" />
              <Bar dataKey="merch"   stackId="rev" fill="#10E670" />
              <Bar dataKey="music"   stackId="rev" fill="#C26BFF" />
              <Bar dataKey="subscription" stackId="rev" fill="#FF8AC2" />
              <Bar dataKey="tips"    stackId="rev" fill="#FFB72E" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Transactions */}
      <div className="or-surface p-5" data-testid="wallet-transactions">
        <div className="flex items-center gap-2 mb-3">
          <History size={16} style={{ color: "var(--primary)" }} />
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Transaction history</h3>
        </div>
        <div className="divide-y" style={{ borderColor: "var(--border-col)" }}>
          {WALLET.transactions.map((t) => (
            <div key={t.id} className="py-3 flex items-center gap-3" data-testid={`wallet-tx-${t.id}`} style={{ borderBottom: "1px solid var(--border-col)" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}>
                $
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{t.who}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{t.what} · {t.type}</div>
              </div>
              <div className="text-sm font-bold" style={{ color: "var(--brand-green)" }}>+${t.amount.toFixed(2)}</div>
              <div className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{t.when}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
