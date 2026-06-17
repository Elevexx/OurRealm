/**
 * Phase C — Presence Context.
 *
 * Wraps the WebSocket layer so any component can:
 *   const { statuses, myStatus, setMyStatus } = usePresence();
 *
 *   statuses[user_id] === "live" | "online" | "messenger" | "offline"
 *
 * `presence_status_choice` ("invisible" included) is the user PREFERENCE.
 * Public-facing status (what others see) maps invisible -> offline.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import presenceSocket from "@/lib/presenceSocket";

const PresenceContext = createContext({
  statuses: {},
  myStatus: "online",
  setMyStatus: async () => {},
});

const USER_PICKABLE = ["live", "online", "invisible"];

export function PresenceProvider({ children }) {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState({});      // user_id -> status string
  const [myStatus, setMyStatusState] = useState(
    () => user?.presence_status_choice || "online"
  );
  const tokenRef = useRef(null);

  // Keep the local pick mirrored to the latest user object.
  useEffect(() => {
    if (user?.presence_status_choice) {
      setMyStatusState(user.presence_status_choice);
    }
  }, [user?.presence_status_choice]);

  // Open / close the socket based on auth state.
  useEffect(() => {
    if (!user?.id) {
      presenceSocket.disconnect();
      tokenRef.current = null;
      setStatuses({});
      return undefined;
    }
    const token = (() => {
      try { return localStorage.getItem("ourrealm.access"); } catch { return null; }
    })();
    if (!token) return undefined;
    tokenRef.current = token;

    const unsub = presenceSocket.connect({
      token,
      onUpdate: (msg) => {
        if (!msg?.user_id) return;
        setStatuses((prev) => ({ ...prev, [msg.user_id]: msg.status }));
      },
      onHello: () => {
        // hydrate friends presence list once the socket is up
        refreshFriendsPresence();
      },
    });
    // initial fetch (in case hello arrives before subscription is wired)
    refreshFriendsPresence();
    return () => {
      unsub?.();
      presenceSocket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const refreshFriendsPresence = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/presence/friends");
      const next = {};
      for (const f of data?.friends || []) {
        if (f.id) next[f.id] = f.presence_status || "offline";
      }
      setStatuses((prev) => ({ ...prev, ...next }));
    } catch { /* silent — user may be offline / unauth */ }
  }, []);

  const setMyStatus = useCallback(async (next) => {
    if (!USER_PICKABLE.includes(next)) return;
    setMyStatusState(next);
    try { await apiClient.patch("/users/status", { status: next }); } catch { /* */ }
    // Also push through the live socket so peers see it instantly.
    presenceSocket.setStatus(next);
  }, []);

  const value = useMemo(() => ({
    statuses,
    myStatus,
    setMyStatus,
    refreshFriendsPresence,
  }), [statuses, myStatus, setMyStatus, refreshFriendsPresence]);

  return (
    <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
  );
}

export const usePresence = () => useContext(PresenceContext);
