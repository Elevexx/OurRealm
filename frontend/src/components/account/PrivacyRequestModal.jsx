/**
 * PrivacyRequestModal — formal data erasure request (admin-reviewed).
 * Submitting a request does NOT hide the account unless the requester
 * explicitly selects "Hide and disable my account immediately".
 */
import React, { useEffect, useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const JURISDICTIONS = [
  { key: "other", label: "Other / Not sure" },
  { key: "gdpr_eu", label: "EU (GDPR)" },
  { key: "gdpr_uk", label: "UK (UK GDPR)" },
  { key: "us_ca", label: "California (CCPA/CPRA)" },
];

export default function PrivacyRequestModal({ open, onClose, onSubmitted }) {
  const { user, logout } = useAuth();
  const [details, setDetails] = useState("");
  const [jurisdiction, setJurisdiction] = useState("other");
  const [hideAccount, setHideAccount] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!open) {
      setDetails(""); setJurisdiction("other"); setHideAccount(false);
      setPassword(""); setErr(""); setBusy(false); setDone(null);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post("/account/privacy-request", {
        password, details, jurisdiction, hide_account: hideAccount,
      });
      setDone(data.request);
      onSubmitted?.(data.request);
      if (hideAccount) await logout();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not submit request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.65)" }} onClick={onClose}
      data-testid="privacy-request-backdrop">
      <div className="or-surface w-full max-w-md p-5 my-8"
        style={{ border: "1px solid rgba(77,210,255,0.4)" }}
        onClick={(e) => e.stopPropagation()} data-testid="privacy-request-modal" role="dialog">
        <div className="flex items-center mb-3">
          <ShieldCheck size={18} style={{ color: "#4DD2FF", flexShrink: 0 }} />
          <h3 className="flex-1 text-lg ml-2" style={{ fontFamily: "var(--font-display)" }}>Request Data Erasure</h3>
          <button type="button" onClick={onClose} className="or-chip" data-testid="privacy-request-close" aria-label="Close"><X size={12} /></button>
        </div>

        {done ? (
          <div data-testid="privacy-request-done">
            <p className="text-sm mb-2">
              Your erasure request was received and is under review. We will
              respond by <strong>{(done.extended_due_at || done.response_due_at || "").slice(0, 10)}</strong>.
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              You can track or withdraw the request from Settings &gt; Account.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="or-btn" data-testid="privacy-request-done-btn">Done</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm mb-3" style={{ color: "var(--text-main)" }} data-testid="privacy-request-info">
              A formal request for permanent erasure of your personal data.
              Requests are reviewed by our team before any data is destroyed —
              you'll be notified of the decision within the legal response window.
            </p>

            <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>Details (optional)</label>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)}
              className="or-input mb-2" rows={3} maxLength={2000}
              placeholder="Anything we should know about your request"
              data-testid="privacy-request-details" />

            <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>Where do you live?</label>
            <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}
              className="or-input mb-3" data-testid="privacy-request-jurisdiction">
              {JURISDICTIONS.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
            </select>

            <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>While your request is reviewed</label>
            <div className="space-y-1 mb-3">
              <label className="flex items-start gap-2 text-sm cursor-pointer" data-testid="privacy-request-keep-active">
                <input type="radio" checked={!hideAccount} onChange={() => setHideAccount(false)} className="mt-1" />
                <span>Continue using my account during review</span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer" data-testid="privacy-request-hide-now">
                <input type="radio" checked={hideAccount} onChange={() => setHideAccount(true)} className="mt-1" />
                <span>Hide and disable my account immediately (you'll be signed out)</span>
              </label>
            </div>

            <label className="text-xs uppercase tracking-widest block mb-1" style={{ color: "var(--text-muted)" }}>Current password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="or-input mb-3" placeholder="Password" data-testid="privacy-request-password" />

            {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }} data-testid="privacy-request-error">{err}</div>}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="or-chip" data-testid="privacy-request-cancel">Cancel</button>
              <button type="button" onClick={submit} disabled={!password || busy} className="or-btn"
                style={{ background: "#0E7490", color: "#fff" }} data-testid="privacy-request-submit">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                &nbsp;Submit Request
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
