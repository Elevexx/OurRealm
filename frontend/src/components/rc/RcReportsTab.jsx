import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Printer, RefreshCw, Save, Trash2, FileText, FileSpreadsheet, File, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const uuid = () => (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const PRESETS = [
  ["last7", "Last 7 days"], ["last30", "Last 30 days"], ["last90", "Last 90 days"],
  ["this_month", "This month"], ["last_month", "Last month"], ["this_year", "This year"],
  ["next30", "Next 30 days"], ["custom", "Custom"],
];

function presetRange(p) {
  const now = new Date();
  const end = new Date(now);
  let start = new Date(now);
  if (p === "last7") start.setDate(start.getDate() - 7);
  else if (p === "last30") start.setDate(start.getDate() - 30);
  else if (p === "last90") start.setDate(start.getDate() - 90);
  else if (p === "this_month") start = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (p === "last_month") { start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end.setTime(new Date(now.getFullYear(), now.getMonth(), 0, 23, 59).getTime()); }
  else if (p === "this_year") start = new Date(now.getFullYear(), 0, 1);
  else if (p === "next30") { end.setDate(end.getDate() + 30); }
  return { date_from: start.toISOString(), date_to: end.toISOString() };
}

const STATUS_COLORS = { ready: "#7BD88F", processing: "#5AB2FF", queued: "#F4C84A", failed: "#FF6B6B", expired: "#9AA7BD" };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const fmtVal = (v) => (v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

// Reports tab — universal report catalog, viewer, exports, saved views.
export const RcReportsTab = ({ centerId, data }) => {
  const [catalog, setCatalog] = useState(null);
  const [active, setActive] = useState(null); // report_key
  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [preset, setPreset] = useState("last30");
  const [custom, setCustom] = useState({ date_from: "", date_to: "" });
  const [memberFilter, setMemberFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [units, setUnits] = useState([]);
  const [runs, setRuns] = useState([]);
  const [views, setViews] = useState([]);

  const loadHome = useCallback(async () => {
    try {
      const [c, r, v] = await Promise.all([
        apiClient.get(`/responsibility-center/${centerId}/reports`),
        apiClient.get(`/responsibility-center/${centerId}/report-runs`),
        apiClient.get(`/responsibility-center/${centerId}/saved-report-views`),
      ]);
      setCatalog(c.data); setRuns(r.data.runs || []); setViews(v.data.views || []);
    } catch (e) {
      setCatalog({ categories: [], denied: true,
        message: typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Reports are not available" });
    }
  }, [centerId]);
  useEffect(() => { loadHome(); }, [loadHome]);
  useEffect(() => {
    apiClient.get(`/responsibility-center/${centerId}/units`).then((r) => setUnits(r.data.units || [])).catch(() => {});
  }, [centerId]);

  const filters = useMemo(() => {
    const range = preset === "custom"
      ? { date_from: custom.date_from ? new Date(custom.date_from).toISOString() : undefined,
          date_to: custom.date_to ? new Date(custom.date_to).toISOString() : undefined }
      : presetRange(preset);
    return { ...range, member_id: memberFilter || undefined, unit_id: unitFilter || undefined };
  }, [preset, custom, memberFilter, unitFilter]);

  const openReport = useCallback(async (key, overrideFilters) => {
    setActive(key); setLoadingReport(true);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/reports/${key}`,
        { filters: overrideFilters || filters });
      setReport(r.data);
    } catch (e) {
      toast.error(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Could not load the report");
      setActive(null);
    } finally { setLoadingReport(false); }
  }, [centerId, filters]);

  const exportReport = async (format) => {
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/reports-export`,
        { report_key: active, format, filters, client_token: uuid() });
      toast.success(`${format.toUpperCase()} export ${r.data.duplicate ? "already" : ""} queued — check Export History`);
      setTimeout(loadHome, 2500);
    } catch (e) { toast.error(e?.response?.data?.detail || "Export failed"); }
  };

  const download = async (run) => {
    try {
      const r = await apiClient.get(`/responsibility-center/${centerId}/report-runs/${run.id}/download`,
        { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `${run.report_key}.${run.format}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error("Download failed — the file may have expired"); }
  };

  const retry = async (run) => {
    try {
      await apiClient.post(`/responsibility-center/${centerId}/report-runs/${run.id}/retry`);
      toast.success("Export re-queued");
      setTimeout(loadHome, 2500);
    } catch (e) { toast.error(e?.response?.data?.detail || "Retry failed"); }
  };

  const saveView = async () => {
    const name = window.prompt("Name this saved view:", report?.name || "My view");
    if (!name) return;
    try {
      await apiClient.post(`/responsibility-center/${centerId}/saved-report-views`,
        { report_key: active, name, filters, client_token: uuid() });
      toast.success("View saved");
      loadHome();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save view"); }
  };

  const deleteView = async (v) => {
    try {
      await apiClient.delete(`/responsibility-center/${centerId}/saved-report-views/${v.id}`);
      setViews((x) => x.filter((y) => y.id !== v.id));
    } catch (e) { toast.error("Could not delete the view"); }
  };

  const doPrint = () => {
    document.body.classList.add("rc-printing");
    window.print();
    setTimeout(() => document.body.classList.remove("rc-printing"), 500);
  };

  if (!catalog) return <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}>Loading reports…</div>;
  if (catalog.denied || !catalog.categories?.length) {
    return (
      <div className="or-surface p-6 text-center" data-testid="rc-reports-denied">
        <BarChart3 size={22} className="mx-auto mb-2" style={{ color: "var(--text-muted)" }} />
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          {catalog.message || "Reports are available to Center managers, admins, and owners."}
        </div>
      </div>
    );
  }

  // ── Report viewer ──
  if (active) {
    return (
      <div className="space-y-4" data-testid="rc-report-viewer">
        <div className="or-surface p-4 no-print">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <button className="or-btn or-btn-ghost text-xs" onClick={() => { setActive(null); setReport(null); loadHome(); }} data-testid="rc-report-back">
              <ArrowLeft size={13} /> All reports
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              {catalog.can_export && (<>
                <button className="or-btn or-btn-ghost text-xs" onClick={() => exportReport("csv")} data-testid="rc-export-csv"><FileText size={12} /> CSV</button>
                <button className="or-btn or-btn-ghost text-xs" onClick={() => exportReport("xlsx")} data-testid="rc-export-xlsx"><FileSpreadsheet size={12} /> Excel</button>
                <button className="or-btn or-btn-ghost text-xs" onClick={() => exportReport("pdf")} data-testid="rc-export-pdf"><File size={12} /> PDF</button>
              </>)}
              <button className="or-btn or-btn-ghost text-xs" onClick={doPrint} data-testid="rc-report-print"><Printer size={12} /> Print</button>
              <button className="or-btn or-btn-ghost text-xs" onClick={saveView} data-testid="rc-report-save-view"><Save size={12} /> Save view</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="or-input text-xs" style={{ width: "auto" }} value={preset} onChange={(e) => setPreset(e.target.value)} data-testid="rc-report-preset">
              {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {preset === "custom" && (<>
              <input type="date" className="or-input text-xs" style={{ width: "auto" }} value={custom.date_from} onChange={(e) => setCustom((c) => ({ ...c, date_from: e.target.value }))} data-testid="rc-report-date-from" />
              <input type="date" className="or-input text-xs" style={{ width: "auto" }} value={custom.date_to} onChange={(e) => setCustom((c) => ({ ...c, date_to: e.target.value }))} data-testid="rc-report-date-to" />
            </>)}
            <select className="or-input text-xs" style={{ width: "auto" }} value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)} data-testid="rc-report-member-filter">
              <option value="">All members</option>
              {(data?.members || []).map((m) => <option key={m.user_id} value={m.user_id}>@{m.username}</option>)}
            </select>
            <select className="or-input text-xs" style={{ width: "auto" }} value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} data-testid="rc-report-unit-filter">
              <option value="">All groups</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="or-btn or-btn-primary text-xs" onClick={() => openReport(active)} data-testid="rc-report-apply">Apply</button>
          </div>
        </div>

        {loadingReport && <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }} data-testid="rc-report-loading">Building report…</div>}

        {report && !loadingReport && (
          <div className="or-surface p-4 rc-print-area" data-testid="rc-report-body">
            <h3 className="text-base font-semibold" data-testid="rc-report-title">{report.center_name} — {report.name}</h3>
            <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              {report.filters.date_from.slice(0, 10)} → {report.filters.date_to.slice(0, 10)} (UTC) · Generated {fmtDate(report.generated_at)}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" data-testid="rc-report-summary">
              {Object.entries(report.summary || {}).map(([k, v]) => (
                <div key={k} className="rounded p-2.5" style={{ background: "rgba(255,255,255,0.04)" }} data-testid={`rc-summary-${k}`}>
                  <div className="text-lg font-semibold leading-tight break-words">{fmtVal(v)}</div>
                  <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}</div>
                </div>
              ))}
            </div>
            {Object.entries(report.breakdowns || {}).filter(([, rows]) => rows?.length).map(([bname, rows]) => {
              const max = Math.max(...rows.map((r) => r.count), 1);
              return (
                <div key={bname} className="mb-4" data-testid={`rc-breakdown-${bname}`}>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1.5">{bname.replace(/_/g, " ")}</div>
                  {rows.slice(0, 12).map((r) => (
                    <div key={String(r.label || r.key)} className="flex items-center gap-2 py-0.5 text-xs">
                      <span className="w-36 truncate shrink-0">{r.label || String(r.key).replace(/_/g, " ")}</span>
                      <span className="flex-1 h-3 rounded" role="img" aria-label={`${r.label || r.key}: ${r.count}`}
                        style={{ background: `linear-gradient(90deg, #5AB2FF ${Math.round(r.count * 100 / max)}%, rgba(255,255,255,0.06) ${Math.round(r.count * 100 / max)}%)` }} />
                      <span className="w-10 text-right shrink-0">{r.count}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {!!(report.columns?.length && report.rows?.length) && (
              <div className="overflow-x-auto" data-testid="rc-report-table">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
                      {report.columns.map((c) => <th key={c} className="text-left py-1.5 pr-3 whitespace-nowrap uppercase text-[10px]" scope="col">{c.replace(/_/g, " ")}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.slice(0, 100).map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        {report.columns.map((c) => <td key={c} className="py-1.5 pr-3">{fmtVal(r[c]).length > 40 ? `${fmtVal(r[c]).slice(0, 40)}…` : fmtVal(r[c])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.rows.length > 100 && <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>Showing 100 of {report.rows.length} rows — export for the full data.</div>}
              </div>
            )}
            {!report.rows?.length && !Object.values(report.breakdowns || {}).some((r) => r?.length) && !Object.keys(report.summary || {}).length && (
              <div className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }} data-testid="rc-report-empty">No data in this range.</div>
            )}
            {report.note && <div className="text-[10px] mt-3 italic" style={{ color: "var(--text-muted)" }}>{report.note}</div>}
          </div>
        )}
      </div>
    );
  }

  // ── Catalog home ──
  return (
    <div className="space-y-4" data-testid="rc-tab-reports">
      {catalog.categories.map((cat) => (
        <div key={cat.category} className="or-surface p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide mb-2">{cat.category}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cat.reports.map((r) => (
              <button key={r.report_key} className="text-left rounded p-3 transition-colors"
                style={{ background: "rgba(255,255,255,0.04)" }}
                onClick={() => openReport(r.report_key)} data-testid={`rc-report-card-${r.report_key}`}>
                <div className="text-sm font-semibold mb-0.5">{r.name}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{r.description}</div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {views.length > 0 && (
        <div className="or-surface p-4" data-testid="rc-saved-views">
          <h3 className="text-sm font-semibold uppercase tracking-wide mb-2">Saved views</h3>
          {views.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 py-1.5"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid={`rc-saved-view-${v.id}`}>
              <button className="text-sm text-left flex-1 truncate" onClick={() => openReport(v.report_key, v.filters)} data-testid={`rc-saved-view-open-${v.id}`}>
                {v.name} <span className="text-[10px] uppercase ml-1" style={{ color: "var(--text-muted)" }}>{v.report_key.replace(/_/g, " ")}</span>
              </button>
              <button className="or-btn or-btn-ghost p-1.5" onClick={() => deleteView(v)} aria-label="Delete view" data-testid={`rc-saved-view-delete-${v.id}`}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="or-surface p-4" data-testid="rc-export-history">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Export history</h3>
          <button className="or-btn or-btn-ghost p-1.5" onClick={loadHome} aria-label="Refresh" data-testid="rc-export-refresh"><RefreshCw size={13} /></button>
        </div>
        {!runs.length && <div className="text-sm py-3" style={{ color: "var(--text-muted)" }} data-testid="rc-export-empty">No exports yet — open a report and choose CSV, Excel, or PDF.</div>}
        {runs.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }} data-testid={`rc-export-run-${r.id}`}>
            <div className="min-w-0">
              <div className="text-sm truncate">{r.report_name} <span className="text-[10px] uppercase ml-1" style={{ color: "var(--text-muted)" }}>{r.format}</span></div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {fmtDate(r.requested_at)} by @{r.requested_by_username}
                {r.record_count !== null && r.record_count !== undefined ? ` · ${r.record_count} rows` : ""}
                {r.expires_at && r.status === "ready" ? ` · expires ${fmtDate(r.expires_at)}` : ""}
                {r.failure_reason ? ` · ${r.failure_reason.slice(0, 60)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] uppercase font-semibold" style={{ color: STATUS_COLORS[r.status] || "#9AA7BD" }} data-testid={`rc-export-status-${r.id}`}>{r.status}</span>
              {r.status === "ready" && (
                <button className="or-btn or-btn-primary text-xs" onClick={() => download(r)} data-testid={`rc-export-download-${r.id}`}><Download size={12} /> Download</button>
              )}
              {(r.status === "failed" || r.status === "expired") && (
                <button className="or-btn or-btn-ghost text-xs" onClick={() => retry(r)} data-testid={`rc-export-retry-${r.id}`}>Retry</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
