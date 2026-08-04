import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { AlertTriangle, Gavel, MessageSquareWarning, RefreshCw, Shield, Sparkles, Undo2 } from "lucide-react";

const Chip = ({ children, color = "#7B8CFF" }) => (
  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
    style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>{children}</span>
);

const Card = ({ label, value, color }) => (
  <div className="or-surface p-2.5 text-center" data-testid={`ts-card-${label.replaceAll(" ", "-").toLowerCase()}`}>
    <div className="text-xl font-black" style={{ color }}>{value ?? 0}</div>
    <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</div>
  </div>
);

const PRETTY = (s) => (s || "").replaceAll("_", " ");

export default function AdminTrustSafety() {
  const [dash, setDash] = useState(null);
  const [cases, setCases] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [detail, setDetail] = useState(null);
  const [cmd, setCmd] = useState("");
  const [cmdOut, setCmdOut] = useState(null);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("queue");

  const refresh = useCallback(() => {
    apiClient.get("/admin/trust-safety/dashboard").then((r) => setDash(r.data)).catch(() => {});
    apiClient.get("/admin/trust-safety/queue").then((r) => setCases(r.data.cases)).catch(() => {});
    apiClient.get("/admin/trust-safety/appeals").then((r) => setAppeals(r.data.appeals)).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const openCase = async (id) => {
    const { data } = await apiClient.get(`/admin/trust-safety/case/${id}`);
    setDetail(data); setCmdOut(null);
  };

  const runCommand = async (confirmed = false) => {
    if (!cmd.trim()) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post("/admin/trust-safety/command", {
        text: cmd, target_user_id: detail?.case?.user_id, confirmed,
      });
      if (data.needs_confirmation) { setPendingConfirm(data); }
      else {
        setPendingConfirm(null); setCmdOut(data);
        toast[data.ok ? "success" : "error"](data.ok ? `ORAi executed: ${data.action || data.undone_action || "query"}` : data.message || "Command failed");
        refresh(); if (detail) openCase(detail.case.id);
      }
    } catch (e) { toast.error(e?.response?.data?.detail || "Command failed"); }
    finally { setBusy(false); }
  };

  const bulk = async (action, confirmed = false) => {
    setBusy(true);
    try {
      const { data } = await apiClient.post(`/admin/trust-safety/bulk/${detail.case.user_id}`, { action, confirmed });
      if (data.needs_confirmation) { setPendingConfirm({ ...data, bulkAction: action }); }
      else { toast.success(`${PRETTY(action)} done`); refresh(); openCase(detail.case.id); }
    } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };

  const resolveAppeal = async (id, resolution) => {
    await apiClient.post(`/admin/trust-safety/appeals/${id}/resolve`, { resolution });
    toast.success(`Appeal ${resolution}`); refresh();
  };

  return (
    <div className="max-w-6xl mx-auto px-3 py-4 space-y-3" data-testid="trust-safety-page">
      <div className="flex items-center gap-2">
        <Shield size={18} style={{ color: "#2EE6FF" }} />
        <h1 className="text-lg font-black flex-1">Trust &amp; Safety Command Center</h1>
        <button className="or-btn text-[10px] flex items-center gap-1" onClick={refresh} data-testid="ts-refresh-btn">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {dash && (
        <>
          <div className="grid grid-cols-5 gap-2">
            <Card label="active cases" value={dash.cards.active_cases} color="#2EA0FF" />
            <Card label="urgent" value={dash.cards.urgent_cases} color="#FF5470" />
            <Card label="pending review" value={dash.cards.pending_founder_review} color="#F4A73B" />
            <Card label="suspended" value={dash.cards.suspended} color="#C26BFF" />
            <Card label="appeals" value={dash.cards.appeals_pending} color="#10E670" />
          </div>
          <div className="grid grid-cols-5 gap-2">
            <Card label="banned" value={dash.cards.banned} color="#FF5470" />
            <Card label="spam 24h" value={dash.cards.spam_24h} color="#F4A73B" />
            <Card label="harassment 24h" value={dash.cards.harassment_24h} color="#FF5470" />
            <Card label="false positives fixed" value={dash.cards.false_positives_restored} color="#10E670" />
            <div className="or-surface p-2" data-testid="ts-trending">
              <div className="text-[8.5px] uppercase font-bold mb-0.5" style={{ color: "var(--text-muted)" }}>Trending abuse</div>
              {(dash.trending_abuse || []).slice(0, 3).map((t) => (
                <div key={t.reason} className="text-[9px]">{PRETTY(t.reason)} · {t.count}</div>
              ))}
            </div>
          </div>
          <div className="or-surface p-2.5 flex items-start gap-2" data-testid="ts-recommendations">
            <Sparkles size={13} className="mt-0.5 shrink-0" style={{ color: "#C26BFF" }} />
            <div className="text-[10.5px]">{(dash.orai_recommendations || []).join(" · ")}</div>
          </div>
        </>
      )}

      <div className="flex gap-2">
        {["queue", "appeals"].map((t) => (
          <button key={t} className={`or-btn text-[10.5px] ${tab === t ? "font-black" : ""}`}
            style={tab === t ? { background: "rgba(46,230,255,.15)", color: "#2EE6FF" } : {}}
            onClick={() => setTab(t)} data-testid={`ts-tab-${t}`}>{t === "queue" ? "Moderation Queue" : `Appeals (${appeals.length})`}</button>
        ))}
      </div>

      {tab === "appeals" && (
        <div className="space-y-1.5" data-testid="ts-appeals-list">
          {appeals.length === 0 && <div className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>No pending appeals.</div>}
          {appeals.map((a) => (
            <div key={a.id} className="or-surface p-2.5 flex flex-wrap items-center gap-2" data-testid={`appeal-${a.id}`}>
              <b className="text-[11px]">@{a.username}</b>
              <span className="text-[10px] flex-1" style={{ color: "var(--text-muted)" }}>{a.message}</span>
              {["approved", "rejected", "reduce_penalty", "extend_penalty"].map((r) => (
                <button key={r} className="or-btn text-[9px]" onClick={() => resolveAppeal(a.id, r)}
                  data-testid={`appeal-${a.id}-${r}`}>{PRETTY(r)}</button>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "queue" && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2 space-y-1.5" data-testid="ts-queue-list">
            {cases.length === 0 && <div className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>Queue is empty.</div>}
            {cases.map((c) => (
              <button key={c.id} className="or-surface p-2.5 w-full text-left" onClick={() => openCase(c.id)}
                data-testid={`ts-case-${c.id}`}
                style={detail?.case?.id === c.id ? { borderColor: "#2EE6FF" } : {}}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Chip color={c.priority >= 85 ? "#FF5470" : c.priority >= 70 ? "#F4A73B" : "#7B8CFF"}>P{c.priority}</Chip>
                  <b className="text-[11px]">@{c.username}</b>
                  {c.escalated && <Chip color="#FF5470">auto-locked</Chip>}
                </div>
                <div className="text-[9.5px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {(c.reasons || []).map(PRETTY).join(", ")} — {c.ai_summary?.slice(0, 90)}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-3 space-y-2">
            {!detail && <div className="or-surface p-4 text-[10.5px]" style={{ color: "var(--text-muted)" }}>Select a case to review.</div>}
            {detail && (
              <>
                <div className="or-surface p-3" data-testid="ts-case-detail">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <b className="text-sm">@{detail.user?.username}</b>
                    <Chip color="#2EA0FF">trust {detail.user?.trust?.score ?? "?"} · {detail.user?.trust?.tier}</Chip>
                    <Chip color={detail.user?.ts_status === "locked_pending_founder_review" ? "#FF5470" : "#10E670"}>
                      {PRETTY(detail.user?.ts_status || "active")}</Chip>
                    <div className="flex-1" />
                    <button className="or-btn text-[9px]" onClick={() => apiClient.post(`/admin/trust-safety/case/${detail.case.id}/resolve`, { resolution: "reviewed" }).then(() => { toast.success("Case resolved"); setDetail(null); refresh(); })}
                      data-testid="ts-resolve-case-btn"><Gavel size={10} className="inline mr-0.5" />Resolve case</button>
                  </div>
                  <div className="text-[10px] mb-1.5" style={{ color: "var(--text-muted)" }} data-testid="ts-ai-summary">
                    <b style={{ color: "#C26BFF" }}>ORAi:</b> {detail.case.ai_summary}
                  </div>
                  <div className="text-[9px] mb-2" style={{ color: "var(--text-muted)" }}>
                    Violations: {detail.events?.filter((e) => e.violation).length} · Reports: {detail.reports?.length} ·
                    Posts: {detail.posts?.length} · Flagged DMs: {detail.flagged_dms?.length} · Appeals: {detail.appeals?.length}
                  </div>
                  <div className="flex flex-wrap gap-1" data-testid="ts-bulk-actions">
                    {(detail.bulk_actions || []).map((a) => (
                      <button key={a} className="text-[8.5px] px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)",
                                 color: ["ban", "delete_account"].includes(a) ? "#FF5470" : "var(--text-muted)" }}
                        disabled={busy} onClick={() => bulk(a)} data-testid={`ts-bulk-${a}`}>{PRETTY(a)}</button>
                    ))}
                  </div>
                </div>

                <div className="or-surface p-3" data-testid="ts-command-bar">
                  <div className="flex gap-1.5">
                    <MessageSquareWarning size={13} className="mt-1.5 shrink-0" style={{ color: "#2EE6FF" }} />
                    <input className="or-input flex-1 text-[11px]" value={cmd} onChange={(e) => setCmd(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && runCommand(false)}
                      placeholder='Tell ORAi: "Suspend this account", "Delete all posts", "Explain why ORAi flagged this account"…'
                      data-testid="ts-command-input" />
                    <button className="or-btn text-[10px]" disabled={busy} onClick={() => runCommand(false)}
                      data-testid="ts-command-run">Run</button>
                    <button className="or-btn text-[10px]" disabled={busy} title="Undo last moderation action"
                      onClick={() => { setCmd("undo"); setTimeout(() => runCommand(false), 0); }}
                      data-testid="ts-undo-btn"><Undo2 size={11} /></button>
                  </div>
                  {pendingConfirm && (
                    <div className="mt-2 p-2 rounded flex items-center gap-2" data-testid="ts-confirm-prompt"
                      style={{ background: "rgba(255,84,112,.1)", border: "1px solid rgba(255,84,112,.4)" }}>
                      <AlertTriangle size={12} style={{ color: "#FF5470" }} />
                      <span className="text-[10px] flex-1">{pendingConfirm.prompt}</span>
                      <button className="or-btn text-[9.5px] font-bold" style={{ color: "#FF5470" }}
                        onClick={() => pendingConfirm.bulkAction ? bulk(pendingConfirm.bulkAction, true) : runCommand(true)}
                        data-testid="ts-confirm-yes">Confirm</button>
                      <button className="or-btn text-[9.5px]" onClick={() => setPendingConfirm(null)}
                        data-testid="ts-confirm-no">Cancel</button>
                    </div>
                  )}
                  {cmdOut && (
                    <pre className="mt-2 text-[9px] p-2 rounded max-h-40 overflow-auto"
                      style={{ background: "rgba(255,255,255,.04)", color: "var(--text-muted)" }}
                      data-testid="ts-command-output">{JSON.stringify(cmdOut, null, 1).slice(0, 2500)}</pre>
                  )}
                </div>

                <div className="or-surface p-3" data-testid="ts-timeline">
                  <div className="text-[9px] uppercase font-bold mb-1" style={{ color: "var(--text-muted)" }}>Timeline & audit</div>
                  {[...(detail.case.timeline || []).map((t) => ({ at: t.at, txt: t.note, c: "#7B8CFF" })),
                    ...(detail.moderation_history || []).slice(0, 10).map((h) => ({
                      at: h.at, txt: `${h.action} by ${h.initiated_by}${h.reason ? " — " + h.reason : ""}`, c: "#F4A73B" }))]
                    .sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 12)
                    .map((t, i) => (
                      <div key={i} className="text-[9.5px]"><span style={{ color: t.c }}>{t.at?.slice(5, 16)}</span>{" "}
                        <span style={{ color: "var(--text-muted)" }}>{t.txt}</span></div>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
