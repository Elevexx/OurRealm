/**
 * /waitlist — public username reservation & waitlist experience.
 * FIG 1 landing · FIG 2 search states · FIG 3 reserve step flow ·
 * FIG 4 status · FIG 5 verification request · FIG 6 documents ·
 * FIG 9 premium locked. Reuses existing design tokens + apiClient.
 */
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Check, CheckCircle2, Clock, Crown, FileUp, Loader2, Lock,
  Mail, MessageSquare, Search, Send, ShieldCheck, Trash2, User, X,
} from "lucide-react";
import apiClient from "@/api/client";
import Logo from "@/components/Logo";

const STATUS_LABEL = {
  email_verification_required: "Email Verification Required",
  waiting_review: "Waiting for Review",
  verification_requested: "Verification Requested",
  documents_requested: "Documents Requested",
  under_review: "Under Review",
  approved: "Approved",
  invite_sent: "Invite Sent — check your email",
  on_hold: "On Hold",
  denied: "Denied",
  withdrawn: "Withdrawn",
};
const STATUS_COLOR = {
  waiting_review: "#FFD166", verification_requested: "#4DD2FF",
  documents_requested: "#FFA94D", under_review: "#4DD2FF",
  approved: "#00FF66", invite_sent: "#00FF66", on_hold: "#C084FC",
  denied: "#FF6B6B", withdrawn: "#8B8B8B",
};

const gold = "#F4C84A";

function Panel({ children, testid, style }) {
  return (
    <div className="or-surface p-5 sm:p-6 w-full max-w-lg mx-auto" data-testid={testid}
      style={{ border: `1px solid ${gold}44`, ...style }}>
      {children}
    </div>
  );
}

export default function Waitlist() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [cfg, setCfg] = useState(null);
  const [view, setView] = useState(params.get("view") || "landing");
  // search
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  // reserve flow
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [terms, setTerms] = useState({ accepted_terms: false, accepted_conditions: false, accepted_privacy: false, age_confirmed_13: false });
  const [premiumReq, setPremiumReq] = useState(false);
  const [confirmOut, setConfirmOut] = useState(null);
  // status
  const [statusEmail, setStatusEmail] = useState("");
  const [statusCode, setStatusCode] = useState("");
  const [statusCodeSent, setStatusCodeSent] = useState(false);
  const [token, setToken] = useState(sessionStorage.getItem("wl_token") || "");
  const [reservation, setReservation] = useState(null);
  // verification form
  const [ver, setVer] = useState({ category: "", legal_name: "", website: "", explanation: "", links: "", accurate: false });
  // messaging
  const [msgText, setMsgText] = useState("");
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiClient.get("/waitlist/public/config").then(({ data }) => setCfg(data)).catch(() => setCfg({ page: {}, signup_mode: "open" }));
  }, []);

  useEffect(() => {
    if (token && view === "status" && !reservation) {
      apiClient.post("/waitlist/public/me", { status_token: token })
        .then(({ data }) => setReservation(data.reservation))
        .catch(() => { setToken(""); sessionStorage.removeItem("wl_token"); });
    }
  }, [token, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const page = cfg?.page || {};
  const allTerms = Object.values(terms).every(Boolean);

  const refreshStatus = async (t = token) => {
    const { data } = await apiClient.post("/waitlist/public/me", { status_token: t });
    setReservation(data.reservation);
  };

  const doSearch = async (u) => {
    const uu = (u ?? query).trim().toLowerCase();
    if (uu.length < 3) return;
    setChecking(true); setErr("");
    try {
      const { data } = await apiClient.get(`/waitlist/public/username-check?u=${encodeURIComponent(uu)}`);
      setResult(data); setView("search");
    } catch (e) { setErr("Search failed — try again"); }
    finally { setChecking(false); }
  };

  const startReserve = async () => {
    setBusy(true); setErr("");
    try {
      await apiClient.post("/waitlist/public/reserve/start", {
        username: result.username, email, premium_request: premiumReq });
      setStep(3);
    } catch (e) { setErr(e?.response?.data?.detail || "Could not start reservation"); }
    finally { setBusy(false); }
  };

  const confirmReserve = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post("/waitlist/public/reserve/confirm", { email, code, ...terms });
      setConfirmOut(data);
      setToken(data.status_token);
      sessionStorage.setItem("wl_token", data.status_token);
      setStep(5);
    } catch (e) { setErr(e?.response?.data?.detail || "Verification failed"); }
    finally { setBusy(false); }
  };

  const statusLogin = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post("/waitlist/public/status", { email: statusEmail, code: statusCode });
      setToken(data.status_token);
      sessionStorage.setItem("wl_token", data.status_token);
      setReservation(data.reservation);
    } catch (e) { setErr(e?.response?.data?.detail || "Could not load status"); }
    finally { setBusy(false); }
  };

  const submitVerification = async () => {
    setBusy(true); setErr("");
    try {
      await apiClient.post("/waitlist/public/verification-request", {
        status_token: token, category: ver.category, legal_name: ver.legal_name,
        website: ver.website, explanation: ver.explanation,
        links: ver.links.split("\n").map((l) => l.trim()).filter(Boolean), accurate: ver.accurate });
      await refreshStatus(); setView("status");
    } catch (e) { setErr(e?.response?.data?.detail || "Could not submit"); }
    finally { setBusy(false); }
  };

  const uploadDoc = async (file) => {
    setBusy(true); setErr("");
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej;
        r.readAsDataURL(file);
      });
      await apiClient.post("/waitlist/public/documents/upload", {
        status_token: token, name: file.name, mime: file.type, data_base64: b64 });
      await refreshStatus();
    } catch (e) { setErr(e?.response?.data?.detail || "Upload failed"); }
    finally { setBusy(false); }
  };

  if (!cfg) return <div className="min-h-screen flex items-center justify-center"><Loader2 size={22} className="animate-spin" /></div>;

  const bg = page.background_url
    ? { backgroundImage: `linear-gradient(rgba(6,10,18,0.82), rgba(6,10,18,0.94)), url(${page.background_url})`, backgroundSize: "cover", backgroundPosition: "center" }
    : {};

  return (
    <div className="min-h-screen px-4 py-10 flex flex-col items-center" style={bg} data-testid="waitlist-page">
      <div className="flex items-center gap-3 mb-6 cursor-pointer" onClick={() => { setView("landing"); setResult(null); setStep(1); }}>
        <Logo size={44} />
        <span className="text-[10px] uppercase tracking-[0.3em]" style={{ color: gold }}>OurRealm · Waitlist</span>
      </div>

      {/* FIG 1 — landing */}
      {view === "landing" && (
        <Panel testid="waitlist-landing">
          <h1 className="text-3xl sm:text-4xl text-center mb-2" style={{ fontFamily: "var(--font-display)", color: gold }}
            data-testid="waitlist-headline">{page.headline}</h1>
          <p className="text-sm text-center mb-5" style={{ color: "var(--text-muted)" }} data-testid="waitlist-subtext">{page.supporting_text}</p>
          <div className="or-input flex-1 gap-2 mb-3 waitlist-search-row">
            <input className="or-input flex-1" placeholder="Search a username…" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              data-testid="waitlist-search-input" />
            <button type="button" className="or-btn" style={{ background: gold, color: "#141414" }}
              onClick={() => doSearch()} disabled={checking || query.trim().length < 3} data-testid="waitlist-search-btn">
              {checking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}&nbsp;{page.btn_search || "Search Username"}
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <button type="button" className="or-btn or-btn-ghost flex-1" onClick={() => setView("status")} data-testid="waitlist-status-btn">
              <Clock size={14} />&nbsp;{page.btn_status || "Check My Status"}
            </button>
            <button type="button" className="or-btn or-btn-ghost flex-1" onClick={() => navigate("/signin")} data-testid="waitlist-signin-btn">
              <User size={14} />&nbsp;{page.btn_signin || "Existing Member Sign In"}
            </button>
          </div>
          <p className="text-[11px] text-center" style={{ color: "var(--text-muted)" }} data-testid="waitlist-fire-disclaimer">
            No purchase or payment is required to join. Fire Power has no monetary value and
            cannot be exchanged for money or goods.
          </p>
        </Panel>
      )}

      {/* FIG 2 / FIG 9 — search result states */}
      {view === "search" && result && (
        <Panel testid={`waitlist-result-${result.state}`}>
          <div className="text-center mb-4">
            <div className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)" }}>@{result.username}</div>
            {result.state === "available" && <span className="text-sm" style={{ color: "#00FF66" }}><CheckCircle2 size={14} className="inline mr-1" />{result.message}</span>}
            {result.state === "reserved" && <span className="text-sm" style={{ color: "#FFA94D" }}><Clock size={14} className="inline mr-1" />{result.message}</span>}
            {result.state === "in_use" && <span className="text-sm" style={{ color: "#FF6B6B" }}><X size={14} className="inline mr-1" />{result.message}</span>}
            {result.state === "invalid" && <span className="text-sm" style={{ color: "#FF6B6B" }}><AlertTriangle size={14} className="inline mr-1" />{result.message}</span>}
            {result.state === "premium_locked" && <span className="text-sm" style={{ color: gold }}><Crown size={14} className="inline mr-1" />Premium Username Locked</span>}
          </div>

          {result.state === "available" && (
            <button type="button" className="or-btn w-full" style={{ background: gold, color: "#141414" }}
              onClick={() => { setPremiumReq(false); setStep(2); setView("reserve"); }} data-testid="waitlist-reserve-btn">
              <ShieldCheck size={14} />&nbsp;Reserve Username
            </button>
          )}

          {result.state === "premium_locked" && (
            <div className="space-y-2" data-testid="waitlist-premium-panel">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                {result.message} {page.premium_note}
              </p>
              <button type="button" className="or-btn w-full" style={{ background: gold, color: "#141414" }}
                onClick={() => { setPremiumReq(true); setStep(2); setView("reserve"); }} data-testid="waitlist-premium-request-btn">
                <Crown size={14} />&nbsp;Request Verified Premium Username
              </button>
              <button type="button" className="or-btn or-btn-ghost w-full"
                onClick={() => { setResult(null); setQuery(""); setView("landing"); }} data-testid="waitlist-premium-temp-btn">
                Join with a Different / Temporary Username
              </button>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Fire Power has no monetary value and cannot be exchanged for money or goods.
                Premium usernames are unlocked only by Founder/Admin verification approval.
              </p>
            </div>
          )}

          {(result.state === "reserved" || result.state === "in_use" || result.state === "invalid") && (
            <div className="space-y-2">
              {result.suggestions?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {result.suggestions.map((s) => (
                    <button key={s} type="button" className="or-chip text-xs" onClick={() => { setQuery(s); doSearch(s); }}>@{s}</button>
                  ))}
                </div>
              )}
              <button type="button" className="or-btn or-btn-ghost w-full" onClick={() => { setResult(null); setView("landing"); }} data-testid="waitlist-search-again">
                <Search size={14} />&nbsp;Find Another Username
              </button>
            </div>
          )}
          {err && <div className="text-sm mt-2" style={{ color: "#FF8080" }}>{err}</div>}
        </Panel>
      )}

      {/* FIG 3 — reserve step flow */}
      {view === "reserve" && result && (
        <Panel testid="waitlist-reserve-flow">
          <div className="flex items-center justify-center gap-1 mb-4" data-testid="waitlist-steps">
            {["Search", "Email", "Verify", "Terms", "Confirm"].map((label, i) => (
              <React.Fragment key={label}>
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                    style={{ background: step > i ? gold : "transparent", color: step > i ? "#141414" : "var(--text-muted)", border: `1px solid ${step > i ? gold : "var(--border-col)"}` }}>
                    {step > i + 1 ? <Check size={12} /> : i + 1}
                  </div>
                  <span className="text-[9px] mt-0.5" style={{ color: step > i ? gold : "var(--text-muted)" }}>{label}</span>
                </div>
                {i < 4 && <div className="w-5 h-px mb-3" style={{ background: "var(--border-col)" }} />}
              </React.Fragment>
            ))}
          </div>
          <div className="text-center text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>
            @{result.username} {premiumReq && <Crown size={14} className="inline" style={{ color: gold }} />}
          </div>

          {step === 2 && (
            <div className="space-y-2" data-testid="waitlist-step-email">
              <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Your email</label>
              <input className="or-input" type="email" placeholder="you@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)} data-testid="waitlist-email-input" />
              {err && <div className="text-sm" style={{ color: "#FF8080" }} data-testid="waitlist-reserve-error">{err}</div>}
              <button type="button" className="or-btn w-full" style={{ background: gold, color: "#141414" }}
                disabled={busy || !email.includes("@")} onClick={startReserve} data-testid="waitlist-send-code-btn">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}&nbsp;Send Verification Code
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-2" data-testid="waitlist-step-verify">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                Enter code 123456 to continue!
              </p>
              <input className="or-input text-center tracking-[0.4em]" maxLength={6} placeholder="••••••" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} data-testid="waitlist-code-input" />
              <button type="button" className="or-btn w-full" style={{ background: gold, color: "#141414" }}
                disabled={code.length !== 6} onClick={() => { setErr(""); setStep(4); }} data-testid="waitlist-code-next">Continue</button>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-2" data-testid="waitlist-step-terms">
              {[["accepted_terms", "I accept the Terms of Service", "/legal/terms"],
                ["accepted_conditions", "I accept the Terms & Conditions", "/legal/terms-conditions"],
                ["accepted_privacy", "I accept the Privacy Policy", "/legal/privacy"],
                ["age_confirmed_13", "I confirm I am 13 or older", null]].map(([k, label, href]) => (
                <label key={k} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={terms[k]}
                    onChange={(e) => setTerms({ ...terms, [k]: e.target.checked })} data-testid={`waitlist-term-${k}`} />
                  <span>{label} {href && <Link to={href} target="_blank" className="underline" style={{ color: "var(--primary)" }}>(read)</Link>}</span>
                </label>
              ))}
              {err && <div className="text-sm" style={{ color: "#FF8080" }} data-testid="waitlist-confirm-error">{err}</div>}
              <button type="button" className="or-btn w-full" style={{ background: gold, color: "#141414" }}
                disabled={busy || !allTerms} onClick={confirmReserve} data-testid="waitlist-confirm-btn">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}&nbsp;Confirm Reservation
              </button>
            </div>
          )}

          {step === 5 && confirmOut && (
            <div className="text-center space-y-2" data-testid="waitlist-step-done">
              <CheckCircle2 size={36} className="mx-auto" style={{ color: "#00FF66" }} />
              <div className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Username reserved!</div>
              {confirmOut.queue_position && page.show_queue_position !== false && (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  You are <b style={{ color: gold }}>#{confirmOut.queue_position}</b> in line.
                </p>
              )}
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                This is a reservation — not a usable account yet. We'll email your
                invitation once approved. You can check back anytime with "{page.btn_status || "Check My Status"}".
              </p>
              <button type="button" className="or-btn w-full" style={{ background: gold, color: "#141414" }}
                onClick={() => { setView("status"); refreshStatus(); }} data-testid="waitlist-view-status-btn">View My Status</button>
            </div>
          )}
        </Panel>
      )}

      {/* FIG 4 — status */}
      {view === "status" && !reservation && (
        <Panel testid="waitlist-status-login">
          <h2 className="text-xl text-center mb-3" style={{ fontFamily: "var(--font-display)", color: gold }}>Check My Status</h2>
          <div className="space-y-2">
            <input className="or-input" type="email" placeholder="Reservation email" value={statusEmail}
              onChange={(e) => setStatusEmail(e.target.value)} data-testid="status-email-input" />
            <button
  type="button"
  className="or-btn w-full"
  style={{ background: gold, color: "#141414" }}
  disabled={busy || !statusEmail.includes("@")}
  onClick={statusLogin}
  data-testid="status-login-btn"
>
  {busy ? (
    <Loader2 size={14} className="animate-spin" />
  ) : (
    <Clock size={14} />
  )}
  &nbsp;View My Status
</button>
            {err && <div className="text-sm" style={{ color: "#FF8080" }} data-testid="status-error">{err}</div>}
            <button type="button" className="or-chip text-xs w-full" onClick={() => setView("landing")}>← Back</button>
          </div>
        </Panel>
      )}

      {view === "status" && reservation && (
        <Panel testid="waitlist-status-card" style={{ maxWidth: 620 }}>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xl" style={{ fontFamily: "var(--font-display)" }}>@{reservation.username}</span>
            {reservation.type === "premium_request" && <Crown size={14} style={{ color: gold }} />}
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ml-auto"
              style={{ color: STATUS_COLOR[reservation.status] || "#8B8B8B", border: `1px solid ${STATUS_COLOR[reservation.status] || "#8B8B8B"}55` }}
              data-testid="status-badge">
              {STATUS_LABEL[reservation.status] || reservation.status}
            </span>
          </div>
          <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
            Reserved {String(reservation.created_at).slice(0, 10)}
            {reservation.queue_position != null && <> · queue position <b style={{ color: gold }}>#{reservation.queue_position}</b></>}
            {" · "}email {reservation.email_verified ? "verified ✓" : "unverified"}
            {reservation.verification && <> · verification: {reservation.verification.status} ({reservation.verification.category})</>}
          </p>
          {reservation.denial_reason && (
            <div className="text-[12px] p-2 rounded mb-3" style={{ border: "1px solid #FF808055", color: "var(--text-muted)" }}>{reservation.denial_reason}</div>
          )}

          {/* FIG 6 — document request */}
          {reservation.doc_request && !reservation.doc_request.submitted_at && (
            <div className="p-3 rounded mb-3" style={{ border: "1px solid #FFA94D55" }} data-testid="status-doc-request">
              <div className="text-sm font-semibold mb-1" style={{ color: "#FFA94D" }}>Documents Requested</div>
              {reservation.doc_request.message && <p className="text-[12px] mb-1">{reservation.doc_request.message}</p>}
              <ul className="text-[12px] list-disc pl-4 mb-1" style={{ color: "var(--text-muted)" }}>
                {(reservation.doc_request.items || []).map((i) => <li key={i}>{i}</li>)}
              </ul>
              <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
                Deadline: {String(reservation.doc_request.deadline).slice(0, 10)}
                {" "}({Math.max(0, Math.ceil((new Date(reservation.doc_request.deadline) - Date.now()) / 86400000))} days left)
                {" · "}{reservation.doc_request.formats} · up to {reservation.doc_request.max_files} files
              </p>
              <ul className="space-y-1 mb-2">
                {reservation.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-[12px]" data-testid={`doc-item-${d.id}`}>
                    <FileUp size={12} /> {d.name} <span style={{ color: "var(--text-muted)" }}>({Math.round(d.size / 1024)} KB)</span>
                    {!d.submitted && (
                      <button type="button" className="or-chip text-[10px] ml-auto" onClick={async () => {
                        await apiClient.post("/waitlist/public/documents/remove", { status_token: token, doc_id: d.id });
                        refreshStatus();
                      }} data-testid={`doc-remove-${d.id}`}><Trash2 size={10} /></button>
                    )}
                  </li>
                ))}
              </ul>
              <input type="file" ref={fileRef} accept=".png,.jpg,.jpeg,.webp,.pdf" className="hidden"
                onChange={(e) => e.target.files[0] && uploadDoc(e.target.files[0])} data-testid="doc-file-input" />
              <div className="flex gap-2">
                <button type="button" className="or-chip text-xs" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="doc-upload-btn">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}&nbsp;Add File
                </button>
                <button type="button" className="or-btn text-xs" style={{ background: "#FFA94D", color: "#141414" }}
                  disabled={busy || !reservation.documents.length} onClick={async () => {
                    try { await apiClient.post("/waitlist/public/documents/submit", { status_token: token }); refreshStatus(); }
                    catch (e) { setErr(e?.response?.data?.detail || "Submit failed"); }
                  }} data-testid="doc-submit-btn">Submit Documents</button>
              </div>
            </div>
          )}

          {/* messages */}
          <div className="p-3 rounded mb-3" style={{ border: "1px solid var(--border-col)" }} data-testid="status-messages">
            <div className="text-sm font-semibold mb-2 flex items-center gap-1"><MessageSquare size={13} /> Messages</div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto mb-2">
              {(reservation.messages || []).length === 0 && <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>No messages yet.</div>}
              {(reservation.messages || []).map((m) => (
                <div key={m.id} className="text-[12px]">
                  <b style={{ color: m.admin ? gold : "var(--primary)" }}>{m.from}</b>
                  <span className="ml-2" style={{ color: "var(--text-muted)" }}>{String(m.at).slice(5, 16).replace("T", " ")}</span>
                  <div>{m.text}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="or-input flex-1" placeholder="Write a message…" value={msgText}
                onChange={(e) => setMsgText(e.target.value)} data-testid="status-message-input" />
              <button type="button" className="or-chip" disabled={!msgText.trim()} onClick={async () => {
                await apiClient.post("/waitlist/public/messages", { status_token: token, text: msgText });
                setMsgText(""); refreshStatus();
              }} data-testid="status-message-send"><Send size={12} /></button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!reservation.verification && ["waiting_review", "under_review"].includes(reservation.status) && (
              <button type="button" className="or-btn text-xs" style={{ background: "#0E7490", color: "#fff" }}
                onClick={() => setView("verification")} data-testid="status-request-verification-btn">
                <ShieldCheck size={13} />&nbsp;Request Verification
              </button>
            )}
            {!["denied", "withdrawn"].includes(reservation.status) && (
              <button type="button" className="or-chip text-xs" onClick={async () => {
                if (!window.confirm("Withdraw your reservation? The username becomes available to others.")) return;
                await apiClient.post("/waitlist/public/withdraw", { status_token: token });
                refreshStatus();
              }} data-testid="status-withdraw-btn"><Trash2 size={11} />&nbsp;Withdraw Reservation</button>
            )}
            <button type="button" className="or-chip text-xs ml-auto" onClick={() => { setReservation(null); setView("landing"); }}>← Home</button>
          </div>
          {err && <div className="text-sm mt-2" style={{ color: "#FF8080" }}>{err}</div>}
        </Panel>
      )}

      {/* FIG 5 — verification request */}
      {view === "verification" && (
        <Panel testid="waitlist-verification-form">
          <h2 className="text-xl mb-3" style={{ fontFamily: "var(--font-display)", color: "#4DD2FF" }}>Request Verification</h2>
          <div className="space-y-2">
            <select className="or-input" value={ver.category} onChange={(e) => setVer({ ...ver, category: e.target.value })} data-testid="ver-category">
              <option value="">Select a category…</option>
              {(page.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="or-input" placeholder="Legal / public name" value={ver.legal_name}
              onChange={(e) => setVer({ ...ver, legal_name: e.target.value })} data-testid="ver-name" />
            <input className="or-input" placeholder="Website (optional)" value={ver.website}
              onChange={(e) => setVer({ ...ver, website: e.target.value })} data-testid="ver-website" />
            <textarea className="or-input" rows={3} placeholder="Why should this username be verified for you?"
              value={ver.explanation} onChange={(e) => setVer({ ...ver, explanation: e.target.value })} data-testid="ver-explanation" />
            <textarea className="or-input" rows={2} placeholder="Supporting links (one per line, optional)"
              value={ver.links} onChange={(e) => setVer({ ...ver, links: e.target.value })} data-testid="ver-links" />
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={ver.accurate}
                onChange={(e) => setVer({ ...ver, accurate: e.target.checked })} data-testid="ver-accurate" />
              <span>I confirm the submitted information is accurate.</span>
            </label>
            {err && <div className="text-sm" style={{ color: "#FF8080" }} data-testid="ver-error">{err}</div>}
            <div className="flex gap-2">
              <button type="button" className="or-btn text-xs flex-1" style={{ background: "#0E7490", color: "#fff" }}
                disabled={busy || !ver.category || !ver.legal_name || !ver.explanation || !ver.accurate}
                onClick={submitVerification} data-testid="ver-submit">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}&nbsp;Submit Request
              </button>
              <button type="button" className="or-chip text-xs" onClick={() => setView("status")} data-testid="ver-cancel">Cancel</button>
            </div>
          </div>
        </Panel>
      )}

      <div className="text-[11px] mt-6 flex gap-3" style={{ color: "var(--text-muted)" }}>
        <Link to="/legal" className="underline">Legal</Link>
        <Link to="/signin" className="underline">Sign In</Link>
      </div>
    </div>
  );
}
