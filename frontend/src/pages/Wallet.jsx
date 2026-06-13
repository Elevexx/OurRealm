import React from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, ArrowUpRight, Wallet as WalletIcon } from "lucide-react";
import { WALLET } from "@/data/mockData";

export default function Wallet() {
  return (
    <div className="max-w-6xl mx-auto" data-testid="wallet-page">
      <div className="mb-6 flex items-center gap-3">
        <WalletIcon size={28} style={{ color: "var(--primary)" }} />
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Creator economy</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Wallet</h1>
        </div>
      </div>

      {/* Balance */}
      <div className="or-surface p-6 sm:p-8 mb-5 grain" data-testid="wallet-balance-card">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Total balance</div>
        <div className="mt-2 text-4xl sm:text-5xl glow-text" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
          ${WALLET.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
        <div className="mt-2 inline-flex items-center gap-1 text-sm" style={{ color: "var(--primary)" }}>
          <ArrowUpRight size={16} /> +{WALLET.monthly_change_pct}% this month
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="or-btn" data-testid="wallet-withdraw">Withdraw</button>
          <button className="or-btn or-btn-ghost" data-testid="wallet-deposit">Deposit</button>
          <button className="or-btn or-btn-ghost" data-testid="wallet-history">View history</button>
        </div>
      </div>

      {/* Earnings breakdown */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {WALLET.rows.map((r) => (
          <div key={r.id} className="or-surface p-4" data-testid={`wallet-row-${r.id}`}>
            <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{r.label}</div>
            <div className="text-2xl mt-2" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
              ${r.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="or-surface p-5" data-testid="wallet-chart-line">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} style={{ color: "var(--primary)" }} />
            <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Royalties trend</h3>
          </div>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={WALLET.history}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-col)" />
                <XAxis dataKey="month" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="royalties" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="or-surface p-5" data-testid="wallet-chart-bar">
          <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Rewards vs Shop</h3>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={WALLET.history}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-col)" />
                <XAxis dataKey="month" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", borderRadius: 8 }} />
                <Bar dataKey="rewards" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="shop" fill="var(--secondary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
