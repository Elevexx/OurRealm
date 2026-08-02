/**
 * AdminSettingsTab — content for the Settings > Admin tab.
 *
 * Visibility (UI-only — backend remains the source of truth):
 *   • @stealth (founder)        — full kit: Admin Dashboard + all
 *                                  user-management tools.
 *   • @support (support-admin)  — Admin Dashboard + tools their
 *                                  backend role allows (search,
 *                                  suspend, mute, delete; NO
 *                                  password reset — founder-only).
 *   • everyone else             — the tab is not rendered.
 *
 * The user-management tools reuse the existing widgets so we don't
 * introduce duplicate UI surfaces.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/isAdmin";
import AdminUserControlWidget from "@/components/AdminUserControlWidget";
import AdminPasswordResetWidget from "@/components/AdminPasswordResetWidget";
import { ModeScreen } from "@/components/SiteModeGate";

// Founder-only "Site Access Mode" — Live / Beta / Preview / Maintenance.
function SiteAccessCard() {
  const [data, setData] = React.useState(null);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState([]);
  const [bulk, setBulk] = React.useState("");
  const [preview, setPreview] = React.useState(null);
  const load = React.useCallback(() => {
    apiClient.get("/admin/access-control/site-mode").then((r) => setData(r.data)).catch(() => {});
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      apiClient.get(`/admin/access-control/site-mode/search-users?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.data.users || [])).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  if (!data) return null;
  const { settings, modes } = data;
  const setMode = async (mode) => {
    if (mode !== "live" && !window.confirm(`Switch the ENTIRE site to ${mode.toUpperCase()} mode? Only admins and Always-Allow users keep access.`)) return;
    await apiClient.patch("/admin/access-control/site-mode", { mode });
    toast.success(`Site mode: ${mode}`); load();
  };
  const savePage = async (m, field, value) => {
    await apiClient.patch("/admin/access-control/site-mode", { pages: { [m]: { ...settings.pages[m], [field]: value } } });
    load();
  };
  const allow = async (usernames, remove = false) => {
    const { data: r } = await apiClient.post("/admin/access-control/site-mode/allowlist", { usernames, remove });
    toast.success(`${remove ? "Removed" : "Added"}: ${r.changed.join(", ") || "none found"}`);
    setQ(""); setBulk(""); load();
  };
  const ModePreview = preview && (
    <ModeScreen mode={preview} title={settings.pages[preview]?.title}
      message={settings.pages[preview]?.message} isPreview
      onClose={() => setPreview(null)} />
  );
  return (
    <div className="or-surface p-4" data-testid="site-access-card">
      {ModePreview}
      <div className="text-sm font-bold mb-1">Site Access Mode</div>
      <div className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
        Enforced server-side on every API. Admins always bypass. Current: <b className="uppercase" style={{ color: settings.mode === "live" ? "var(--brand-green, #10E670)" : "#F4A73B" }}>{settings.mode}</b>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {modes.map((m) => (
          <button key={m} className="or-chip text-xs capitalize" data-active={settings.mode === m}
            onClick={() => setMode(m)} data-testid={`site-mode-${m}`}>
            {m === "live" ? "Live (Normal)" : m}
          </button>
        ))}
      </div>
      {["beta", "preview", "maintenance"].map((m) => (
        <div key={m} className="mb-2 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold uppercase" style={{ color: "var(--text-muted)" }}>{m} screen</span>
            <button className="or-btn or-btn-ghost text-[10px]" onClick={() => setPreview(m)} data-testid={`site-preview-${m}`}>Preview</button>
          </div>
          <input className="or-input text-xs w-full mb-1" defaultValue={settings.pages[m]?.title || ""}
            placeholder="Title" onBlur={(e) => e.target.value !== settings.pages[m]?.title && savePage(m, "title", e.target.value)}
            data-testid={`site-title-${m}`} />
          <input className="or-input text-xs w-full" defaultValue={settings.pages[m]?.message || ""}
            placeholder="Message" onBlur={(e) => e.target.value !== settings.pages[m]?.message && savePage(m, "message", e.target.value)}
            data-testid={`site-message-${m}`} />
        </div>
      ))}
      <div className="text-xs font-bold mt-3 mb-1">Always Allow Access ({(settings.allowlist || []).length})</div>
      <input className="or-input text-xs w-full mb-1" placeholder="Search username or email…" value={q}
        onChange={(e) => setQ(e.target.value)} data-testid="site-allow-search" />
      {results.map((u) => (
        <div key={u.id} className="flex items-center justify-between text-xs py-1">
          <span>@{u.username} <span style={{ color: "var(--text-muted)" }}>{u.email}</span></span>
          <button className="or-btn or-btn-ghost text-[10px]" onClick={() => allow([u.username])} data-testid={`site-allow-add-${u.username}`}>Add</button>
        </div>
      ))}
      <div className="flex gap-1.5 mt-1">
        <input className="or-input text-xs flex-1" placeholder="Bulk: user1, user2, email3…" value={bulk}
          onChange={(e) => setBulk(e.target.value)} data-testid="site-allow-bulk-input" />
        <button className="or-btn or-btn-ghost text-[10px]" onClick={() => allow(bulk.split(","))} data-testid="site-allow-bulk-add">Add all</button>
        <button className="or-btn or-btn-ghost text-[10px]" onClick={() => allow(bulk.split(","), true)} data-testid="site-allow-bulk-remove">Remove all</button>
      </div>
      <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
        {(settings.allowlist || []).map((e) => (
          <div key={e.user_id} className="flex items-center justify-between text-xs">
            <span>@{e.username} <span style={{ color: "var(--text-muted)" }}>{e.email}</span></span>
            <button className="or-btn or-btn-ghost text-[10px]" style={{ color: "#FF6B6B" }}
              onClick={() => allow([e.username], true)} data-testid={`site-allow-remove-${e.username}`}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Founder-only "New Signup Access" card — one toggle, enforced server-side.
function SignupAccessCard() {
  const [state, setState] = React.useState(null);
  React.useEffect(() => {
    apiClient.get("/admin/access-control/signup").then((r) => setState(r.data)).catch(() => {});
  }, []);
  if (!state) return null;
  const open = state.allow_new_signups;
  const toggle = async () => {
    try {
      const { data } = await apiClient.patch("/admin/access-control/signup", { allow_new_signups: !open });
      setState({ ...state, allow_new_signups: data.allow_new_signups });
      toast.success(data.allow_new_signups ? "Public signups open" : "Public signups paused");
    } catch { toast.error("Could not update signup access"); }
  };
  return (
    <div className="or-surface p-4 flex flex-wrap items-center gap-3" data-testid="signup-access-card">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold">New Signup Access</div>
        <div className="text-[11px]" style={{ color: open ? "var(--brand-green, #10E670)" : "#F4A73B" }} data-testid="signup-access-status">
          {open ? "Public Signups Open" : "Public Signups Paused"}
        </div>
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          When paused: existing sign-ins, Google sign-in, password reset and admin/parent-created accounts still work.
          {state.reservations ? ` · ${state.reservations} spot reservation(s)` : ""}
        </div>
      </div>
      <button className="or-btn text-xs font-bold" onClick={toggle}
        style={{ background: open ? "#F4A73B" : "var(--brand-green, #10E670)", color: "#0a0a0a" }}
        data-testid="signup-access-toggle">
        {open ? "Pause signups" : "Allow new signups"}
      </button>
    </div>
  );
}

export default function AdminSettingsTab() {
  const { user } = useAuth();
  if (!isAdmin(user)) return null;

  const isFounder = (user.username || "").toLowerCase() === "stealth";

  return (
    <div className="space-y-4" data-testid="tab-admin">
      <div className="or-surface p-4 flex items-center gap-3" data-testid="admin-tab-header">
        <ShieldCheck size={18} style={{ color: "var(--primary)" }} />
        <div className="flex-1">
          <div className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Admin role: {isFounder ? "founder" : (user.admin_role || "admin")}
          </div>
          <div className="text-sm" style={{ color: "var(--text-main)" }}>
            Account & moderation tools. Backend enforces every action.
          </div>
        </div>
        <Link
          to="/admin"
          className="or-btn"
          data-testid="admin-tab-dashboard-link"
        >
          <ExternalLink size={14} /> Go to Admin Dashboard
        </Link>
      </div>

      {/* Founder password reset — sits above the general user-control
          widget because it's the most sensitive tool and is strictly
          founder-only on the backend. */}
      {isFounder && <SignupAccessCard />}
      {isFounder && <SiteAccessCard />}
      {isFounder && <AdminPasswordResetWidget />}

      {/* Search + suspend / mute / delete / username + email change.
          The widget itself hides the username/email change forms
          when the viewer doesn't have founder permission. */}
      <AdminUserControlWidget />
    </div>
  );
}
