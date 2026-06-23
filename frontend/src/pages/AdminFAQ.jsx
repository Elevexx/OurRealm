/**
 * /admin/faq — Phase 8 helpdesk FAQ editor.
 *
 * Admin (@stealth, @support, role==='admin') only. Lists every FAQ entry
 * (published + drafts), supports inline create / edit / reorder /
 * publish-toggle / delete. Public read path is /api/faq.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  HelpCircle, Loader2, Plus, Edit3, Trash2, Check, X, EyeOff, Eye,
  ArrowUp, ArrowDown, ShieldCheck,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import AdminBackButton from "@/components/AdminBackButton";

function FAQRow({ item, items, onChanged, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState(item.question);
  const [a, setA] = useState(item.answer);
  const [busy, setBusy] = useState(false);

  const patch = async (payload) => {
    setBusy(true);
    try {
      await apiClient.patch(`/admin/faq/${item.id}`, payload);
      onChanged();
    } catch (e) {
      alert(e?.response?.data?.detail || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const swap = async (dir) => {
    const idx = items.findIndex((x) => x.id === item.id);
    const other = items[idx + dir];
    if (!other) return;
    await Promise.all([
      apiClient.patch(`/admin/faq/${item.id}`,  { order_index: other.order_index }),
      apiClient.patch(`/admin/faq/${other.id}`, { order_index: item.order_index }),
    ]);
    onChanged();
  };

  const del = async () => {
    if (!window.confirm("Delete this FAQ entry?")) return;
    setBusy(true);
    try {
      await apiClient.delete(`/admin/faq/${item.id}`);
      onDeleted();
    } catch (e) {
      alert(e?.response?.data?.detail || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="or-surface p-3" data-testid={`admin-faq-row-${item.id}`}>
      {editing ? (
        <div className="space-y-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={200}
            placeholder="Question"
            className="or-input w-full text-sm"
            data-testid={`admin-faq-question-input-${item.id}`}
          />
          <textarea
            value={a}
            onChange={(e) => setA(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Answer"
            className="or-input w-full text-sm"
            data-testid={`admin-faq-answer-input-${item.id}`}
          />
          <div className="flex gap-2 justify-end">
            <button
              className="or-btn or-btn-ghost"
              onClick={() => { setQ(item.question); setA(item.answer); setEditing(false); }}
              disabled={busy}
            >
              <X size={12} /> Cancel
            </button>
            <button
              className="or-btn"
              onClick={async () => { await patch({ question: q, answer: a }); setEditing(false); }}
              disabled={busy || !q.trim() || !a.trim()}
              data-testid={`admin-faq-save-${item.id}`}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>#{item.order_index}</span>
              {!item.is_published && (
                <span
                  className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded"
                  style={{ color: "#FFD166", background: "rgba(255,209,102,0.12)", border: "1px solid #FFD16655" }}
                  data-testid={`admin-faq-draft-${item.id}`}
                >Draft</span>
              )}
            </div>
            <div className="font-semibold text-sm" style={{ color: "var(--text-main)" }}>
              {item.question}
            </div>
            <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>
              {item.answer}
            </div>
          </div>

          <div className="flex flex-col gap-1 shrink-0">
            <div className="flex gap-1">
              <button
                className="starbar-icon" title="Move up"
                onClick={() => swap(-1)} disabled={busy}
                data-testid={`admin-faq-up-${item.id}`}
              ><ArrowUp size={12} /></button>
              <button
                className="starbar-icon" title="Move down"
                onClick={() => swap(1)} disabled={busy}
                data-testid={`admin-faq-down-${item.id}`}
              ><ArrowDown size={12} /></button>
            </div>
            <div className="flex gap-1">
              <button
                className="starbar-icon"
                onClick={() => patch({ is_published: !item.is_published })}
                disabled={busy}
                title={item.is_published ? "Hide (unpublish)" : "Publish"}
                data-testid={`admin-faq-publish-${item.id}`}
              >
                {item.is_published ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                className="starbar-icon"
                onClick={() => setEditing(true)}
                disabled={busy}
                title="Edit"
                data-testid={`admin-faq-edit-${item.id}`}
              ><Edit3 size={12} /></button>
              <button
                className="starbar-icon"
                style={{ color: "#FF8080" }}
                onClick={del}
                disabled={busy}
                title="Delete"
                data-testid={`admin-faq-delete-${item.id}`}
              ><Trash2 size={12} /></button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export default function AdminFAQ() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true); setErr("");
    apiClient.get("/admin/faq")
      .then((r) => setItems(r.data.items || []))
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (user && isAdmin(user)) load(); }, [user]);

  if (!user) return (
    <div className="or-surface p-6 max-w-md mx-auto" style={{ color: "var(--text-muted)" }}>
      Sign in required.
    </div>
  );
  if (!isAdmin(user)) return (
    <div className="or-surface p-6 max-w-md mx-auto" data-testid="admin-faq-forbidden">
      Admin access required.
    </div>
  );

  const createItem = async () => {
    setCreating(true);
    try {
      await apiClient.post("/admin/faq", { question: newQ.trim(), answer: newA.trim() });
      setNewQ(""); setNewA(""); setShowCreate(false);
      load();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto" data-testid="admin-faq-page">
      <AdminBackButton className="mb-3" />
      <header className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <ShieldCheck size={26} style={{ color: "#00FF66" }} />
          <div>
            <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Admin · FAQ</div>
            <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Help Center</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="or-btn or-btn-ghost"
            onClick={() => navigate("/admin/support")}
            data-testid="admin-faq-back-support"
            title="Open support tickets"
          >
            Support tickets
          </button>
          <button
            className="or-btn"
            onClick={() => setShowCreate((v) => !v)}
            data-testid="admin-faq-toggle-create"
          >
            <Plus size={14} /> New entry
          </button>
        </div>
      </header>

      {err && (
        <div className="or-surface p-4 mb-4 text-sm"
             style={{ color: "#ff8080", border: "1px solid rgba(255,80,80,0.4)" }}
             data-testid="admin-faq-error">
          {err}
        </div>
      )}

      {showCreate && (
        <section className="or-surface p-4 mb-4 space-y-2" data-testid="admin-faq-create-panel">
          <input
            value={newQ}
            onChange={(e) => setNewQ(e.target.value)}
            maxLength={200}
            placeholder="Question (e.g. How do I reset my password?)"
            className="or-input w-full"
            data-testid="admin-faq-new-question"
          />
          <textarea
            value={newA}
            onChange={(e) => setNewA(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Answer (markdown not yet supported — plain text)"
            className="or-input w-full"
            data-testid="admin-faq-new-answer"
          />
          <div className="flex justify-end gap-2">
            <button
              className="or-btn or-btn-ghost"
              onClick={() => { setShowCreate(false); setNewQ(""); setNewA(""); }}
              disabled={creating}
            ><X size={12} /> Cancel</button>
            <button
              className="or-btn"
              onClick={createItem}
              disabled={creating || !newQ.trim() || !newA.trim()}
              data-testid="admin-faq-create-submit"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Publish
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="admin-faq-empty">
          No FAQ entries yet. Click <b>New entry</b> to add the first one.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="admin-faq-list">
          {items.map((it) => (
            <FAQRow key={it.id} item={it} items={items} onChanged={load} onDeleted={load} />
          ))}
        </ul>
      )}
    </div>
  );
}
