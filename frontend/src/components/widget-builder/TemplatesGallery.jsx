/**
 * TemplatesGallery — modal that lists predefined templates the
 * founder can clone into a new draft custom widget. Pulls from
 * /api/admin/widgets/templates. Selecting one calls onPick(template).
 */
import React, { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";
import { CATEGORY_GROUPS } from "@/lib/widgetBuilder";

export default function TemplatesGallery({ open, onClose, onPick, onScratch }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await apiClient.get("/admin/widgets/templates");
        if (!cancelled) setTemplates(data?.templates || []);
      } catch (e) { console.error(e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
      data-testid="templates-gallery"
    >
      <div className="or-surface w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>Pick a starting point</h2>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose}><Icons.X size={14} /></button>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          Start from a template (pre-filled layout + fields) or build from a blank canvas. Every new widget lands as a <b>draft</b> until you launch it.
        </p>

        <button
          className="or-surface w-full p-4 text-left mb-4 transition-transform hover:-translate-y-0.5"
          style={{ background: "var(--surface-2)", outline: "1px dashed var(--primary)" }}
          onClick={onScratch}
          data-testid="templates-blank"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-md p-2" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)" }}>
              <Icons.Plus size={20} style={{ color: "var(--primary)" }} />
            </div>
            <div>
              <div className="font-semibold text-sm" style={{ color: "var(--text-main)" }}>Blank Canvas</div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Pick your own layout, fields, and content from scratch.</div>
            </div>
          </div>
        </button>

        {loading ? (
          <div className="text-center p-8"><Icons.Loader2 className="animate-spin inline" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((t) => {
              const Icon = Icons[t.icon] || Icons.Sparkles;
              const cat = CATEGORY_GROUPS.find((c) => c.key === t.category_group);
              return (
                <button
                  key={t.key}
                  className="or-surface p-4 text-left transition-transform hover:-translate-y-0.5"
                  style={{ background: "var(--surface-2)" }}
                  onClick={() => onPick(t)}
                  data-testid={`template-${t.key}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={20} style={{ color: cat?.color || "var(--primary)" }} />
                    <span className="font-semibold text-sm" style={{ color: "var(--text-main)" }}>{t.name}</span>
                  </div>
                  <div className="text-[11px] leading-snug mb-2" style={{ color: "var(--text-muted)" }}>
                    {t.description}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)", color: "var(--primary)" }}>
                      {t.layout}
                    </span>
                    {cat && (
                      <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ background: `${cat.color}22`, color: cat.color }}>
                        {cat.label}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
