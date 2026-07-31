import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, Plus, ShieldCheck, Vault, Users, ChevronRight, Mail } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { RC_TYPES, rcTypeMeta, ROLE_COLORS } from "@/lib/rcTypes";
import { RcImg, useRcBranding } from "@/lib/rcAssets";

// Responsibility Center — landing hub (Phase 1).
// Explains the system, lists my Centers + pending invites, and links
// into the creation wizard. Fire Power only — never money.
export default function ResponsibilityCenterHub() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyInvite, setBusyInvite] = useState(null);

  const load = useCallback(async () => {
    try {
      const [mine, cfg] = await Promise.all([
        apiClient.get("/responsibility-center/mine"),
        apiClient.get("/responsibility-center/config"),
      ]);
      setData(mine.data);
      setConfig(cfg.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load Responsibility Centers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const respond = async (centerId, accept) => {
    setBusyInvite(centerId);
    try {
      const r = await apiClient.post(`/responsibility-center/${centerId}/invites/respond`, { accept });
      if (accept && r.data?.joined) {
        toast.success("Welcome to the Center! Your 30-day seat is active.");
        navigate(`/responsibility-center/${centerId}`);
      } else {
        toast.success(accept ? "Joined" : "Invite declined");
        load();
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not respond to the invite");
    } finally {
      setBusyInvite(null);
    }
  };

  const balance = data?.my_fire_vault_balance ?? 0;
  const createCost = config?.create_cost ?? 1000;
  const branding = useRcBranding();

  return (
    <div className="max-w-4xl mx-auto" data-testid="rc-hub-page">
      <div className="mb-6 flex items-start gap-4">
        <RcImg assetKey="responsibility_center.main_logo" height={64} eager
          fallback={null} testid="rc-hub-logo" />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>OurRealm</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }} data-testid="rc-hub-title">{branding.short_name}</h1>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }} data-testid="rc-hub-tagline">{branding.tagline}</div>
          <p className="text-sm mt-2 max-w-2xl" style={{ color: "var(--text-muted)" }}>
            A universal home for the groups you're responsible for — families, businesses, teams,
            and organizations. Each Center has its own members, roles, and a shared Center Vault
            powered entirely by Fire Power.
          </p>
        </div>
      </div>

      <RcImg assetKey="responsibility_center.landing.hero" className="w-full rounded-xl mb-6"
        style={{ maxHeight: 260, objectFit: "cover" }} fallback={null} testid="rc-hub-hero" />

      {/* How it works */}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <div className="or-surface p-4" data-testid="rc-hub-how-create">
          <Flame size={18} style={{ color: "#FF8A5A" }} />
          <div className="text-sm font-semibold mt-2">Create with Fire Power</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Founding a Center burns {createCost.toLocaleString()} 🔥 from your Fire Vault — your first 30-day seat is included.
          </div>
        </div>
        <div className="or-surface p-4" data-testid="rc-hub-how-vault">
          <Vault size={18} style={{ color: "#F4C84A" }} />
          <div className="text-sm font-semibold mt-2">Fund the Center Vault</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Members move Fire Power into the shared vault. Each member seat costs {config?.seat_cost ?? 100} 🔥 per {config?.seat_days ?? 30} days, paid by the vault.
          </div>
        </div>
        <div className="or-surface p-4" data-testid="rc-hub-how-roles">
          <ShieldCheck size={18} style={{ color: "#5AB2FF" }} />
          <div className="text-sm font-semibold mt-2">Granular roles</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Owner, Admin, Manager, and Member roles control who can invite, manage, and view the vault.
          </div>
        </div>
      </div>

      {/* Create CTA */}
      <div className="or-surface p-5 mb-6 flex flex-wrap items-center justify-between gap-3" data-testid="rc-hub-create-cta">
        <div>
          <div className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Start a new Center</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Cost: <b style={{ color: "#FF8A5A" }}>{createCost.toLocaleString()} 🔥</b> · Your Fire Vault:{" "}
            <b style={{ color: balance >= createCost ? "var(--brand-green, #7BD88F)" : "#FF6B6B" }} data-testid="rc-hub-balance">
              {balance.toLocaleString()} 🔥
            </b>
          </div>
        </div>
        <button className="or-btn" onClick={() => navigate("/responsibility-center/create")} data-testid="rc-hub-create-btn">
          <Plus size={14} /> Create a Center
        </button>
      </div>

      {loading && (
        <div className="or-surface p-6 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="rc-hub-loading">
          Loading your Centers…
        </div>
      )}

      {/* Pending invites */}
      {!loading && (data?.invites?.length || 0) > 0 && (
        <div className="mb-6" data-testid="rc-hub-invites">
          <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>
            <Mail size={16} className="inline mr-1" /> Pending Invites
          </h3>
          <div className="space-y-2">
            {data.invites.map(({ center, membership }) => (
              <div key={center.id} className="or-surface p-4 flex flex-wrap items-center justify-between gap-3" data-testid={`rc-invite-${center.id}`}>
                <div>
                  <div className="text-sm font-semibold">{center.name}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Invited by @{membership.invited_by_username} · {rcTypeMeta(center.center_type).label}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="or-btn" disabled={busyInvite === center.id}
                    onClick={() => respond(center.id, true)} data-testid={`rc-invite-accept-${center.id}`}>
                    Accept
                  </button>
                  <button className="or-btn or-btn-ghost" disabled={busyInvite === center.id}
                    onClick={() => respond(center.id, false)} data-testid={`rc-invite-decline-${center.id}`}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My centers */}
      {!loading && (
        <div data-testid="rc-hub-my-centers">
          <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)" }}>My Centers</h3>
          {(data?.centers?.length || 0) === 0 ? (
            <div className="or-surface p-8 text-center" data-testid="rc-hub-empty">
              <RcImg assetKey="responsibility_center.landing.no_centers" className="mx-auto mb-3"
                style={{ maxHeight: 160 }} fallback={null} />
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                You don't belong to any Responsibility Centers yet.
              </div>
              <button className="or-btn mt-4" onClick={() => navigate("/responsibility-center/create")} data-testid="rc-hub-empty-create-btn">
                <Plus size={14} /> Create your first Center
              </button>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {data.centers.map(({ center, membership }) => {
                const meta = rcTypeMeta(center.center_type);
                return (
                  <button key={center.id}
                    className="or-surface p-4 text-left transition-transform hover:-translate-y-0.5"
                    onClick={() => navigate(`/responsibility-center/${center.id}`)}
                    data-testid={`rc-center-card-${center.id}`}>
                    <div className="flex items-center gap-3">
                      <div className="rounded-full flex items-center justify-center shrink-0"
                        style={{ width: 40, height: 40, background: `${meta.color}22`, color: meta.color }}>
                        <meta.Icon size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{center.name}</div>
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>{meta.label}</div>
                      </div>
                      <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                      <span className="uppercase tracking-wide font-semibold" style={{ color: ROLE_COLORS[membership.role] }}>
                        {membership.role}
                      </span>
                      <span><Users size={11} className="inline mr-1" />{center.member_count}</span>
                      <span><Vault size={11} className="inline mr-1" />{center.vault_balance.toLocaleString()} 🔥</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
