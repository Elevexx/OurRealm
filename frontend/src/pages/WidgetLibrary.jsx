import React from "react";
import * as Icons from "lucide-react";
import { WIDGET_TYPES } from "@/data/mockData";

export default function WidgetLibrary() {
  return (
    <div className="max-w-6xl mx-auto" data-testid="widget-library-page">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Build your profile</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Widget Library</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Drop widgets onto your profile. Reorder, resize, and save layouts automatically.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {WIDGET_TYPES.map((w) => {
          const Icon = Icons[w.icon] || Icons.Sparkles;
          return (
            <div key={w.id} className="or-surface p-5" data-testid={`widget-lib-${w.id}`}>
              <div className="p-3 inline-flex rounded-full" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)" }}>
                <Icon size={22} style={{ color: "var(--primary)" }} />
              </div>
              <div className="mt-3 font-semibold" style={{ color: "var(--text-main)" }}>{w.label}</div>
              <div className="text-xs uppercase tracking-widest mt-1" style={{ color: "var(--text-muted)" }}>Default · {w.default_size}</div>
              <button className="or-btn w-full mt-4" style={{ padding: "0.45rem", fontSize: "0.8rem" }} data-testid={`widget-lib-add-${w.id}`}>
                Add to profile
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
