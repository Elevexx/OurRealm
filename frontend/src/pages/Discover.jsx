import React, { useMemo, useRef } from "react";
import * as Icons from "lucide-react";
import { DISCOVER_ROWS, makeMockPosts } from "@/data/mockData";

function Row({ id, title, icon, items }) {
  const Icon = Icons[icon] || Icons.Sparkles;
  const scrollerRef = useRef(null);
  const scrollBy = (dir) => scrollerRef.current?.scrollBy({ left: dir * 360, behavior: "smooth" });
  return (
    <section className="mb-9" data-testid={`discover-row-${id}`}>
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="flex items-center gap-2 text-xl sm:text-2xl" style={{ fontFamily: "var(--font-display)" }}>
          <Icon size={20} style={{ color: "var(--primary)" }} /> {title}
        </h2>
        <div className="flex gap-2">
          <button className="or-chip" onClick={() => scrollBy(-1)} data-testid={`discover-${id}-prev`}><Icons.ChevronLeft size={14} /></button>
          <button className="or-chip" onClick={() => scrollBy(1)} data-testid={`discover-${id}-next`}><Icons.ChevronRight size={14} /></button>
        </div>
      </div>
      <div ref={scrollerRef} className="flex gap-4 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1 snap-x">
        {items.map((p) => (
          <div
            key={`${id}-${p.id}`}
            className="or-surface shrink-0 overflow-hidden snap-start"
            style={{ width: 280, height: 360 }}
            data-testid={`discover-card-${id}-${p.id}`}
          >
            <div className="relative h-2/3 overflow-hidden">
              <img src={p.media_url} alt="" className="w-full h-full object-cover transition-transform duration-700 hover:scale-105" />
              <span className="absolute top-3 left-3 px-2 py-0.5 text-[10px] tracking-widest uppercase"
                style={{ background: "var(--primary)", color: "var(--primary-fg)", borderRadius: 4 }}>
                {p.media_type}
              </span>
            </div>
            <div className="p-3 h-1/3 flex flex-col justify-between">
              <div className="text-sm font-semibold line-clamp-2" style={{ color: "var(--text-main)" }}>@{p.author_name}</div>
              <div className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>{p.content}</div>
              <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--primary)" }}>
                ♥ {p.likes.toLocaleString()} · {p.comments}c
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Discover() {
  const pool = useMemo(() => makeMockPosts(40), []);
  return (
    <div className="max-w-7xl mx-auto" data-testid="discover-page">
      <div className="mb-7">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Explore</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Discover</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Endless rows. Real momentum. Find what's rising before anyone else.
        </p>
      </div>
      {DISCOVER_ROWS.map((row, idx) => (
        <Row
          key={row.id}
          {...row}
          items={pool.slice(idx * 3, idx * 3 + 10).concat(pool.slice(0, 10)).slice(0, 10)}
        />
      ))}
    </div>
  );
}
