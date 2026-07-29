/**
 * ModCaseDetail — full moderation case view (modal).
 * Content preview w/ blur toggle, AI data, reports, internal notes,
 * audit trail, full action set.
 */
import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Loader2, X, StickyNote } from "lucide-react";
import apiClient from "@/api/client";
import { absoluteImageUrl } from "@/components/ImageUploadPicker";
import ModPostRow from "@/components/admin/ModPostRow";

export default function ModCaseDetail({ contentType, contentId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`/admin/moderation/case/${contentType}/${contentId}`);
      setData(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load case");
    }
  }, [contentType, contentId]);

  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    if (!note.trim()) return;
    setNoteBusy(true);
    try {
      await apiClient.post(`/admin/moderation/${contentType}/${contentId}/note`, { note: note.trim() });
      setNote("");
      toast.success("Note added");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to add note");
    } finally { setNoteBusy(false); }
  };

  const c = data?.content || {};
  const s = c.safety || {};
  const img = (c.image_urls || [])[0] || c.image_url;
  const sensitive = (s.severity || 0) >= 1 || (s.manual_blur || {}).active;

  const row = data ? {
    id: c.id,
    content: c.content,
    media_type: c.media_type,
    image_url: null,
    video_url: null,
    created_at: c.created_at,
    author_id: c.author_id || c.user_id,
    author_username: data.uploader?.username,
    visibility: (c.audience || {}).visibility || "public",
    moderation_status: c.moderation_status || "approved",
    severity: s.severity || 0,
    categories: s.categories || [],
    manual_blur: !!(s.manual_blur || {}).active,
    review_locked: !!(c.review_lock || {}).active,
    urgent: !!s.urgent,
    scan_status: s.scan_status,
    fire_total: c.fire_total || 0,
    likes: c.likes || 0,
    comments: c.comments || 0,
    report_count: (data.reports || []).length,
  } : null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center px-2 sm:px-4 py-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)", zIndex: 10040 }}
      onClick={onClose}
      data-testid="mod-case-overlay"
    >
      <div
        className="or-surface w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto p-4 sm:p-5"
        onClick={(e) => e.stopPropagation()}
        data-testid="mod-case-detail"
      >
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-lg flex-1" style={{ fontFamily: "var(--font-display)" }}>
            Moderation Case · {contentType} · {String(contentId).slice(0, 10)}…
          </h3>
          <button onClick={onClose} className="starbar-icon" style={{ width: 32, height: 32 }} data-testid="mod-case-close">
            <X size={15} />
          </button>
        </div>

        {err && <div className="text-sm mb-3" style={{ color: "#FF8080" }} data-testid="mod-case-error">{err}</div>}
        {!data && !err && <div className="p-6 flex justify-center"><Loader2 className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>}

        {data && (
          <>
            {img && (
              <div className="relative overflow-hidden mb-3" style={{ borderRadius: 10, border: "1px solid var(--border-col)" }}>
                <img src={absoluteImageUrl(img)} alt="" className="w-full object-contain" style={{ maxHeight: 320, filter: sensitive && !showOriginal ? "blur(24px)" : "none" }} data-testid="mod-case-media" />
                {sensitive && (
                  <button className="or-chip absolute top-2 right-2" style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
                    onClick={() => setShowOriginal((v) => !v)} data-testid="mod-case-blur-toggle">
                    {showOriginal ? "Blur preview" : "View original"}
                  </button>
                )}
              </div>
            )}

            {row && <div className="mb-3"><ModPostRow post={row} source="moderation_center" onChanged={() => { load(); onChanged?.(); }} onOpenCase={() => {}} /></div>}

            <div className="or-surface p-3 mb-3 text-[11px]" style={{ color: "var(--text-main)" }} data-testid="mod-case-ai">
              <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>AI detection (internal)</div>
              severity L{s.severity ?? 0} · confidence {Math.round((s.confidence || 0) * 100)}% · {s.detection_source || "not scanned"} · model {s.model || "—"}
              {s.context ? ` · context: ${s.context}` : ""}{s.reason ? ` · ${s.reason}` : ""}
              {(c.review_lock || {}).active && (
                <div className="mt-1" style={{ color: "#B98CFF" }}>
                  Private review lock by {String(c.review_lock.locked_by || "").slice(0, 8)} · reason: {c.review_lock.reason} · original vis: {(c.review_lock.original_audience || {}).visibility}
                </div>
              )}
            </div>

            <div className="or-surface p-3 mb-3" data-testid="mod-case-reports">
              <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
                User reports ({(data.reports || []).length})
              </div>
              {(data.reports || []).length === 0 ? (
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>No user reports.</div>
              ) : data.reports.map((r) => (
                <div key={r.id} className="text-[11px] py-1" style={{ borderTop: "1px solid var(--border-col)", color: "var(--text-main)" }}>
                  <b>{r.reason}</b> · @{r.reporter_username || "?"} · {String(r.created_at || "").slice(0, 16)} · {r.status}
                  {r.detail ? <div style={{ color: "var(--text-muted)" }}>{r.detail}</div> : null}
                </div>
              ))}
            </div>

            <div className="or-surface p-3 mb-3" data-testid="mod-case-notes">
              <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
                Internal moderator notes
              </div>
              {(data.notes || []).map((n) => (
                <div key={n.id} className="text-[11px] py-1" style={{ borderTop: "1px solid var(--border-col)", color: "var(--text-main)" }}>
                  <b>@{n.author_username || "?"}</b> · {String(n.created_at || "").slice(0, 16)}
                  <div>{n.note}</div>
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <input
                  className="flex-1 text-sm px-3 py-2"
                  style={{ background: "transparent", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)" }}
                  placeholder="Add a confidential note…"
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                  data-testid="mod-case-note-input"
                />
                <button className="or-chip" disabled={noteBusy || !note.trim()} onClick={addNote} data-testid="mod-case-note-add">
                  {noteBusy ? <Loader2 size={12} className="animate-spin" /> : <StickyNote size={12} />} Add
                </button>
              </div>
            </div>

            <div className="or-surface p-3" data-testid="mod-case-audit">
              <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
                Audit trail ({(data.audit || []).length})
              </div>
              <div className="max-h-52 overflow-y-auto space-y-1">
                {(data.audit || []).map((a) => (
                  <div key={a.id} className="text-[11px]" style={{ color: "var(--text-main)" }}>
                    <b>{a.action}</b> · {String(a.created_at || "").slice(0, 16)} · actor {a.actor_id ? String(a.actor_id).slice(0, 8) : "system"}
                    {a.reason ? ` · ${a.reason}` : ""}{(a.meta || {}).source ? ` · via ${a.meta.source}` : ""}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
