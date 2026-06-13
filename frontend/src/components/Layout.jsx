import React from "react";
import TopStarBar from "@/components/TopStarBar";
import BottomNav from "@/components/BottomNav";

/**
 * Global app shell:
 * - Sticky TopStarBar at the top
 * - BottomNav fixed at the bottom
 * - Pages render between them with safe-area aware padding so notched
 *   iPhones and Android gesture-bar devices don't clip content.
 */
export default function Layout({ children }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        position: "relative",
        maxWidth: "100vw",
        overflowX: "hidden",
      }}
    >
      <TopStarBar />
      <main
        className="flex-1 px-3 sm:px-5 lg:px-8 py-4 sm:py-6 or-min0"
        style={{
          maxWidth: "100vw",
          paddingLeft: "max(0.75rem, env(safe-area-inset-left, 0px))",
          paddingRight: "max(0.75rem, env(safe-area-inset-right, 0px))",
          paddingBottom: "calc(110px + env(safe-area-inset-bottom, 0px))",
        }}
        data-testid="page-main"
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
