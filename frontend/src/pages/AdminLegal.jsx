/**
 * /admin/legal — Founder-only Legal Center.
 * Draft/publish/archive lifecycle, immutable versions, rollback-as-new-
 * version, draft-vs-published compare, desktop/mobile preview, ORAi
 * section patches (before/after, explicit Apply), user notices.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Archive, Check, ChevronDown, Eye, FileText, History, Loader2,
  Plus, RotateCcw, Save, ScrollText, Sparkles, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import AdminBackButton from "@/components/AdminBackButton";
import { renderMarkdown } from "@/pages/LegalCenter";

const STATUS_COLOR = { published: "#00FF66", draft: "#FFD166", archived: "#8B8B8B" };

function Pill({ text, color }) {
  return (
    <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}55` }}>{text}</span>
  );
}

function OraiPanel({ docKey, sections, onApplied }) {
  const [section, setSection] = useState(sections[0] || "");
  const [instruction, setInstruction] = useState("");
  const [patch, setPatch] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSection(sections[0] || ""); }, [sections]);

  const generate = async () => {
    setBusy(true); setPatch(null);
    try {
      const { data } = await apiClient.post(`/admin/legal/documents/${docKey}/orai-patch`,
        { section, instruction });
      setPatch(data.patch);
    } catch (e) { toast.error(e?.response?.data?.detail || "ORAi patch failed"); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    try {
      await apiClient.post(`/admin/legal/patches/${patch.id}/apply`);
      toast.success("Patch applied to draft — remember to Publish separately");
      setPatch(null); setInstruction(""); onApplied();
    } catch (e) { toast.error(e?.response?.data?.detail || "Apply failed"); }
  };

  return (
    <div className="p-3 rounded space-y-2" style={{ border: "1px solid rgba(192,132,252,0.35)" }} data-testid="orai-legal-panel">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles size={14} style={{ color: "#C084FC" }} /> ORAi Section Edit
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>edits only the selected section · never auto-publishes</span>
      </div>
      <select className="or-input" value={section} onChange={(e) => setSection(e.target.value)} data-testid="orai-section-select">
        {sections.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <textarea className="or-input" rows={2} value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Instruction, e.g. 'Clarify that exports expire after 48 hours'"
        data-testid="orai-instruction" />
      <button type="button" className="or-btn text-xs" disabled={busy || instruction.trim().length < 5 || !section}
        onClick={generate} data-testid="orai-generate">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}&nbsp;Generate minimal change
      </button>
      {patch && (
        <div className="space-y-2" data-testid="orai-patch-result">
          <Pill text="Founder Draft (AI-assisted)" color="#C084FC" />
          <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded" style={{ border: "1px solid var(--border-col)" }}>
              <div className="uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Before</div>
              <pre className="whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>{patch.original}</pre>
            </div>
            <div className="p-2 rounded" style={{ border: "1px solid rgba(0,255,102,0.35)" }}>
              <div className="uppercase tracking-widest mb-1" style={{ color: "#00FF66" }}>After (proposed)</div>
              <pre className="whitespace-pre-wrap" style={{ color: "var(--text-main)" }}>{patch.proposed}</pre>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="or-btn text-xs" onClick={apply} data-testid="orai-apply">
              <Check size={13} />&nbsp;Apply to Draft
            </button>
            <button type="button" className="or-chip text-xs" onClick={() => setPatch(null)} data-testid="orai-discard">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Editor({ docKey, onBack }) {
  const [doc, setDoc] = useState(null);
  const [sections, setSections] = useState([]);
  const [versions, setVersions] = useState([]);
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState("edit"); // edit | preview | compare | history
  const [previewMode, setPreviewMode] = useState("desktop");
  const [busy, setBusy] = useState(false);
  const [pubOpen, setPubOpen] = useState(false);
  const [pub, setPub] = useState({ password: "", change_summary: "", effective_date: "", notice: "none", notice_message: "" });
  const [rbPwd, setRbPwd] = useState("");

  const load = useCallback(async () => {
    const { data } = await apiClient.get(`/admin/legal/documents/${docKey}`);
    setDoc(data.document); setSections(data.sections); setVersions(data.versions);
    setBody(data.document.draft_body ?? data.document.published_body ?? "");
    setDirty(false);
  }, [docKey]);
  useEffect(() => { load().catch(() => toast.error("Load failed")); }, [load]);

  if (!doc) return <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div>;

  const saveDraft = async () => {
    setBusy(true);
    try {
      await apiClient.put(`/admin/legal/documents/${docKey}/draft`, { body });
      toast.success("Draft saved"); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  const cancelDraft = async () => {
    try { await apiClient.post(`/admin/legal/documents/${docKey}/cancel-draft`); toast.success("Draft discarded"); await load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const publish = async () => {
    setBusy(true);
    try {
      if (dirty) await apiClient.put(`/admin/legal/documents/${docKey}/draft`, { body });
      await apiClient.post(`/admin/legal/documents/${docKey}/publish`, {
        password: pub.password, change_summary: pub.change_summary,
        effective_date: pub.effective_date || null,
      });
      if (pub.notice !== "none") {
        await apiClient.post("/admin/legal/notices", {
          password: pub.password, doc_keys: [docKey],
          mode: pub.notice, message: pub.notice_message,
        });
      }
      toast.success("Published");
      setPubOpen(false); setPub({ password: "", change_summary: "", effective_date: "", notice: "none", notice_message: "" });
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Publish failed"); }
    finally { setBusy(false); }
  };

  const rollback = async (version) => {
    if (!rbPwd) { toast.error("Founder password required for rollback"); return; }
    try {
      await apiClient.post(`/admin/legal/documents/${docKey}/rollback`, { password: rbPwd, version });
      toast.success(`Version ${version} republished as a new version`); setRbPwd(""); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Rollback failed"); }
  };

  return (
    <div className="space-y-3" data-testid={`legal-editor-${docKey}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="or-chip text-xs" onClick={onBack} data-testid="legal-editor-back">← Documents</button>
        <h2 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>{doc.title}</h2>
        <Pill text={doc.status} color={STATUS_COLOR[doc.status] || "#8B8B8B"} />
        {doc.published_version > 0 && <Pill text={`v${doc.published_version}`} color="#4DD2FF" />}
        {doc.draft_body != null && <Pill text="unsaved draft exists" color="#FFD166" />}
        {doc.slug && doc.published_version > 0 && (
          <a href={`/legal/${doc.slug}`} target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: "var(--primary)" }} data-testid="legal-editor-public-link">/legal/{doc.slug}</a>
        )}
      </div>

      <div className="flex gap-1 flex-wrap">
        {[["edit", "Edit", FileText], ["preview", "Preview", Eye], ["compare", "Compare", FileText], ["history", `History (${versions.length})`, History]].map(([v, l, I]) => (
          <button key={v} type="button" className="or-chip text-xs" data-active={view === v}
            onClick={() => setView(v)} data-testid={`legal-view-${v}`}
            style={view === v ? { borderColor: "#4DD2FF", color: "#4DD2FF" } : {}}>
            <I size={11} />&nbsp;{l}
          </button>
        ))}
      </div>

      {view === "edit" && (
        <>
          <textarea className="or-input font-mono text-[12px]" rows={20} value={body}
            onChange={(e) => { setBody(e.target.value); setDirty(true); }}
            data-testid="legal-editor-body"
            placeholder="Markdown — '## Heading' starts a section, '- item' a list, [text](/url) a link, **bold**" />
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="or-btn text-xs" disabled={busy} onClick={saveDraft} data-testid="legal-save-draft">
              <Save size={13} />&nbsp;Save Draft
            </button>
            <button type="button" className="or-btn text-xs" style={{ background: "#00A550", color: "#fff" }}
              onClick={() => setPubOpen(true)} data-testid="legal-publish-open">
              <Check size={13} />&nbsp;Publish…
            </button>
            {doc.draft_body != null && (
              <button type="button" className="or-chip text-xs" onClick={cancelDraft} data-testid="legal-cancel-draft">
                <Trash2 size={11} />&nbsp;Cancel Draft
              </button>
            )}
            {doc.status !== "archived" && (
              <button type="button" className="or-chip text-xs" onClick={async () => {
                await apiClient.post(`/admin/legal/documents/${docKey}/archive`); toast.success("Archived"); await load();
              }} data-testid="legal-archive">
                <Archive size={11} />&nbsp;Archive
              </button>
            )}
          </div>
          <OraiPanel docKey={docKey} sections={sections} onApplied={load} />
        </>
      )}

      {view === "preview" && (
        <div>
          <div className="flex gap-1 mb-2">
            {["desktop", "mobile"].map((m) => (
              <button key={m} type="button" className="or-chip text-xs" data-active={previewMode === m}
                onClick={() => setPreviewMode(m)} data-testid={`legal-preview-${m}`}
                style={previewMode === m ? { borderColor: "#4DD2FF", color: "#4DD2FF" } : {}}>{m}</button>
            ))}
          </div>
          <div className="or-surface p-4 mx-auto space-y-2" data-testid="legal-preview-pane"
            style={{ maxWidth: previewMode === "mobile" ? 380 : "100%" }}>
            {renderMarkdown(body, "pv")}
          </div>
        </div>
      )}

      {view === "compare" && (
        <div className="grid sm:grid-cols-2 gap-2" data-testid="legal-compare-pane">
          <div className="or-surface p-3">
            <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "#00FF66" }}>Published (v{doc.published_version})</div>
            <pre className="whitespace-pre-wrap text-[11px]" style={{ color: "var(--text-muted)" }}>{doc.published_body || "— never published —"}</pre>
          </div>
          <div className="or-surface p-3">
            <div className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "#FFD166" }}>Draft</div>
            <pre className="whitespace-pre-wrap text-[11px]" style={{ color: "var(--text-main)" }}>{body || "— empty —"}</pre>
          </div>
        </div>
      )}

      {view === "history" && (
        <div className="space-y-2" data-testid="legal-history-pane">
          <div className="flex items-center gap-2">
            <input type="password" className="or-input" style={{ maxWidth: 220 }} placeholder="Founder password (for restore)"
              value={rbPwd} onChange={(e) => setRbPwd(e.target.value)} data-testid="legal-rollback-pwd" />
          </div>
          {versions.map((v) => (
            <div key={v.version} className="or-surface p-3 text-xs" data-testid={`legal-version-${v.version}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <Pill text={`v${v.version}`} color="#4DD2FF" />
                <span>{v.change_summary}</span>
                <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
                  effective {v.effective_date} · by {v.published_by} · {String(v.published_at).slice(0, 10)}
                </span>
                {v.version !== doc.published_version && (
                  <button type="button" className="or-chip text-[10px]" onClick={() => rollback(v.version)}
                    data-testid={`legal-restore-${v.version}`}>
                    <RotateCcw size={10} />&nbsp;Restore as new version
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {pubOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }}>
          <div className="or-surface w-full max-w-md p-5 space-y-2" data-testid="legal-publish-modal">
            <div className="flex items-center">
              <h3 className="flex-1 text-lg" style={{ fontFamily: "var(--font-display)" }}>Publish v{(doc.published_version || 0) + 1}</h3>
              <button type="button" className="or-chip" onClick={() => setPubOpen(false)} data-testid="legal-publish-close"><X size={12} /></button>
            </div>
            <input className="or-input" placeholder="Change summary (required)" value={pub.change_summary}
              onChange={(e) => setPub({ ...pub, change_summary: e.target.value })} data-testid="legal-publish-summary" />
            <input className="or-input" type="date" title="Effective date (defaults to today)" value={pub.effective_date}
              onChange={(e) => setPub({ ...pub, effective_date: e.target.value })} data-testid="legal-publish-effective" />
            <select className="or-input" value={pub.notice} onChange={(e) => setPub({ ...pub, notice: e.target.value })} data-testid="legal-publish-notice-mode">
              <option value="none">No user notice</option>
              <option value="one_time">One-time notice</option>
              <option value="ack_required">Acknowledgement required</option>
            </select>
            {pub.notice !== "none" && (
              <input className="or-input" placeholder="Notice message (optional)" value={pub.notice_message}
                onChange={(e) => setPub({ ...pub, notice_message: e.target.value })} data-testid="legal-publish-notice-msg" />
            )}
            <input className="or-input" type="password" placeholder="Founder password (reauthentication)" value={pub.password}
              onChange={(e) => setPub({ ...pub, password: e.target.value })} data-testid="legal-publish-password" />
            <button type="button" className="or-btn text-xs w-full" disabled={busy || !pub.password || pub.change_summary.trim().length < 3}
              onClick={publish} data-testid="legal-publish-confirm">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}&nbsp;Publish Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminLegal() {
  const { user } = useAuth();
  const isFounder = (user?.admin_role === "founder") || (user?.username || "").toLowerCase() === "stealth";
  const [docs, setDocs] = useState(null);
  const [active, setActive] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState({ title: "", slug: "" });

  const load = async () => {
    try { const { data } = await apiClient.get("/admin/legal/documents"); setDocs(data.documents); }
    catch (e) { setDocs([]); }
  };
  useEffect(() => { if (isFounder) load(); }, [isFounder]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isFounder) {
    return <div className="text-center py-8" style={{ color: "var(--text-muted)" }} data-testid="legal-denied">Founder access required</div>;
  }

  return (
    <div className="max-w-4xl mx-auto" data-testid="admin-legal-page">
      <AdminBackButton />
      <div className="flex items-center gap-2 mb-1">
        <ScrollText size={20} style={{ color: "#4DD2FF" }} />
        <h1 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Legal Center</h1>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Drafts never auto-publish. Publishing, rollback and user notices require your password.
        Version history is immutable.
      </p>

      {active ? (
        <Editor docKey={active} onBack={() => { setActive(null); load(); }} />
      ) : docs === null ? (
        <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div>
      ) : (
        <>
          <button type="button" className="or-chip text-xs mb-3" onClick={() => setNewOpen((v) => !v)} data-testid="legal-new-toggle">
            <Plus size={12} />&nbsp;New custom page
          </button>
          {newOpen && (
            <div className="or-surface p-3 mb-3 flex gap-2 flex-wrap" data-testid="legal-new-form">
              <input className="or-input" style={{ maxWidth: 220 }} placeholder="Title" value={nf.title}
                onChange={(e) => setNf({ ...nf, title: e.target.value })} data-testid="legal-new-title" />
              <input className="or-input" style={{ maxWidth: 180 }} placeholder="slug (url)" value={nf.slug}
                onChange={(e) => setNf({ ...nf, slug: e.target.value })} data-testid="legal-new-slug" />
              <button type="button" className="or-btn text-xs" disabled={!nf.title || !nf.slug} onClick={async () => {
                try {
                  await apiClient.post("/admin/legal/documents", nf);
                  toast.success("Created"); setNewOpen(false); setNf({ title: "", slug: "" }); load();
                } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); }
              }} data-testid="legal-new-create">Create</button>
            </div>
          )}
          <ul className="space-y-2" data-testid="legal-doc-list">
            {docs.map((d) => (
              <li key={d.key}>
                <button type="button" className="or-surface w-full p-3 text-left flex items-center gap-2 flex-wrap"
                  onClick={() => setActive(d.key)} data-testid={`legal-doc-row-${d.key}`}>
                  <FileText size={14} style={{ color: "var(--text-muted)" }} />
                  <span className="text-sm font-semibold">{d.title}</span>
                  <Pill text={d.status} color={STATUS_COLOR[d.status] || "#8B8B8B"} />
                  {d.published_version > 0 && <Pill text={`v${d.published_version}`} color="#4DD2FF" />}
                  {d.draft_body != null && <Pill text="draft" color="#FFD166" />}
                  <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
                    {d.effective_date ? `effective ${d.effective_date}` : "never published"} · /legal/{d.slug}
                  </span>
                  <ChevronDown size={14} style={{ transform: "rotate(-90deg)" }} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
