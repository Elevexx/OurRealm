/**
 * VersionHistory — drawer-style modal showing the snapshot list for
 * a single widget. Each PATCH that touches content fields snapshots
 * the prior config; rollback restores it (capped at 20 snapshots).
 * @stealth-only rollback enforced server-side.
 */
import React, { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";

export default function VersionHistory({ widget, onClose, onRolledBack }) {
  const [versions, setVersions] = useState([]);
  const [current, setCurrent] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await apiClient.get(`/admin/widgets/${widget.id}/versions`);
        if (!cancelled) {
          setVersions(data?.versions || []);
          setCurrent(data?.current_version || 1);
        }
      } catch (e) { console.error(e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [widget.id]);

  const rollback = async (version) => {
    if (!window.confirm(`Rollback "${widget.name}" to version ${version}? This snapshots the current state first.`)) return;
    setBusy(version); setError(null);
    try {
      const { data } = await apiClient.post(`/admin/widgets/${widget.id}/rollback/${version}`);
      onRolledBack?.(data?.widget);
    } catch (e) {
      setError(e?.response?.data?.detail || "Rollback failed");
    } finally { setBusy(null); }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="version-history"
    >
      <div className="or-surface w-full max-w-xl p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Version History</h2>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {widget.name} · current v{current}
            </div>
          </div>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>

        {error && (
          <div className="text-xs mb-3 px-3 py-2 rounded" style={{ background: "rgba(255,90,107,0.14)", color: "#FF8080" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center p-8"><Icons.Loader2 className="animate-spin inline" /></div>
        ) : versions.length === 0 ? (
          <div className="or-surface p-6 text-center text-sm" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
            No previous versions yet. Edits will snapshot here automatically.
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div
                key={v.version}
                className="or-surface p-3 flex items-center gap-3"
                style={{ background: "var(--surface-2)" }}
                data-testid={`version-row-${v.version}`}
              >
                <div className="rounded-md p-2" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}>
                  <Icons.History size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold" style={{ color: "var(--text-main)" }}>
                    v{v.version} · {v.name || widget.name}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Layout: {v.editor_config?.layout || "—"} · {v.editor_config?.fields?.length || 0} fields · {v.snapshotted_at?.slice(0, 19).replace("T", " ")} by @{v.snapshotted_by}
                  </div>
                </div>
                <button
                  className="or-btn or-btn-ghost text-xs"
                  disabled={busy === v.version}
                  onClick={() => rollback(v.version)}
                  data-testid={`version-rollback-${v.version}`}
                >
                  {busy === v.version ? <Icons.Loader2 size={12} className="animate-spin" /> : <Icons.RotateCcw size={12} />} Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
