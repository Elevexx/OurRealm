import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { INTERESTS } from "@/data/mockData";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "ourrealm.interests";

export default function Home() {
  const navigate = useNavigate();
  const { user, isGuest, updateProfile } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return new Set(stored);
    } catch { return new Set(); }
  });

  useEffect(() => {
    if (user?.interests?.length) setSelected(new Set(user.interests));
  }, [user]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const continueToFeed = async () => {
    const arr = [...selected];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
    if (user && !isGuest) await updateProfile({ interests: arr });
    navigate("/feed");
  };

  const visible = showAll ? INTERESTS : INTERESTS.slice(0, 16);

  return (
    <div className="max-w-6xl mx-auto" data-testid="home-page">
      <div className="mb-7">
        <div className="text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "var(--text-muted)" }}>
          Step 01 · Personalize
        </div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
          Pick your interests
        </h1>
        <p className="mt-2 text-sm sm:text-base" style={{ color: "var(--text-muted)" }}>
          We'll tune your Realm to deliver the music, creators, and worlds you care about.
          You can change these anytime.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
        {visible.map((it) => {
          const Icon = Icons[it.icon] || Icons.Sparkles;
          const active = selected.has(it.id);
          return (
            <button
              key={it.id}
              data-testid={`interest-${it.id}`}
              onClick={() => toggle(it.id)}
              className="or-surface p-4 sm:p-5 text-left transition-all duration-200"
              style={{
                outline: active ? "2px solid var(--primary)" : "none",
                background: active
                  ? "color-mix(in srgb, var(--primary) 18%, var(--surface))"
                  : "var(--surface)",
                transform: active ? "translateY(-2px)" : "none",
              }}
            >
              <Icon size={22} style={{ color: active ? "var(--primary)" : "var(--text-muted)" }} />
              <div className="mt-3 font-semibold text-base" style={{ color: "var(--text-main)" }}>
                {it.label}
              </div>
              <div className="text-[11px] mt-1 uppercase tracking-widest" style={{ color: active ? "var(--primary)" : "var(--text-muted)" }}>
                {active ? "Selected" : "Tap to add"}
              </div>
            </button>
          );
        })}
      </div>

      {!showAll && (
        <div className="flex justify-center mt-5">
          <button className="or-chip" onClick={() => setShowAll(true)} data-testid="home-view-more">
            View more interests ({INTERESTS.length - 16}+)
          </button>
        </div>
      )}

      <div className="sticky bottom-4 mt-8 flex justify-center">
        <div className="or-surface px-5 py-3 flex items-center gap-4">
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            <span style={{ color: "var(--primary)", fontWeight: 700 }}>{selected.size}</span> selected
          </div>
          <button
            data-testid="home-continue"
            className="or-btn"
            onClick={continueToFeed}
            disabled={selected.size === 0}
            style={{ opacity: selected.size === 0 ? 0.5 : 1 }}
          >
            Continue to For You
          </button>
        </div>
      </div>
    </div>
  );
}
