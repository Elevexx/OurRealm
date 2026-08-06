/**
 * DataExportCard — "Download My Data" under Settings > Account.
 * Exports are authenticated, expire after 48h, and allow 5 downloads.
 */
import React, { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import apiClient from "@/api/client";

export default function DataExportCard({ exports = [], onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastToken, setLastToken] = useState(null);

  const createExport = async () => {
    setBusy(true); setMsg("");
    try {
      const { data } = await apiClient.post("/account/export");
      if (data.export?.token) {
        setLastToken({ id: data.export.id, token: data.export.token });
        setMsg("Export ready — download it within 48 hours (max 5 downloads).");
      } else {
        setMsg(data.export?.note || "An existing export is still available.");
      }
      onRefresh?.();
    } catch (e) {
      setMsg(e?.response?.data?.detail || "Could not create export");
    } finally {
      setBusy(false);
    }
  };

  const download = async (id, token) => {
    try {
      const res = await apiClient.get(
        `/account/export/${id}/download?token=${encodeURIComponent(token)}`,
        { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = `ourrealm-data-${id.slice(0, 8)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      onRefresh?.();
    } catch (e) {
      setMsg("Download failed — the link may have expired or hit its limit.");
    }
  };

  return (
    <div className="or-surface p-4" data-testid="data-export-card">
      <div className="flex items-center gap-2 mb-2">
        <Download size={14} style={{ color: "#4DD2FF" }} />
        <h3 className="text-sm font-semibold">Download My Data</h3>
      </div>
      <p className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>
        Get a copy of your profile, posts, comments, friends list and account
        history as JSON. Links expire after 48 hours. Consider downloading your
        data before closing or deleting your account.
      </p>
      <button type="button" onClick={createExport} disabled={busy}
        className="or-btn text-xs" data-testid="data-export-create">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        &nbsp;Prepare My Data Export
      </button>
      {lastToken && (
        <button type="button" className="or-btn text-xs ml-2"
          style={{ background: "#0E7490", color: "#fff" }}
          onClick={() => download(lastToken.id, lastToken.token)}
          data-testid="data-export-download">
          <Download size={14} />&nbsp;Download Now
        </button>
      )}
      {msg && <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }} data-testid="data-export-msg">{msg}</div>}
      {exports.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid="data-export-history">
          {exports.map((e) => (
            <li key={e.id} className="text-[11px] flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
              <span>{new Date(e.created_at).toLocaleString()}</span>
              <span className="or-chip text-[10px]">{e.status}</span>
              <span>{e.downloads}/{e.max_downloads} downloads</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
