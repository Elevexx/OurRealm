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
    } catch {
      setUser(null);
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
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  }, [setGuest]);

  const register = useCallback(async (email, password, name, username) => {
    try {
      const { data } = await apiClient.post("/auth/register", { email, password, name, username });
      persistToken(data.access_token);
      setUser(data.user);
      setGuest(false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  }, [setGuest]);

  const logout = useCallback(async () => {
    try { await apiClient.post("/auth/logout"); } catch { /* ignore */ }
    try { localStorage.removeItem("ourrealm.access"); } catch { /* ignore */ }
    setUser(null);
    setGuest(false);
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
      value={{ user, isLoading, isGuest, login, register, logout, setGuest, updateProfile, refreshMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
