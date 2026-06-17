/**
 * ModerationPanel — Phase A moderation widget for /admin.
 *
 * Wraps four analytics cards + a queue + a Removed Content drawer.
 * Reuses the existing analytics surfaces / tokens — purely additive,
 * does not redesign anything around it.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Shield, Loader2, CheckCircle2, EyeOff, RotateCcw, Trash2, UserX, BellOff } from "lucide-react";
import apiClient from "@/api/client";

const CARDS = [
  { id: "pending_review", label: "Pending review" },
  { id: "auto_hidden",    label: "Auto-hidden" },
  { id: "total_reports",  label: "Total reports" },
  { id: "removed_today",  label: "Removed today" },
];

function Card({ label, value, testid }) {
  return (
    <div className="or-surface p-4" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-2xl mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>{value ?? 0}</div>
    </div>
  );
}

function Row({ item, onAction, busy }) {
  return (
    <div
      className="or-surface p-3 flex flex-col sm:flex-row sm:items-center gap-3"
      data-testid={`mod-row-${item.content_type}-${item.id}`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          {item.content_type} · score {Math.round((item.moderation_score || 0) * 100)}% · {item.moderation_reason || "n/a"}
        </div>
        <div className="text-sm or-wrap" style={{ color: "var(--text-main)" }}>
          {item.title || <em>(no preview)</em>}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          {item.moderated_at || ""}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {[
          { id: "approve",     Icon: CheckCircle2, label: "Approve" },
          { id: "hide",        Icon: EyeOff,       label: "Hide" },
          { id: "restore",     Icon: RotateCcw,    label: "Restore" },
          { id: "delete",      Icon: Trash2,       label: "Delete",      destructive: true },
          { id: "ban",         Icon: UserX,        label: "Ban user",    destructive: true },
          { id: "acknowledge", Icon: BellOff,      label: "Acknowledge" },
        ].map(({ id, Icon, label, destructive }) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            onClick={() => onAction(item, id)}
            className="or-chip"
            style={destructive ? { color: "#FF8080", borderColor: "rgba(255,80,80,0.4)" } : undefined}
            data-testid={`mod-action-${id}-${item.id}`}
          >
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ModerationPanel() {
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const [s, q, r] = await Promise.all([
        apiClient.get("/admin/moderation/summary"),
        apiClient.get("/admin/moderation/queue?status=pending_review&limit=50"),
        apiClient.get("/admin/moderation/removed?limit=50"),
      ]);
      setSummary(s.data); setItems(q.data?.items || []); setRemoved(r.data?.items || []);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load moderation data");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (item, action) => {
    setBusy(true);
    try {
      await apiClient.post(`/admin/moderation/${item.content_type}/${item.id}/action`, { action });
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Action failed");
    } finally { setBusy(false); }
  };

  return (
    <section className="mt-8" data-testid="admin-moderation">
      <div className="flex items-center gap-2 mb-3">
        <Shield size={18} style={{ color: "var(--primary)" }} />
        <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Moderation</h3>
      </div>

      {err && <div className="or-surface p-3 mb-3 text-sm" style={{ color: "#FF8080" }} data-testid="mod-error">{err}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" data-testid="mod-cards">
        {CARDS.map((c) => (
          <Card key={c.id} label={c.label} value={summary?.[c.id]} testid={`mod-card-${c.id}`} />
        ))}
      </div>

      {loading ? (
        <div className="or-surface p-6 flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <>
          <h4 className="text-sm uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>Pending review queue</h4>
          <div className="space-y-2" data-testid="mod-queue">
            {items.length === 0 ? (
              <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="mod-queue-empty">
                Nothing waiting — the auto-moderator is quiet right now.
              </div>
            ) : items.map((it) => <Row key={`q-${it.id}`} item={it} onAction={act} busy={busy} />)}
          </div>

          <h4 className="text-sm uppercase tracking-widest mb-2 mt-6" style={{ color: "var(--text-muted)" }}>Removed content</h4>
          <div className="space-y-2 mb-12" data-testid="mod-removed">
            {removed.length === 0 ? (
              <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="mod-removed-empty">
                Nothing has been removed yet.
              </div>
            ) : removed.map((it) => <Row key={`r-${it.id}`} item={it} onAction={act} busy={busy} />)}
          </div>
        </>
      )}
    </section>
  );
}
