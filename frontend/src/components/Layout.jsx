import React from "react";
import TopStarBar from "@/components/TopStarBar";
import BottomNav from "@/components/BottomNav";

/**
 * Global app shell:
 * - Sticky TopStarBar at the top (logo + ⭐ 🎵 🔔 ✉️ 💲 👤)
 * - BottomNav fixed at the bottom (🏠 🔎 ✨ ➕ 💰 👥 👤)
 * - Pages render between them with appropriate bottom padding.
 */
export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ position: "relative" }}>
      <TopStarBar />
      <main
        className="flex-1 min-w-0 px-3 sm:px-6 lg:px-8 py-5"
        style={{ paddingBottom: 110 }}
        data-testid="page-main"
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
