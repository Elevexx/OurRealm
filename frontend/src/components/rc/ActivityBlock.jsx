import React, { useRef, useState } from "react";
import { Check, X, ArrowUp, ArrowDown, Eye, Film } from "lucide-react";

// ActivityBlock — REAL interactive lesson blocks (tap_select, matching,
// ordering, short_answer, reflection, scenario, checklist, video_embed).
// Nothing here is a mockup: every element responds and gives feedback.
const C = { ok: "var(--brand-green, #10E670)", bad: "#FF6B6B", accent: "#2EE6FF" };

function Shell({ title, body, color = C.accent, children, testid }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", borderLeft: `3px solid ${color}` }} data-testid={testid}>
      {title && <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color }}>{title}</div>}
      {body && <div className="text-xs mb-2 whitespace-pre-wrap">{body}</div>}
      {children}
    </div>
  );
}

function TapSelect({ b }) {
  const [picked, setPicked] = useState(null);
  return (
    <Shell title={b.title || "Tap the answer"} body={b.body} testid="block-tap-select">
      <div className="grid gap-1.5">
        {(b.options || []).map((o, i) => {
          const chosen = picked === i;
          const showState = picked !== null;
          const correct = i === b.answer_index;
          return (
            <button key={i} className="text-left text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-2"
              style={{ background: showState && chosen ? (correct ? "rgba(16,230,112,0.15)" : "rgba(255,107,107,0.12)") : "rgba(255,255,255,0.05)",
                       border: chosen ? `1px solid ${correct ? C.ok : C.bad}` : "1px solid transparent" }}
              onClick={() => setPicked(i)} data-testid={`tap-opt-${i}`}>
              {showState && chosen && (correct ? <Check size={12} color={C.ok} /> : <X size={12} color={C.bad} />)}
              {o}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="text-[11px] mt-2" style={{ color: picked === b.answer_index ? C.ok : C.bad }}>
          {picked === b.answer_index ? "Correct! " : "Not quite — try again. "}
          {picked === b.answer_index && b.explanation}
        </div>
      )}
    </Shell>
  );
}

function Matching({ b }) {
  const pairs = b.pairs || [];
  const [rights] = useState(() => [...pairs.map((p) => p.right)].sort(() => Math.random() - 0.5));
  const [sel, setSel] = useState(null);
  const [matched, setMatched] = useState({});
  const [wrong, setWrong] = useState(null);
  const pick = (side, val) => {
    if (side === "L") { setSel(val); setWrong(null); return; }
    if (sel === null) return;
    const pair = pairs.find((p) => p.left === sel);
    if (pair?.right === val) setMatched((m) => ({ ...m, [sel]: val }));
    else setWrong(val);
    setSel(null);
  };
  const done = Object.keys(matched).length === pairs.length;
  return (
    <Shell title={b.title || "Match the pairs"} body={b.body} color="#C26BFF" testid="block-matching">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1.5">
          {pairs.map((p) => (
            <button key={p.left} disabled={!!matched[p.left]}
              className="w-full text-left text-[11px] px-2 py-1.5 rounded-lg"
              style={{ background: matched[p.left] ? "rgba(16,230,112,0.12)" : sel === p.left ? "rgba(46,160,255,0.2)" : "rgba(255,255,255,0.05)",
                       border: sel === p.left ? "1px solid var(--brand-blue)" : "1px solid transparent" }}
              onClick={() => pick("L", p.left)}>{matched[p.left] ? "✓ " : ""}{p.left}</button>
          ))}
        </div>
        <div className="space-y-1.5">
          {rights.map((r) => {
            const used = Object.values(matched).includes(r);
            return (
              <button key={r} disabled={used}
                className="w-full text-left text-[11px] px-2 py-1.5 rounded-lg"
                style={{ background: used ? "rgba(16,230,112,0.12)" : wrong === r ? "rgba(255,107,107,0.12)" : "rgba(255,255,255,0.05)" }}
                onClick={() => pick("R", r)}>{used ? "✓ " : ""}{r}</button>
            );
          })}
        </div>
      </div>
      {done && <div className="text-[11px] mt-2 font-bold" style={{ color: C.ok }}>All matched — nice work! 🎉</div>}
    </Shell>
  );
}

function Ordering({ b }) {
  const correct = b.items || [];
  const [items, setItems] = useState(() => [...correct].sort(() => Math.random() - 0.5));
  const [checked, setChecked] = useState(false);
  const move = (i, d) => {
    const n = [...items];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setItems(n); setChecked(false);
  };
  const allRight = items.every((it, i) => it === correct[i]);
  return (
    <Shell title={b.title || "Put in order"} body={b.body} color="#F4A73B" testid="block-ordering">
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={it} className="flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg"
            style={{ background: checked ? (it === correct[i] ? "rgba(16,230,112,0.12)" : "rgba(255,107,107,0.1)") : "rgba(255,255,255,0.05)" }}>
            <span className="font-bold" style={{ color: "#F4A73B" }}>{i + 1}.</span>
            <span className="flex-1">{it}</span>
            <button onClick={() => move(i, -1)} aria-label="Move up" className="or-btn or-btn-ghost p-0.5"><ArrowUp size={11} /></button>
            <button onClick={() => move(i, 1)} aria-label="Move down" className="or-btn or-btn-ghost p-0.5"><ArrowDown size={11} /></button>
          </div>
        ))}
      </div>
      <button className="or-btn text-[11px] mt-2" onClick={() => setChecked(true)} data-testid="ordering-check">Check order</button>
      {checked && <span className="text-[11px] ml-2 font-bold" style={{ color: allRight ? C.ok : C.bad }}>{allRight ? "Perfect order! 🎉" : "Not yet — keep arranging."}</span>}
    </Shell>
  );
}

function ShortAnswer({ b }) {
  const [text, setText] = useState("");
  const [showSample, setShowSample] = useState(false);
  return (
    <Shell title={b.title || "Your answer"} body={b.body} testid="block-short-answer">
      <textarea className="or-input text-xs w-full" rows={3} placeholder="Write your answer…"
        value={text} onChange={(e) => setText(e.target.value)} />
      {b.sample_answer && text.trim().length > 10 && (
        <button className="or-btn or-btn-ghost text-[10px] mt-1 inline-flex items-center gap-1"
          onClick={() => setShowSample(!showSample)}><Eye size={11} /> {showSample ? "Hide" : "Compare with"} example answer</button>
      )}
      {showSample && <div className="text-[11px] mt-1 p-2 rounded-lg" style={{ background: "rgba(16,230,112,0.08)" }}>{b.sample_answer}</div>}
    </Shell>
  );
}

function Scenario({ b }) {
  const [picked, setPicked] = useState(null);
  return (
    <Shell title={b.title || "What would you do?"} body={b.body} color="#C26BFF" testid="block-scenario">
      <div className="grid gap-1.5">
        {(b.options || []).map((o, i) => (
          <button key={i} className="text-left text-xs px-2.5 py-1.5 rounded-lg"
            style={{ background: picked === i ? "rgba(194,107,255,0.15)" : "rgba(255,255,255,0.05)",
                     border: picked === i ? "1px solid #C26BFF" : "1px solid transparent" }}
            onClick={() => setPicked(i)}>{o.text}</button>
        ))}
      </div>
      {picked !== null && (
        <div className="text-[11px] mt-2 p-2 rounded-lg" style={{ background: "rgba(194,107,255,0.08)" }}>
          {b.options[picked]?.outcome}
        </div>
      )}
    </Shell>
  );
}

function Checklist({ b }) {
  const [done, setDone] = useState({});
  return (
    <Shell title={b.title || "Checklist"} body={b.body} color={C.ok} testid="block-checklist">
      {(b.items || []).map((it, i) => (
        <label key={i} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
          <input type="checkbox" checked={!!done[i]} onChange={() => setDone({ ...done, [i]: !done[i] })} />
          <span style={{ textDecoration: done[i] ? "line-through" : "none", opacity: done[i] ? 0.6 : 1 }}>{it}</span>
        </label>
      ))}
    </Shell>
  );
}

const INTERACTIVE_TYPES = ["tap_select", "matching", "ordering", "short_answer", "reflection", "scenario", "checklist", "video_embed"];

export function isInteractiveBlock(b) {
  return INTERACTIVE_TYPES.includes(b?.type);
}

function ResumableVideo({ b }) {
  const ref = useRef(null);
  const key = `orv-pos-${b.id}`;
  return (
    <video controls playsInline ref={ref} className="w-full rounded-xl"
      src={b.video_url} poster={b.video_thumbnail || undefined} style={{ maxHeight: 320 }}
      onLoadedMetadata={() => {
        const t = Number(sessionStorage.getItem(key) || 0);
        if (t > 1 && ref.current && t < (ref.current.duration || 0) - 1) ref.current.currentTime = t;
      }}
      onTimeUpdate={() => { if (ref.current) sessionStorage.setItem(key, String(ref.current.currentTime)); }}
      data-testid="lesson-video-player" />
  );
}

export default function ActivityBlock({ b }) {
  if (b.type === "tap_select" && (b.options || []).length >= 2) return <TapSelect b={b} />;
  if (b.type === "matching" && (b.pairs || []).length >= 2) return <Matching b={b} />;
  if (b.type === "ordering" && (b.items || []).length >= 3) return <Ordering b={b} />;
  if (b.type === "short_answer" || b.type === "reflection") return <ShortAnswer b={b} />;
  if (b.type === "scenario" && (b.options || []).length >= 2) return <Scenario b={b} />;
  if (b.type === "checklist" && (b.items || []).length) return <Checklist b={b} />;
  if (b.type === "video_embed") {
    if (b.video_url) {
      return (
        <Shell title={b.title || "Video"} body={b.body} testid="block-video">
          <ResumableVideo b={b} />
          {b.video_caption && (
            <div className="text-[9px] mt-1" style={{ opacity: 0.6 }} data-testid="video-caption">{b.video_caption}</div>
          )}
        </Shell>
      );
    }
    return (
      <Shell title={b.title || "Video"} body={b.body} testid="block-video-placeholder">
        <div className="rounded-xl flex flex-col items-center justify-center py-8 px-3 text-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.22)" }}>
          <Film size={22} style={{ opacity: 0.5 }} />
          <div className="text-[11px] mt-2 font-semibold" style={{ opacity: 0.75 }}>Video placeholder</div>
          <div className="text-[10px] mt-0.5" style={{ opacity: 0.55 }}>
            Real video generation isn't connected yet — this space is reserved for the video described above.
          </div>
        </div>
      </Shell>
    );
  }
  // Honest fallback: render as plain content, never fake interactivity.
  return <Shell title={b.title} body={b.body} testid="block-fallback" />;
}
