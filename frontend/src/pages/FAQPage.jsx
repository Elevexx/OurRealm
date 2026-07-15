/**
 * /faq — public FAQ page. Renders published entries from GET /api/faq
 * (managed by the founder via /admin/faq).
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, HelpCircle, LifeBuoy, Loader2 } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";

export default function FAQPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    apiClient.get("/faq")
      .then((r) => setItems(r.data.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = q.trim()
    ? items.filter((i) => `${i.question} ${i.answer}`.toLowerCase().includes(q.trim().toLowerCase()))
    : items;

  return (
    <div className="max-w-3xl mx-auto" data-testid="faq-page">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Help Center</div>
        <h1 className="text-3xl sm:text-4xl flex items-center gap-3" style={{ fontFamily: "var(--font-display)" }}>
          <HelpCircle size={30} style={{ color: "var(--primary)" }} /> Frequently Asked Questions
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Answers to the most common questions about OurRealm.
        </p>
      </div>

      <input
        className="or-input mb-4"
        placeholder="Search FAQs…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="faq-search-input"
      />

      {loading ? (
        <div className="or-surface p-8 flex items-center justify-center" data-testid="faq-loading">
          <Loader2 size={20} className="animate-spin" style={{ color: "var(--primary)" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="faq-empty">
          {q ? "No FAQs match your search." : "No FAQs published yet — check back soon."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const open = openId === item.id;
            return (
              <div key={item.id} className="or-surface overflow-hidden" data-testid={`faq-item-${item.id}`}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 p-4 text-left"
                  onClick={() => setOpenId(open ? null : item.id)}
                  data-testid={`faq-question-${item.id}`}
                >
                  <span className="flex-1 font-semibold text-sm" style={{ color: "var(--text-main)" }}>{item.question}</span>
                  {open ? <ChevronUp size={16} style={{ color: "var(--primary)" }} /> : <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />}
                </button>
                {open && (
                  <div className="px-4 pb-4 text-sm leading-relaxed" style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }} data-testid={`faq-answer-${item.id}`}>
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="or-surface p-5 mt-6 flex items-center gap-4 flex-wrap" data-testid="faq-footer-cta">
        <div className="flex-1 min-w-[200px]">
          <div className="font-semibold text-sm" style={{ color: "var(--text-main)" }}>Still need help?</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>Open a support ticket and our team will get back to you.</div>
        </div>
        <button className="or-btn" onClick={() => navigate("/profile/support")} data-testid="faq-open-support">
          <LifeBuoy size={14} /> Contact Support
        </button>
        {isAdmin(user) && (
          <button className="or-btn or-btn-ghost" onClick={() => navigate("/admin/faq")} data-testid="faq-manage-link">
            Manage FAQs
          </button>
        )}
      </div>
    </div>
  );
}
