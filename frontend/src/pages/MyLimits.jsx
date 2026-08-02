import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Clock, Lock, Landmark, Image as ImageIcon, Ban, KeyRound } from "lucide-react";
import { toast } from "sonner";
import apiClient, { formatApiErrorDetail } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const nice = (s) => (s || "").replace(/_/g, " ");

// Teen transparency page — read-only "My Limits" + parent link requests
// + first-login password set for parent-created accounts.
export default function MyLimits() {
  const { user, refreshMe } = useAuth();
  const [d, setD] = useState(null);
  const [pw, setPw] = useState("");

  const load = useCallback(() => {
    apiClient.get("/guardian/my-limits").then((r) => setD(r.data)).catch(() => {});
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return null;
  if (!d) return <div className="rcx-loader p-8" />;
  if (!d.is_teen) {
    return (
      <div className="max-w-lg mx-auto p-6 text-center or-surface mt-6" data-testid="mylimits-adult">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          My Limits applies to Teen accounts. Adult accounts have full access.
        </p>
      </div>
    );
  }

  const respond = async (id, accept) => {
    try {
      await apiClient.post(`/guardian/link-requests/${id}/respond`, { accept });
      toast.success(accept ? "Parent linked" : "Request declined");
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };

  const setPassword = async () => {
    try {
      await apiClient.post("/guardian/me/set-password", { new_password: pw });
      toast.success("Your new password is set");
      setPw("");
      refreshMe && refreshMe();
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };

  const chip = (label, on) => (
    <span key={label} className="text-[10px] px-2 py-1 rounded-full font-semibold"
      style={{ background: on ? "rgba(16,230,112,0.12)" : "rgba(255,255,255,0.05)",
               color: on ? "var(--brand-green, #10E670)" : "var(--text-muted)" }}>
      {nice(label)}
    </span>
  );

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-5 py-4 space-y-3" data-testid="mylimits-page">
      <div className="flex items-center gap-2.5">
        <ShieldCheck size={22} style={{ color: "var(--brand-green, #10E670)" }} />
        <div>
          <h1 className="text-lg font-extrabold" style={{ fontFamily: "var(--font-display)" }}>My Limits</h1>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            A transparent view of your current access — nothing is hidden from you.
          </p>
        </div>
      </div>

      {d.must_set_password && (
        <div className="or-surface p-4" style={{ border: "1px solid rgba(244,167,59,0.4)" }} data-testid="mylimits-set-password">
          <div className="font-bold text-sm mb-1 flex items-center gap-2"><KeyRound size={15} style={{ color: "#F4A73B" }} /> Create your own password</div>
          <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
            Your account was created by your parent with a temporary password. Set your own now — no one else will know it.
          </p>
          <div className="flex gap-2">
            <input type="password" className="or-input text-xs flex-1" value={pw} placeholder="New password (min 6 characters)"
              onChange={(e) => setPw(e.target.value)} data-testid="mylimits-password-input" />
            <button className="or-btn text-xs font-bold" style={{ background: "var(--brand-green, #10E670)", color: "#0a0a0a" }}
              disabled={pw.length < 6} onClick={setPassword} data-testid="mylimits-password-save">Save</button>
          </div>
        </div>
      )}

      {(d.pending_requests || []).map((r) => (
        <div key={r.id} className="or-surface p-4 flex flex-wrap items-center justify-between gap-2" data-testid={`mylimits-link-request-${r.id}`}>
          <div className="text-sm">
            <b>@{r.guardian_username}</b> wants to become your parent/guardian.
          </div>
          <div className="flex gap-2">
            <button className="or-btn text-xs" onClick={() => respond(r.id, true)} data-testid={`link-accept-${r.id}`}>Accept</button>
            <button className="or-btn or-btn-ghost text-xs" onClick={() => respond(r.id, false)} data-testid={`link-decline-${r.id}`}>Decline</button>
          </div>
        </div>
      ))}

      <div className="or-surface p-4" data-testid="mylimits-status">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {d.locked && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,63,90,0.15)", color: "#FF3F5A" }}>LOCKED BY PARENT</span>}
          {d.blocked && !d.locked && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(244,167,59,0.15)", color: "#F4A73B" }}>{nice(d.blocked_reason).toUpperCase()}</span>}
          {!d.blocked && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(16,230,112,0.12)", color: "var(--brand-green, #10E670)" }}>ACCESS OPEN</span>}
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {d.has_guardian ? `Managed by @${d.guardian_username}` : "No parent linked yet"} · Rule: {nice(d.controlling_rule)}
          </span>
        </div>
        {d.next_available_at && (
          <div className="text-xs flex items-center gap-1.5" style={{ color: "var(--brand-blue)" }} data-testid="mylimits-next-available">
            <Clock size={13} /> Available again: {new Date(d.next_available_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
          </div>
        )}
        {d.routine_name && <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Current routine: <b>{d.routine_name}</b></div>}
      </div>

      <div className="or-surface p-4" data-testid="mylimits-time">
        <div className="font-bold text-sm mb-2 flex items-center gap-2"><Clock size={15} style={{ color: "var(--brand-blue)" }} /> Screen time today</div>
        {d.daily_limit_minutes == null ? (
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>No daily limit set. Used {d.time_used_minutes} min today.</div>
        ) : (
          <>
            <div className="h-2 rounded-full mb-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="h-2 rounded-full" style={{
                width: `${Math.min(100, (d.time_used_minutes / Math.max(1, d.daily_limit_minutes)) * 100)}%`,
                background: d.time_remaining_minutes > 15 ? "var(--brand-green, #10E670)" : "#F4A73B" }} />
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="mylimits-time-numbers">
              {d.time_used_minutes} min used · {d.time_remaining_minutes} min remaining of {d.daily_limit_minutes} min
            </div>
          </>
        )}
        {d.schedule?.enabled && (
          <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            Allowed hours: {(d.schedule.windows || []).map((w) => `${w.start}–${w.end}`).join(", ")} on {(d.schedule.days || []).map(nice).join(", ")}
          </div>
        )}
        {d.bedtime?.enabled && (
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Bedtime: {d.bedtime.start} → {d.bedtime.end}</div>
        )}
      </div>

      <div className="or-surface p-4" data-testid="mylimits-centers">
        <div className="font-bold text-sm mb-2 flex items-center gap-2"><Landmark size={15} style={{ color: "#F4C84A" }} /> Allowed Centers</div>
        <div className="flex flex-wrap gap-1.5">{(d.allowed_centers || []).map((c) => chip(c, true))}</div>
      </div>

      <div className="or-surface p-4" data-testid="mylimits-media">
        <div className="font-bold text-sm mb-2 flex items-center gap-2"><ImageIcon size={15} style={{ color: "var(--brand-blue)" }} /> Allowed media</div>
        <div className="flex flex-wrap gap-1.5">{(d.allowed_media || []).map((c) => chip(c, true))}</div>
        <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>Content filter: <b>{nice(d.content_filter)}</b></div>
      </div>

      <div className="or-surface p-4" data-testid="mylimits-disabled">
        <div className="font-bold text-sm mb-2 flex items-center gap-2"><Ban size={15} style={{ color: "#FF6B6B" }} /> Features currently off</div>
        {(d.disabled_features || []).length === 0
          ? <div className="text-xs" style={{ color: "var(--text-muted)" }}>Everything is enabled.</div>
          : <div className="flex flex-wrap gap-1.5">{d.disabled_features.map((c) => chip(c, false))}</div>}
        <p className="text-[10px] mt-3" style={{ color: "var(--text-muted)" }}>
          If something is blocked, it's because of these settings — talk to your parent/guardian about adjusting them.
        </p>
      </div>
    </div>
  );
}
