/**
 * Tiny modal shown when the user attempts a radius search without a ZIP
 * code on file. One CTA → Profile Settings, one Cancel. Returning to the
 * original page is automatic (the modal closes; the navigated page can
 * use react-router's back action).
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, X } from "lucide-react";

export default function ZipRequiredModal({ open, onClose, testid = "zip-required-modal" }) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center px-3 sm:px-4 py-4 sm:py-10"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid={`${testid}-overlay`}
    >
      <div
        className="or-surface w-full sm:max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 p-3 sm:p-4" style={{ borderBottom: "1px solid var(--border-col)" }}>
          <MapPin size={16} style={{ color: "var(--primary)" }} />
          <div className="font-semibold flex-1" style={{ color: "var(--text-main)" }}>ZIP code required</div>
          <button onClick={onClose} className="starbar-icon" style={{ width: 32, height: 32 }} aria-label="Close" data-testid={`${testid}-close`}>
            <X size={14} />
          </button>
        </div>
        <div className="p-4 sm:p-5 space-y-4">
          <p className="text-sm" style={{ color: "var(--text-main)" }}>
            Radius Search requires a ZIP code in your Profile Settings.
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            Your ZIP is stored privately and is never shown to other users — it only powers nearby content discovery.
          </p>
          <div className="flex gap-2">
            <button type="button" className="or-btn or-btn-ghost flex-1" onClick={onClose} data-testid={`${testid}-cancel`}>Not now</button>
            <button
              type="button"
              className="or-btn flex-1"
              onClick={() => { onClose?.(); navigate("/settings/account"); }}
              data-testid={`${testid}-go`}
            >
              Set ZIP code
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
