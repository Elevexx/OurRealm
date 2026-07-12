import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import apiClient, { formatApiErrorDetail } from "@/api/client";

const AuthContext = createContext({
  user: null,
  isLoading: true,
  isGuest: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  setGuest: () => {},
  updateProfile: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuestState] = useState(() => {
    try { return localStorage.getItem("ourrealm.guest") === "1"; } catch { return false; }
  });
  // Phase-Restore — populated when login (or refreshMe) detects the
  // user is in the 30-day pending-deletion window. App.js renders the
  // restore prompt route gate while this is non-null.
  const [pendingDeletion, setPendingDeletion] = useState(null);

  const setGuest = useCallback((v) => {
    setIsGuestState(v);
    try {
      if (v) localStorage.setItem("ourrealm.guest", "1");
      else localStorage.removeItem("ourrealm.guest");
    } catch { /* ignore */ }
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/auth/me");
      setUser(data.user);
      setGuest(false);
      // Detect pending-deletion on any refresh (e.g. page reload while
      // the restore window is still open).
      if (data.user?.account_status === "deleted_pending_restore") {
        try {
          const { data: ds } = await apiClient.get("/profile/deletion-status");
          setPendingDeletion(ds?.pending_deletion || { account_status: "deleted_pending_restore" });
        } catch { setPendingDeletion({ account_status: "deleted_pending_restore" }); }
      } else {
        setPendingDeletion(null);
      }
    } catch {
      setUser(null);
      setPendingDeletion(null);
    } finally {
      setIsLoading(false);
    }
  }, [setGuest]);

  useEffect(() => { refreshMe(); }, [refreshMe]);

  const persistToken = (tok) => {
    try { if (tok) localStorage.setItem("ourrealm.access", tok); } catch { /* ignore */ }
  };

  const login = useCallback(async (email, password) => {
    try {
      const { data } = await apiClient.post("/auth/login", { email, password });
      persistToken(data.access_token);
      setUser(data.user);
      setGuest(false);
      if (data.restore_required) {
        setPendingDeletion(data.pending_deletion || { account_status: "deleted_pending_restore" });
      } else {
        setPendingDeletion(null);
      }
      return { ok: true, restoreRequired: !!data.restore_required };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  }, [setGuest]);

  const register = useCallback(async (email, password, name, username, compliance = {}) => {
    try {
      const { data } = await apiClient.post("/auth/register", {
        email, password, name, username,
        accepted_terms: !!compliance.accepted_terms,
        accepted_privacy: !!compliance.accepted_privacy,
        accepted_conditions: !!compliance.accepted_conditions,
        age_confirmed_13: !!compliance.age_confirmed_13,
        policy_version: compliance.policy_version || "2026-02-1",
      });
      persistToken(data.access_token);
      setUser(data.user);
      setGuest(false);
      return { ok: true };
    } catch (e) {
      if (!e.response) {
        return { ok: false, error: "Network connection problem — please check your internet and try again." };
      }
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  }, [setGuest]);

  const logout = useCallback(async () => {
    // Phase H — fully clear ALL client-side authentication state. The
    // server clears its httpOnly cookies; we also wipe every OurRealm
    // localStorage / sessionStorage key, plus any non-httpOnly cookie
    // the browser happens to have for this origin.
    try { await apiClient.post("/auth/logout"); } catch { /* ignore */ }
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("ourrealm.")) localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
    try {
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith("ourrealm.")) sessionStorage.removeItem(k);
      }
    } catch { /* ignore */ }
    try {
      // Best-effort wipe of any non-httpOnly cookie still on the page.
      document.cookie.split(";").forEach((c) => {
        const name = c.split("=")[0].trim();
        if (!name) return;
        document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      });
    } catch { /* ignore */ }
    setUser(null);
    setGuest(false);
    setPendingDeletion(null);
  }, [setGuest]);

  const updateProfile = useCallback(async (patch) => {
    try {
      const { data } = await apiClient.patch("/profile/me", patch);
      setUser(data.user);
      return { ok: true, user: data.user };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user, isLoading, isGuest, login, register, logout, setGuest, updateProfile, refreshMe,
        pendingDeletion, setPendingDeletion,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
