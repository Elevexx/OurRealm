/**
 * /profile/support — user-facing helpdesk.
 *
 * Flow:
 *   1. User taps "Create Support Ticket" → optional subject → POST /api/tickets/ensure
 *   2. Ticket is created (status="Submitted") and we navigate to /messages
 *      with ?dm=support so the existing DMConversationOverlay opens.
 *   3. The user's tickets + statuses are listed below.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, HelpCircle, LifeBuoy, Loader2, MessageSquare, Plus, ShieldCheck } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import AdminUserControlWidget from "@/components/AdminUserControlWidget";
import AdminPasswordResetWidget from "@/components/AdminPasswordResetWidget";

const STATUS_COLORS = {
  Submitted:     { fg: "#FFD166", bg: "rgba(255,209,102,0.12)" },
  "In Progress": { fg: "#4DD2FF", bg: "rgba(77,210,255,0.12)" },
  Completed:     { fg: "#00FF66", bg: "rgba(0,255,102,0.12)" },
  Incomplete:    { fg: "#FF6B6B", bg: "rgba(255,107,107,0.12)" },
};

function StatusPill({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.Submitted;
  return (
    <span
      className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
      style={{ color: c.fg, background: c.bg, border: `1px solid ${c.fg}55` }}
      data-testid={`support-ticket-status-${status.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {status}
    </span>
  );
}

export default function Support() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [subject, setSubject] = useState("");
  const [creating, setCreating] = useState(false);
  const [faq, setFaq] = useState([]);
  const [openFaq, setOpenFaq] = useState(null);

  const load = () => {
    setLoading(true);
    apiClient.get("/tickets/me")
      .then((r) => setTickets(r.data.tickets || []))
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load tickets"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (user) load(); }, [user]);

  // FAQ is a public read — no auth required, no need to block on user.
  useEffect(() => {
    apiClient.get("/faq").then((r) => setFaq(r.data.items || [])).catch(() => {});
  }, []);

  const onCreate = async () => {
    setCreating(true); setErr("");
    try {
      await apiClient.post("/tickets/ensure", { subject: subject.trim() || null });
      setSubject("");
      navigate("/messages?dm=support");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not create ticket");
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    return (
      <div className="or-surface p-6 max-w-md mx-auto" style={{ color: "var(--text-muted)" }}>
        Sign in to open a support ticket.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto" data-testid="support-page">
      <header className="mb-5 flex items-center gap-3">
        <LifeBuoy size={26} style={{ color: "var(--primary)" }} />
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>
            OurRealm · Support
          </div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
            Need a hand?
          </h1>
        </div>
        {isAdmin(user) && (
          <button
            onClick={() => navigate("/admin/support")}
            className="or-btn or-btn-ghost ml-auto"
            data-testid="support-admin-link"
            title="Open admin support dashboard"
          >
            <ShieldCheck size={14} /> Admin
          </button>
        )}
      </header>

      {/* Admin-only widgets — rendered at the very top so admins can act
          on issues before scrolling through their own ticket list. The
          components return null when the viewer is not an admin. */}
      <AdminUserControlWidget />
      <AdminPasswordResetWidget />

      {faq.length > 0 && (
        <section className="or-surface p-4 mb-5" data-testid="support-faq">
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle size={16} style={{ color: "var(--primary)" }} />
            <h2 className="text-base" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
              Frequently asked
            </h2>
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border-col)" }}>
            {faq.map((it) => {
              const isOpen = openFaq === it.id;
              return (
                <li key={it.id} data-testid={`support-faq-item-${it.id}`}>
                  <button
                    className="w-full flex items-center gap-2 py-2 text-left"
                    onClick={() => setOpenFaq(isOpen ? null : it.id)}
                    data-testid={`support-faq-toggle-${it.id}`}
                    aria-expanded={isOpen}
                  >
                    <span className="flex-1 text-sm font-medium" style={{ color: "var(--text-main)" }}>
                      {it.question}
                    </span>
                    {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {isOpen && (
                    <div
                      className="text-xs whitespace-pre-wrap pb-3"
                      style={{ color: "var(--text-muted)" }}
                      data-testid={`support-faq-answer-${it.id}`}
                    >
                      {it.answer}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="or-surface p-4 mb-5">
        <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
          Tap below to start a private DM with <b style={{ color: "var(--text-main)" }}>@support</b>.
          A ticket is opened automatically and we'll reply in the same thread.
        </p>
        <label className="block text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
          Subject (optional)
        </label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={100}
          placeholder="e.g. Can't upload my profile picture"
          className="or-input w-full mb-3"
          data-testid="support-subject-input"
        />
        <button
          className="or-btn w-full sm:w-auto"
          onClick={onCreate}
          disabled={creating}
          data-testid="support-create-ticket"
        >
          {creating
            ? (<><Loader2 size={14} className="animate-spin" /> Opening…</>)
            : (<><Plus size={14} /> Create Support Ticket</>)}
        </button>
        {err && (
          <div className="text-xs mt-2" style={{ color: "#FF6B6B" }} data-testid="support-error">
            {err}
          </div>
        )}
      </section>

      <section data-testid="support-ticket-list">
        <h2 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          Your tickets
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-8" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="or-surface p-4 text-sm" style={{ color: "var(--text-muted)" }} data-testid="support-empty">
            No tickets yet. Create one above and we'll reach out in your DMs.
          </div>
        ) : (
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li
                key={t.id}
                className="or-surface p-3 flex items-start gap-3"
                data-testid={`support-ticket-row-${t.ticket_number}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      #{t.ticket_number}
                    </span>
                    <span className="font-semibold text-sm truncate" style={{ color: "var(--text-main)" }}>
                      {t.subject}
                    </span>
                    <StatusPill status={t.status} />
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                    Updated {new Date(t.updated_at).toLocaleString()}
                  </div>
                </div>
                <button
                  className="or-btn or-btn-ghost"
                  style={{ padding: "0.35rem 0.6rem", fontSize: "0.7rem" }}
                  onClick={() => navigate("/messages?dm=support")}
                  data-testid={`support-ticket-open-${t.ticket_number}`}
                  title="Open chat with @support"
                >
                  <MessageSquare size={12} /> Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
