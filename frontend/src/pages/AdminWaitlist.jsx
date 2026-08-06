/**
 * /admin/waitlist — FIG 7 queue · FIG 8 detail/decision · FIG 10 page
 * settings (draft/publish) · FIG 11 signup access mode. Reuses admin
 * shell, or-* design tokens and audit-backed waitlist APIs.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, ChevronUp, Crown, FileText, Loader2,
  Lock, MessageSquare, RefreshCw, ScrollText, Search, Send, Settings,
  ShieldCheck, StickyNote, Users, X,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import AdminBackButton from "@/components/AdminBackButton";

const gold = "#F4C84A";
const STATUS_COLOR = {
  email_verification_required: "#8B8B8B", waiting_review: "#FFD166",
  verification_requested: "#4DD2FF", documents_requested: "#FFA94D",
  under_review: "#4DD2FF", approved: "#00FF66", invite_sent: "#00FF66",
  on_hold: "#C084FC", denied: "#FF6B6B", withdrawn: "#8B8B8B",
  account_created: "#00FF66",
};

function Pill({ text, color }) {
  return <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
    style={{ color, background: `${color}1f`, border: `1px solid ${color}55` }}>{text}</span>;
}

function Detail({ resId, onChanged }) {
  const [data, setData] = useState(null);
  const [reason, setReason] = useState("");
  const [docItems, setDocItems] = useState("");
  const [docMsg, setDocMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [premium, setPremium] = useState(false);

  const load = useCallback(async () => {
    const { data: d } = await apiClient.get(`/waitlist/admin/reservations/${resId}`);
    setData(d);
  }, [resId]);
  useEffect(() => { load().catch(() => toast.error("Load failed")); }, [load]);

  if (!data) return <div className="py-4 flex justify-center"><Loader2 size={16} className="animate-spin" /></div>;
  const r = data.reservation;

  const act = async (action, payload = {}) => {
    try {
      await apiClient.post(`/waitlist/admin/reservations/${resId}/action`,
        { action, reason, payload });
      toast.success(`${action.replace(/_/g, " ")} done`);
      setReason(""); await load(); onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
  };

  return (
    <div className="mt-3 space-y-3 text-sm" data-testid={`waitlist-detail-${resId}`}>
      <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        {r.email} · reserved {String(r.created_at).slice(0, 10)} · queue #{r.queue_position ?? "—"}
        {r.assigned_to && <> · reviewer: {r.assigned_to}</>}
        {r.type === "premium_request" && <> · <Crown size={11} className="inline" style={{ color: gold }} /> premium request</>}
      </div>

      {r.verification && (
        <div className="p-2 rounded text-[12px]" style={{ border: "1px solid rgba(77,210,255,0.35)" }} data-testid="detail-verification">
          <b style={{ color: "#4DD2FF" }}>Verification — {r.verification.category} ({r.verification.status})</b>
          <div>Name: {r.verification.legal_name} {r.verification.website && <>· {r.verification.website}</>}</div>
          <div style={{ color: "var(--text-muted)" }}>{r.verification.explanation}</div>
          {(r.verification.links || []).map((l) => <div key={l} className="truncate">↗ {l}</div>)}
        </div>
      )}

      {(r.documents || []).length > 0 && (
        <div className="p-2 rounded text-[12px]" style={{ border: "1px solid rgba(255,169,77,0.35)" }} data-testid="detail-documents">
          <b style={{ color: "#FFA94D" }}>Documents {r.doc_request?.submitted_at ? "(submitted)" : "(pending)"}</b>
          {(r.documents || []).map((d) => (
            <div key={d.id}>
              <a className="underline" style={{ color: "var(--primary)" }} target="_blank" rel="noreferrer"
                href={`${apiClient.defaults.baseURL}/waitlist/admin/documents/${d.id}`}
                data-testid={`detail-doc-${d.id}`}>
                <FileText size={11} className="inline mr-1" />{d.name}
              </a> <span style={{ color: "var(--text-muted)" }}>({Math.round(d.size / 1024)} KB)</span>
            </div>
          ))}
        </div>
      )}

      <div className="p-2 rounded text-[12px] max-h-40 overflow-y-auto" style={{ border: "1px solid var(--border-col)" }} data-testid="detail-messages">
        <b><MessageSquare size={12} className="inline mr-1" />Conversation</b>
        {(r.messages || []).map((m) => (
          <div key={m.id}><b style={{ color: m.admin ? gold : "var(--primary)" }}>{m.from}</b>: {m.text}
            <span style={{ color: "var(--text-muted)" }}> · {String(m.at).slice(5, 16).replace("T", " ")}</span></div>
        ))}
        <div className="flex gap-1 mt-1">
          <input className="or-input flex-1" placeholder="Message the reservation holder…" value={msg}
            onChange={(e) => setMsg(e.target.value)} data-testid="detail-message-input" />
          <button type="button" className="or-chip" disabled={!msg.trim()}
            onClick={() => { act("message", { text: msg }); setMsg(""); }} data-testid="detail-message-send"><Send size={12} /></button>
        </div>
      </div>

      <div className="p-2 rounded text-[12px]" style={{ border: "1px solid rgba(192,132,252,0.3)" }} data-testid="detail-notes">
        <b style={{ color: "#C084FC" }}><StickyNote size={12} className="inline mr-1" />Admin notes (never shown to user)</b>
        {(r.admin_notes || []).map((n, i) => (
          <div key={i}>{n.by}: {n.text} <span style={{ color: "var(--text-muted)" }}>· {String(n.at).slice(5, 16).replace("T", " ")}</span></div>
        ))}
        <div className="flex gap-1 mt-1">
          <input className="or-input flex-1" placeholder="Private note…" value={note}
            onChange={(e) => setNote(e.target.value)} data-testid="detail-note-input" />
          <button type="button" className="or-chip" disabled={!note.trim()}
            onClick={() => { act("note", { text: note }); setNote(""); }} data-testid="detail-note-add"><Check size={12} /></button>
        </div>
      </div>

      <details className="text-[11px]" data-testid="detail-audit">
        <summary style={{ color: "var(--text-muted)", cursor: "pointer" }}>Audit history ({data.audit.length})</summary>
        {data.audit.map((a) => (
          <div key={a.id} style={{ color: "var(--text-muted)" }}>• {String(a.at).slice(0, 16).replace("T", " ")} — {a.action} {a.reason ? `(${a.reason})` : ""}</div>
        ))}
      </details>

      {!["account_created", "withdrawn"].includes(r.status) && (
        <div className="space-y-2" data-testid="detail-actions">
          <input className="or-input" placeholder="Reason (required for deny / hold / release)" value={reason}
            onChange={(e) => setReason(e.target.value)} data-testid="detail-reason" />
          <div className="flex flex-wrap gap-1.5">
            <label className="flex items-center gap-1 text-[11px] mr-1">
              <input type="checkbox" checked={premium} onChange={(e) => setPremium(e.target.checked)} data-testid="detail-approve-premium" />
              unlock premium
            </label>
            <button type="button" className="or-btn text-xs" style={{ background: "#00A550", color: "#fff" }}
              onClick={() => act("approve_invite", { approve_premium: premium })} data-testid="detail-approve">
              <Check size={12} />&nbsp;Approve &amp; Send Invite
            </button>
            <button type="button" className="or-chip text-xs" onClick={() => {
              const items = docItems.split("\n").map((i) => i.trim()).filter(Boolean);
              if (!items.length) { toast.error("List the requested documents below first"); return; }
              act("request_documents", { items, message: docMsg });
            }} data-testid="detail-request-docs">Request Documents</button>
            <button type="button" className="or-chip text-xs" onClick={() => act("prioritize")} data-testid="detail-prioritize">Prioritize</button>
            <button type="button" className="or-chip text-xs" onClick={() => act("hold")} data-testid="detail-hold" style={{ color: "#C084FC" }}>Place on Hold</button>
            <button type="button" className="or-chip text-xs" onClick={() => act("deny")} data-testid="detail-deny" style={{ color: "#FF6B6B" }}>Deny Request</button>
            <button type="button" className="or-chip text-xs" onClick={() => act("release_username")} data-testid="detail-release" style={{ color: "#FF6B6B" }}>Release Username</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            <textarea className="or-input" rows={2} placeholder="Requested documents (one per line)" value={docItems}
              onChange={(e) => setDocItems(e.target.value)} data-testid="detail-doc-items" />
            <textarea className="or-input" rows={2} placeholder="Public message with the request" value={docMsg}
              onChange={(e) => setDocMsg(e.target.value)} data-testid="detail-doc-msg" />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const [s, setS] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await apiClient.get("/waitlist/admin/settings");
    setS(data); setDraft(data.settings.draft || { ...data.settings.published });
  };
  useEffect(() => { load().catch(() => {}); }, []);
  if (!s || !draft) return <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin" /></div>;

  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const save = async (publish = false) => {
    setBusy(true);
    try {
      await apiClient.put("/waitlist/admin/settings/draft", { draft });
      if (publish) await apiClient.post("/waitlist/admin/settings/publish");
      toast.success(publish ? "Published" : "Draft saved");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 max-w-2xl" data-testid="waitlist-settings-tab">
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Editing a draft never changes the live page until you Publish.
        {s.settings.draft && <b style={{ color: "#FFD166" }}> Unpublished draft in progress.</b>}
      </p>
      <input className="or-input" value={draft.headline} onChange={(e) => set("headline", e.target.value)} placeholder="Headline" data-testid="ws-headline" />
      <textarea className="or-input" rows={2} value={draft.supporting_text} onChange={(e) => set("supporting_text", e.target.value)} placeholder="Supporting text" data-testid="ws-subtext" />
      <input className="or-input" value={draft.background_url} onChange={(e) => set("background_url", e.target.value)} placeholder="Background media URL (optional)" data-testid="ws-bg" />
      <div className="grid sm:grid-cols-3 gap-1.5">
        <input className="or-input" value={draft.btn_search} onChange={(e) => set("btn_search", e.target.value)} placeholder="Search button" data-testid="ws-btn-search" />
        <input className="or-input" value={draft.btn_status} onChange={(e) => set("btn_status", e.target.value)} placeholder="Status button" data-testid="ws-btn-status" />
        <input className="or-input" value={draft.btn_signin} onChange={(e) => set("btn_signin", e.target.value)} placeholder="Sign-in button" data-testid="ws-btn-signin" />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!draft.show_queue_position} onChange={(e) => set("show_queue_position", e.target.checked)} data-testid="ws-queue-visible" /> Show queue position</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!draft.verification_enabled} onChange={(e) => set("verification_enabled", e.target.checked)} data-testid="ws-verification-enabled" /> Verification requests enabled</label>
      </div>
      <textarea className="or-input" rows={2} value={(draft.categories || []).join(", ")} onChange={(e) => set("categories", e.target.value.split(",").map((c) => c.trim()).filter(Boolean))} placeholder="Verification categories (comma-separated)" data-testid="ws-categories" />
      <div className="grid sm:grid-cols-3 gap-1.5">
        <input className="or-input" type="number" min={1} max={20} value={draft.doc_max_files} onChange={(e) => set("doc_max_files", parseInt(e.target.value || 6, 10))} title="Max document files" data-testid="ws-doc-max" />
        <input className="or-input" type="number" min={1} max={90} value={draft.doc_deadline_days} onChange={(e) => set("doc_deadline_days", parseInt(e.target.value || 14, 10))} title="Document deadline (days)" data-testid="ws-doc-deadline" />
        <input className="or-input" type="number" min={0} max={365} value={draft.reservation_expiry_days} onChange={(e) => set("reservation_expiry_days", parseInt(e.target.value || 0, 10))} title="Reservation expiry days (0 = never)" data-testid="ws-expiry" />
      </div>
      <textarea className="or-input" rows={2} value={draft.auto_message_received} onChange={(e) => set("auto_message_received", e.target.value)} placeholder="Auto-message after reservation" data-testid="ws-auto-msg" />
      <textarea className="or-input" rows={2} value={draft.premium_note} onChange={(e) => set("premium_note", e.target.value)} placeholder="Premium username note (no monetary language)" data-testid="ws-premium-note" />
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="or-btn text-xs" disabled={busy} onClick={() => save(false)} data-testid="ws-save-draft">Save Draft</button>
        <button type="button" className="or-btn text-xs" style={{ background: "#00A550", color: "#fff" }} disabled={busy} onClick={() => save(true)} data-testid="ws-publish">Publish</button>
        <a className="or-chip text-xs" href="/waitlist" target="_blank" rel="noreferrer" data-testid="ws-preview">Preview live page</a>
        <button type="button" className="or-chip text-xs" disabled={busy} onClick={async () => {
          await apiClient.post("/waitlist/admin/settings/reset"); toast.success("Draft discarded"); load();
        }} data-testid="ws-reset">Reset Draft</button>
      </div>
    </div>
  );
}

function ModeTab() {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("");
  const [reason, setReason] = useState("");
  const load = async () => {
    const { data: d } = await apiClient.get("/waitlist/admin/settings");
    setData(d); setMode(d.signup_mode.mode);
  };
  useEffect(() => { load().catch(() => {}); }, []);
  if (!data) return <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin" /></div>;

  const LABELS = {
    open: ["Open Registration", "Anyone can create an account."],
    waitlist: ["Waitlist Only", "New users must reserve a username and wait for approval."],
    invite_only: ["Invite or Approval Only", "Only approved invitations can register."],
    existing_only: ["Existing Users Only", "No new registrations; members keep full access."],
    maintenance: ["Maintenance Mode", "Registrations disabled during maintenance; members can still sign in."],
  };

  return (
    <div className="space-y-2 max-w-xl" data-testid="signup-mode-tab">
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Current: <b style={{ color: gold }}>{LABELS[data.signup_mode.mode][0]}</b>
        {data.signup_mode.reason && <> — {data.signup_mode.reason}</>}
        {data.signup_mode.changed_by && <> · set by {data.signup_mode.changed_by}</>}.
        Existing members always keep sign-in access. Enforced server-side and audited.
      </p>
      {data.modes.map((m) => (
        <label key={m} className="flex items-start gap-2 p-2 rounded cursor-pointer"
          style={{ border: `1px solid ${mode === m ? gold : "var(--border-col)"}` }} data-testid={`mode-${m}`}>
          <input type="radio" className="mt-1" checked={mode === m} onChange={() => setMode(m)} />
          <span className="text-sm"><b>{LABELS[m][0]}</b><br />
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{LABELS[m][1]}</span></span>
        </label>
      ))}
      <input className="or-input" placeholder="Reason (required for restricted modes)" value={reason}
        onChange={(e) => setReason(e.target.value)} data-testid="mode-reason" />
      <button type="button" className="or-btn text-xs" onClick={async () => {
        try {
          await apiClient.post("/waitlist/admin/signup-mode", { mode, reason });
          toast.success("Signup mode updated"); load();
        } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
      }} data-testid="mode-apply"><Lock size={12} />&nbsp;Apply Mode</button>
    </div>
  );
}

export default function AdminWaitlist() {
  const { user } = useAuth();
  const [tab, setTab] = useState("queue");
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(
        `/waitlist/admin/queue?${status ? `status=${status}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`);
      setRows(data.reservations); setTotals(data.totals);
    } catch (e) { /* 403 */ }
    finally { setLoading(false); }
  }, [q, status]);
  useEffect(() => { load(); }, [load]);

  if (!isAdmin(user)) return <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>Admin access required</div>;

  return (
    <div className="max-w-4xl mx-auto" data-testid="admin-waitlist-page">
      <AdminBackButton />
      <div className="flex items-center gap-2 mb-1">
        <Users size={20} style={{ color: gold }} />
        <h1 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Waitlist &amp; Reservations</h1>
      </div>

      <div className="flex gap-1 mb-4 flex-wrap">
        {[["queue", "Queue", Users], ["settings", "Page Settings", Settings], ["mode", "Signup Access", Lock]].map(([v, l, I]) => (
          <button key={v} type="button" className="or-chip text-xs" data-active={tab === v}
            onClick={() => setTab(v)} data-testid={`waitlist-tab-${v}`}
            style={tab === v ? { borderColor: gold, color: gold } : {}}>
            <I size={11} />&nbsp;{l}
          </button>
        ))}
        <button type="button" className="or-chip text-xs ml-auto" onClick={load} data-testid="waitlist-refresh"><RefreshCw size={12} /></button>
      </div>

      {tab === "queue" && (
        <>
          {totals && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3" data-testid="waitlist-totals">
              {[["Total", totals.total, gold], ["Pending", totals.pending, "#FFD166"],
                ["Docs requested", totals.documents_requested, "#FFA94D"],
                ["Approved", totals.approved, "#00FF66"], ["Denied", totals.denied, "#FF6B6B"],
                ["On hold", totals.on_hold, "#C084FC"]].map(([l, v, c]) => (
                <div key={l} className="or-surface p-2">
                  <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{l}</div>
                  <div className="text-lg" style={{ fontFamily: "var(--font-display)", color: c }}>{v}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-1 or-input flex-1" style={{ maxWidth: 260 }}>
              <Search size={12} style={{ color: "var(--text-muted)" }} />
              <input className="bg-transparent outline-none flex-1 text-sm" placeholder="Search username or email"
                value={q} onChange={(e) => setQ(e.target.value)} data-testid="waitlist-queue-search" />
            </div>
            <select className="or-input" style={{ maxWidth: 220 }} value={status}
              onChange={(e) => setStatus(e.target.value)} data-testid="waitlist-queue-status-filter">
              <option value="">All statuses</option>
              {Object.keys(STATUS_COLOR).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          {loading ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : (
            <ul className="space-y-2" data-testid="waitlist-queue-list">
              {rows.length === 0 && <li className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="waitlist-queue-empty">No reservations in this view.</li>}
              {rows.map((r) => (
                <li key={r.id} className="or-surface p-3" data-testid={`waitlist-row-${r.id}`}>
                  <div className="flex items-center gap-2 flex-wrap cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <span className="text-sm font-semibold">@{r.username}</span>
                    {r.type === "premium_request" && <Crown size={12} style={{ color: gold }} />}
                    <Pill text={r.status.replace(/_/g, " ")} color={STATUS_COLOR[r.status] || "#8B8B8B"} />
                    {r.priority && <Pill text="priority" color={gold} />}
                    {r.verification && <Pill text={r.verification.category} color="#4DD2FF" />}
                    <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
                      #{r.queue_position ?? "—"} · {String(r.created_at).slice(0, 10)}
                    </span>
                    {open === r.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                  {open === r.id && <Detail resId={r.id} onChanged={load} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "settings" && <SettingsTab />}
      {tab === "mode" && <ModeTab />}
    </div>
  );
}
