import React, { useState } from "react";
import { ChevronDown, ChevronRight, Copy, RefreshCcw, Settings2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const fmtBytes = (n) => (!n ? "—" : n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);
const fmtTime = (t) => (t ? new Date(t).toLocaleString() : "—");

// VideoDiagnostics — founder-only collapsible panel under a lesson video block.
export default function VideoDiagnostics({ lessonId, block }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const isFounder = user && (user.admin_role === "founder" || user.username === "stealth");
  if (!isFounder) return null;

  const load = async () => {
    setBusy(true);
    try {
      const r = await apiClient.get("/admin/ai-video/diagnose", { params: { lesson_id: lessonId, block_id: block.id } });
      setD(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not load diagnostics"); }
    finally { setBusy(false); }
  };
  const toggle = () => { if (!open && !d) load(); setOpen(!open); };
  const copyAll = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(d, null, 2)); toast.success("Diagnostics copied"); }
    catch { toast.error("Could not copy"); }
  };

  const rows = d ? [
    ["Dry Run", d.settings_dry_run ? "ON (settings)" : "OFF (settings)"],
    ["This clip", d.dry_run == null ? "—" : d.dry_run ? "DRY RUN TEST CLIP" : "Real AI output"],
    ["Provider route", d.provider || "—"],
    ["Job ID", d.generation_job_id || "—"],
    ["Generation status", d.job_status || "—"],
    ["Storage status", d.storage_file_exists ? `File stored ✓${d.storage_location ? ` (${d.storage_location})` : ""}` : "File missing"],
    ["Storage URL", d.storage_url || "—"],
    ["Asset URL", d.asset_url || "—"],
    ["Player URL", d.player_url || "—"],
    ["MIME type", d.mime_type || "—"],
    ["File size", fmtBytes(d.storage_file_bytes)],
    ["Last error", d.last_error || "none"],
    ["Last retry", d.last_retry ? `${d.last_retry.status} (attempt ${d.last_retry.attempt}) ${d.last_retry.last_error || ""}` : "none"],
    ["Created", fmtTime(d.created_at)],
    ["Finished", fmtTime(d.finished_at)],
  ] : [];

  return (
    <div className="mt-2 rounded-lg" style={{ background: "rgba(244,167,59,0.04)", border: "1px dashed rgba(244,167,59,0.3)" }}
      data-testid={`video-diagnostics-${block.id}`}>
      <button className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "#F4A73B" }} onClick={toggle} data-testid="video-diagnostics-toggle">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Video Diagnostics
        <span className="font-normal normal-case tracking-normal" style={{ color: "var(--text-muted)" }}>(founder only)</span>
      </button>
      {open && (
        <div className="px-2 pb-2" data-testid="video-diagnostics-body">
          {busy && !d && <div className="text-[10px] py-2" style={{ color: "var(--text-muted)" }}><Loader2 size={11} className="animate-spin inline mr-1" /> Loading…</div>}
          {d?.verdict && (
            <div className="text-[10px] mb-1.5 p-1.5 rounded-lg font-semibold" style={{ background: "rgba(77,214,193,0.1)", color: "#4DD6C1" }}
              data-testid="video-diagnostics-verdict">{d.verdict}</div>
          )}
          {d && (
            <div className="space-y-0.5">
              {rows.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[10px]">
                  <span className="w-28 shrink-0" style={{ color: "var(--text-muted)" }}>{k}</span>
                  <span className="break-all">{v}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button className="or-btn or-btn-ghost text-[10px]" onClick={copyAll} disabled={!d} data-testid="video-diagnostics-copy">
              <Copy size={10} /> Copy Diagnostics
            </button>
            <button className="or-btn or-btn-ghost text-[10px]" onClick={load} disabled={busy} data-testid="video-diagnostics-refresh">
              {busy ? <Loader2 size={10} className="animate-spin" /> : <RefreshCcw size={10} />} Refresh Status
            </button>
            <button className="or-btn or-btn-ghost text-[10px]" onClick={() => window.open("/admin/ai-video", "_blank")}
              data-testid="video-diagnostics-settings">
              <Settings2 size={10} /> Open Video Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
