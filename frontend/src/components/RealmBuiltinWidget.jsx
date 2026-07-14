/**
 * RealmBuiltinWidget — real renderers for the built-in Realm widget
 * library (June 2026 fix for the "blank widget" bug).
 *
 * Realm widgets store { type, config } only. Every supported type below
 * renders actual content from its config or live realm data; widgets
 * that need setup show a clear "needs setup" card (admins can configure
 * inline); unsupported/legacy types show a labelled card with a remove
 * action instead of an empty container. Custom registry widgets (with
 * an editor_config) are hydrated and delegated to CustomWidgetRenderer.
 */
import React, { useEffect, useMemo, useState } from "react";
import apiClient from "@/api/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import CustomWidgetRenderer from "@/components/widgets/CustomWidgetRenderer";
import {
  Megaphone, ScrollText, StickyNote, Timer, CalendarDays, Users,
  CalendarPlus, AlertTriangle, Loader2, Pencil, Check, X, Trash2,
} from "lucide-react";

const BUILTIN_TYPES = new Set([
  "announcements", "rules", "notes", "countdown", "calendar", "top8", "events",
]);
export function isRealmBuiltin(type) { return BUILTIN_TYPES.has(type); }

function Shell({ icon: Icon, label, children, testid }) {
  return (
    <section className="or-surface p-4 h-full flex flex-col" data-testid={testid}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

function SetupCard({ isAdmin, message, onSetup, testid }) {
  return (
    <div className="text-center py-3" data-testid={testid}>
      <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>{message}</div>
      {isAdmin && onSetup && (
        <button className="or-chip" onClick={onSetup} data-testid={`${testid}-setup`}>
          <Pencil size={11} /> Set up
        </button>
      )}
    </div>
  );
}

function usePatchConfig(realmId, widget, onChanged) {
  const [saving, setSaving] = useState(false);
  const patch = async (config) => {
    setSaving(true);
    try {
      const { data } = await apiClient.patch(
        `/communities/realm/${realmId}/widgets/${widget.id}`, { config });
      onChanged?.(data);
      return true;
    } catch {
      return false;
    } finally { setSaving(false); }
  };
  return { patch, saving };
}

// ── Announcements / Rules ────────────────────────────────────────────
function AnnouncementsW({ realmId, widget, isAdmin, onChanged }) {
  const { patch, saving } = usePatchConfig(realmId, widget, onChanged);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(widget.config?.announcement || "");
  const value = widget.config?.announcement || "";
  return (
    <Shell icon={Megaphone} label="Announcements" testid={`realm-widget-announcements-${widget.id}`}>
      {editing ? (
        <div className="space-y-2">
          <textarea className="or-input w-full text-sm" rows={3} value={text}
                    onChange={(e) => setText(e.target.value)} maxLength={500}
                    data-testid="realm-announcement-input" />
          <div className="flex gap-2">
            <button className="or-chip" disabled={saving}
                    onClick={async () => { if (await patch({ ...widget.config, announcement: text })) setEditing(false); }}
                    data-testid="realm-announcement-save">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
            </button>
            <button className="or-chip" onClick={() => setEditing(false)}><X size={11} /> Cancel</button>
          </div>
        </div>
      ) : value ? (
        <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-main)" }}>
          {value}
          {isAdmin && (
            <button className="or-chip ml-2 align-middle" onClick={() => { setText(value); setEditing(true); }}
                    data-testid="realm-announcement-edit"><Pencil size={10} /></button>
          )}
        </div>
      ) : (
        <SetupCard isAdmin={isAdmin} message="No announcement yet."
                   onSetup={() => setEditing(true)} testid="realm-announcement-empty" />
      )}
    </Shell>
  );
}

function RulesW({ widget }) {
  const rules = widget.config?.rules || [];
  return (
    <Shell icon={ScrollText} label="Realm Rules" testid={`realm-widget-rules-${widget.id}`}>
      {rules.length === 0 ? (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>No rules configured yet.</div>
      ) : (
        <ol className="text-sm space-y-1 list-decimal list-inside" style={{ color: "var(--text-main)" }}>
          {rules.map((r, i) => <li key={i}>{r}</li>)}
        </ol>
      )}
    </Shell>
  );
}

// ── Notes ────────────────────────────────────────────────────────────
function NotesW({ realmId, widget, isAdmin, onChanged }) {
  const { patch, saving } = usePatchConfig(realmId, widget, onChanged);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(widget.config?.text || "");
  const value = widget.config?.text || "";
  return (
    <Shell icon={StickyNote} label="Realm Notes" testid={`realm-widget-notes-${widget.id}`}>
      {editing ? (
        <div className="space-y-2">
          <textarea className="or-input w-full text-sm" rows={4} value={text}
                    onChange={(e) => setText(e.target.value)} maxLength={2000}
                    data-testid="realm-notes-input" />
          <div className="flex gap-2">
            <button className="or-chip" disabled={saving}
                    onClick={async () => { if (await patch({ ...widget.config, text })) setEditing(false); }}
                    data-testid="realm-notes-save">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
            </button>
            <button className="or-chip" onClick={() => setEditing(false)}><X size={11} /> Cancel</button>
          </div>
        </div>
      ) : value ? (
        <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-main)" }}>
          {value}
          {isAdmin && (
            <button className="or-chip ml-2 align-middle" onClick={() => { setText(value); setEditing(true); }}
                    data-testid="realm-notes-edit"><Pencil size={10} /></button>
          )}
        </div>
      ) : (
        <SetupCard isAdmin={isAdmin} message="Shared notes for this realm — nothing here yet."
                   onSetup={() => setEditing(true)} testid="realm-notes-empty" />
      )}
    </Shell>
  );
}

// ── Countdown ────────────────────────────────────────────────────────
function CountdownW({ realmId, widget, isAdmin, onChanged }) {
  const { patch, saving } = usePatchConfig(realmId, widget, onChanged);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(widget.config?.title || "");
  const [target, setTarget] = useState(widget.config?.target || "");
  const [now, setNow] = useState(Date.now());
  const targetMs = widget.config?.target ? new Date(widget.config.target).getTime() : null;
  useEffect(() => {
    if (!targetMs) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [targetMs]);

  const remaining = targetMs ? Math.max(0, targetMs - now) : 0;
  const d = Math.floor(remaining / 86400000);
  const h = Math.floor((remaining % 86400000) / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);

  return (
    <Shell icon={Timer} label="Countdown" testid={`realm-widget-countdown-${widget.id}`}>
      {editing ? (
        <div className="space-y-2">
          <input className="or-input w-full text-sm" placeholder="Event title" value={title}
                 onChange={(e) => setTitle(e.target.value)} maxLength={80} data-testid="realm-countdown-title" />
          <input className="or-input w-full text-sm" type="datetime-local" value={target}
                 onChange={(e) => setTarget(e.target.value)} data-testid="realm-countdown-target" />
          <div className="flex gap-2">
            <button className="or-chip" disabled={saving || !target}
                    onClick={async () => { if (await patch({ title, target })) setEditing(false); }}
                    data-testid="realm-countdown-save">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
            </button>
            <button className="or-chip" onClick={() => setEditing(false)}><X size={11} /> Cancel</button>
          </div>
        </div>
      ) : targetMs ? (
        <div className="text-center" data-testid="realm-countdown-display">
          {widget.config?.title && (
            <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-main)" }}>{widget.config.title}</div>
          )}
          {remaining > 0 ? (
            <div className="flex justify-center gap-3">
              {[["d", d], ["h", h], ["m", m], ["s", s]].map(([u, v]) => (
                <div key={u}>
                  <div className="text-xl font-bold" style={{ color: "var(--primary)" }}>{v}</div>
                  <div className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>{u}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm font-bold" style={{ color: "var(--primary)" }}>It's here! 🎉</div>
          )}
          {isAdmin && (
            <button className="or-chip mt-2" onClick={() => { setTitle(widget.config?.title || ""); setTarget(widget.config?.target || ""); setEditing(true); }}
                    data-testid="realm-countdown-edit"><Pencil size={10} /> Edit</button>
          )}
        </div>
      ) : (
        <SetupCard isAdmin={isAdmin} message="No countdown configured yet — set a date to start the timer."
                   onSetup={() => setEditing(true)} testid="realm-countdown-empty" />
      )}
    </Shell>
  );
}

// ── Calendar (current month, real dates) ─────────────────────────────
function CalendarW({ widget }) {
  const today = new Date();
  const { cells, monthLabel } = useMemo(() => {
    const y = today.getFullYear(); const mo = today.getMonth();
    const first = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    const arr = Array(first).fill(null).concat(Array.from({ length: days }, (_, i) => i + 1));
    return { cells: arr, monthLabel: today.toLocaleString("default", { month: "long", year: "numeric" }) };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Shell icon={CalendarDays} label={monthLabel} testid={`realm-widget-calendar-${widget.id}`}>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-0.5 font-bold">{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} className="py-1 rounded"
               style={d === today.getDate()
                 ? { background: "var(--primary)", color: "var(--primary-fg)", fontWeight: 700 }
                 : { color: d ? "var(--text-main)" : "transparent" }}>
            {d || "."}
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ── Top Members (real members data) ──────────────────────────────────
function TopMembersW({ realmId, widget }) {
  const [members, setMembers] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/communities/realm/${realmId}/members`, { params: { limit: 8 } });
        if (!cancelled) setMembers(data?.members || data?.rows || []);
      } catch { if (!cancelled) setMembers([]); }
    })();
    return () => { cancelled = true; };
  }, [realmId]);
  return (
    <Shell icon={Users} label="Top Members" testid={`realm-widget-top8-${widget.id}`}>
      {members === null ? (
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={12} className="animate-spin" /> Loading members…
        </div>
      ) : members.length === 0 ? (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>No members yet.</div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {members.slice(0, 8).map((m) => (
            <div key={m.user_id} className="text-center">
              {m.avatar_url ? (
                <img src={resolveMediaUrl(m.avatar_url)} alt="" className="rounded-full object-cover mx-auto" style={{ width: 36, height: 36 }} />
              ) : (
                <div className="rounded-full mx-auto flex items-center justify-center text-xs font-bold"
                     style={{ width: 36, height: 36, background: "var(--surface-2)", color: "var(--primary)" }}>
                  {(m.username || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="text-[9px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>@{m.username}</div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

// ── Events (config-driven list) ──────────────────────────────────────
function EventsW({ realmId, widget, isAdmin, onChanged }) {
  const { patch, saving } = usePatchConfig(realmId, widget, onChanged);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const events = widget.config?.events || [];
  const addEvent = async () => {
    if (!title.trim() || !when) return;
    const next = [...events, { id: Date.now().toString(36), title: title.trim(), when }];
    if (await patch({ ...widget.config, events: next })) { setAdding(false); setTitle(""); setWhen(""); }
  };
  const removeEvent = async (id) => {
    await patch({ ...widget.config, events: events.filter((e) => e.id !== id) });
  };
  return (
    <Shell icon={CalendarPlus} label="Realm Events" testid={`realm-widget-events-${widget.id}`}>
      {events.length === 0 && !adding && (
        <SetupCard isAdmin={isAdmin} message="No events scheduled yet."
                   onSetup={() => setAdding(true)} testid="realm-events-empty" />
      )}
      {events.length > 0 && (
        <div className="space-y-1.5">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-sm" data-testid={`realm-event-${e.id}`}>
              <CalendarDays size={13} style={{ color: "var(--primary)" }} />
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ color: "var(--text-main)" }}>{e.title}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {new Date(e.when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
              {isAdmin && (
                <button className="starbar-icon" style={{ width: 22, height: 22 }} onClick={() => removeEvent(e.id)}
                        aria-label="Remove event"><Trash2 size={11} /></button>
              )}
            </div>
          ))}
          {isAdmin && !adding && (
            <button className="or-chip mt-1" onClick={() => setAdding(true)} data-testid="realm-events-add">
              <CalendarPlus size={11} /> Add event
            </button>
          )}
        </div>
      )}
      {adding && (
        <div className="space-y-2 mt-2">
          <input className="or-input w-full text-sm" placeholder="Event title" value={title}
                 onChange={(e) => setTitle(e.target.value)} maxLength={80} data-testid="realm-events-title" />
          <input className="or-input w-full text-sm" type="datetime-local" value={when}
                 onChange={(e) => setWhen(e.target.value)} data-testid="realm-events-when" />
          <div className="flex gap-2">
            <button className="or-chip" disabled={saving || !title.trim() || !when} onClick={addEvent}
                    data-testid="realm-events-save">
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Add
            </button>
            <button className="or-chip" onClick={() => setAdding(false)}><X size={11} /> Cancel</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── Custom-registry / unsupported fallback ───────────────────────────
function RegistryOrUnsupported({ realmId, widget, isAdmin, onDeleted }) {
  const [state, setState] = useState({ loading: true, editorConfig: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/widgets/registry/${encodeURIComponent(widget.type)}`);
        if (!cancelled) setState({ loading: false, editorConfig: data?.widget?.editor_config || null });
      } catch { if (!cancelled) setState({ loading: false, editorConfig: null }); }
    })();
    return () => { cancelled = true; };
  }, [widget.type]);

  if (state.loading) {
    return (
      <section className="or-surface p-4 h-full flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}
               data-testid={`realm-widget-loading-${widget.id}`}>
        <Loader2 size={13} className="animate-spin" /> Loading widget…
      </section>
    );
  }
  if (state.editorConfig) {
    return (
      <section className="or-surface p-4 h-full" data-testid={`realm-widget-custom-${widget.id}`}>
        <CustomWidgetRenderer w={{ ...widget, editor_config: state.editorConfig }} />
      </section>
    );
  }
  return (
    <section className="or-surface p-4 h-full" data-testid={`realm-widget-unsupported-${widget.id}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} style={{ color: "#F4C84A" }} className="shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>
            "{widget.type}" isn't available in Realms yet
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            This widget type has no Realm data source. {isAdmin ? "Remove it or replace it from the library." : ""}
          </div>
          {isAdmin && (
            <button className="or-chip mt-2"
                    onClick={async () => {
                      try {
                        await apiClient.delete(`/communities/realm/${realmId}/widgets/${widget.id}`);
                        onDeleted?.(widget.id);
                      } catch { /* */ }
                    }}
                    data-testid={`realm-widget-remove-${widget.id}`}>
              <Trash2 size={11} /> Remove widget
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export default function RealmBuiltinWidget({ realmId, widget, isAdmin, onChanged, onDeleted }) {
  switch (widget.type) {
    case "announcements": return <AnnouncementsW realmId={realmId} widget={widget} isAdmin={isAdmin} onChanged={onChanged} />;
    case "rules":         return <RulesW widget={widget} />;
    case "notes":         return <NotesW realmId={realmId} widget={widget} isAdmin={isAdmin} onChanged={onChanged} />;
    case "countdown":     return <CountdownW realmId={realmId} widget={widget} isAdmin={isAdmin} onChanged={onChanged} />;
    case "calendar":      return <CalendarW widget={widget} />;
    case "top8":          return <TopMembersW realmId={realmId} widget={widget} />;
    case "events":        return <EventsW realmId={realmId} widget={widget} isAdmin={isAdmin} onChanged={onChanged} />;
    default:              return <RegistryOrUnsupported realmId={realmId} widget={widget} isAdmin={isAdmin} onDeleted={onDeleted} />;
  }
}
