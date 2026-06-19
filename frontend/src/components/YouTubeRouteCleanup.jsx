/**
 * Route-change cleanup for YouTube players.
 *
 * Mounted once in the app shell. Watches `useLocation()`; on every
 * pathname change it calls `cleanupYouTubePlayers()` to stop & destroy
 * every active YT.Player so audio cannot continue from /feed or /foryou
 * after the user navigates to /home, /discover, /sounds, /friends,
 * /profile, /messages, or any other route.
 *
 * Renders nothing.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { cleanupYouTubePlayers } from "@/lib/youtube";

export default function YouTubeRouteCleanup() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Skip the very first run (no previous route to clean up). After
    // that, every navigation calls the cleanup.
    return () => {
      cleanupYouTubePlayers();
    };
  }, [pathname]);
  return null;
}
