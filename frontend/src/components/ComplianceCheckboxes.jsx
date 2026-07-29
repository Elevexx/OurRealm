/**
 * ComplianceCheckboxes — THE signup legal-acceptance block (Terms of
 * Service, Terms & Conditions, Privacy Policy, 13+ COPPA). Shared by
 * email signup (SignUp.jsx) and Google new-user signup (AuthCallback.jsx).
 */
import React from "react";
import { Link } from "react-router-dom";

export const ComplianceCheckboxes = ({ values, onChange, idPrefix = "signup" }) => {
  const row = (key, testId, content) => (
    <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
      <input
        type="checkbox" checked={values[key]}
        onChange={(e) => onChange(key, e.target.checked)}
        data-testid={`${idPrefix}-${testId}`}
        style={{ marginTop: 2, accentColor: "var(--primary)" }}
      />
      <span>{content}</span>
    </label>
  );
  return (
    <div className="space-y-2 pt-1" data-testid={`${idPrefix}-compliance`}>
      {row("tos", "accept-tos", (
        <>I have read and agree to the {" "}
          <Link to="/terms" target="_blank" className="underline" style={{ color: "var(--primary)" }} data-testid={`${idPrefix}-link-terms`}>Terms of Service</Link>.</>
      ))}
      {row("conditions", "accept-conditions", (
        <>I have read and agree to OurRealm's {" "}
          <Link to="/terms-conditions" target="_blank" className="underline" style={{ color: "var(--primary)" }} data-testid={`${idPrefix}-link-conditions`}>Terms &amp; Conditions</Link>.</>
      ))}
      {row("privacy", "accept-privacy", (
        <>I have read and agree to the {" "}
          <Link to="/privacy" target="_blank" className="underline" style={{ color: "var(--primary)" }} data-testid={`${idPrefix}-link-privacy`}>Privacy Policy</Link>.</>
      ))}
      {row("age", "accept-age", (
        <>I confirm I am at least <b style={{ color: "var(--text-main)" }}>13 years old</b> (COPPA).</>
      ))}
    </div>
  );
};
