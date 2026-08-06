/**
 * LegalNoticeGate — shows pending legal notices (one-time or
 * acknowledgement-required) once per user (server-side dedupe across
 * devices). Mounted inside the authenticated shell.
 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ScrollText } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

export default function LegalNoticeGate() {
  const { user } = useAuth();
  const [notices, setNotices] = useState([]);

  useEffect(() => {
    if (!user) return;
    apiClient.get("/legal/notices/pending")
      .then(({ data }) => setNotices(data.notices || []))
      .catch(() => {});
  }, [user]);

  if (!notices.length) return null;
  const n = notices[0];

  const ack = async () => {
    try { await apiClient.post(`/legal/notices/${n.id}/acknowledge`); } catch (e) { /* best-effort */ }
    setNotices((prev) => prev.slice(1));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }} data-testid="legal-notice-modal">
      <div className="or-surface w-full max-w-md p-5" style={{ border: "1px solid rgba(77,210,255,0.4)" }}>
        <div className="flex items-center gap-2 mb-2">
          <ScrollText size={18} style={{ color: "#4DD2FF" }} />
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Policy Update</h3>
        </div>
        {n.message && <p className="text-sm mb-2">{n.message}</p>}
        <ul className="text-sm mb-3 space-y-1">
          {n.docs.map((d) => (
            <li key={d.key}>
              <Link to={`/legal/${d.slug}`} className="underline" style={{ color: "var(--primary)" }}
                data-testid={`legal-notice-link-${d.key}`}>
                {d.title} (v{d.version})
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" className="or-btn" onClick={ack} data-testid="legal-notice-ack">
            {n.mode === "ack_required" ? "I Acknowledge" : "Got It"}
          </button>
        </div>
      </div>
    </div>
  );
}
