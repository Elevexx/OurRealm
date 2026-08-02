import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

// OurRealm Global Access Control — client mirror of the SERVER-ENFORCED
// feature modes. Drives navigation hiding, View-Only banners, maintenance
// screens and locked screens. Fails OPEN visually (backend still blocks).
const OPEN = { mode: "full_access", visible: true, can_read: true, can_write: true, screen: "normal", message: "", bypass: false };

const AccessControlContext = createContext({
  features: {},
  loading: true,
  refresh: () => {},
  getState: () => OPEN,
});

export function AccessControlProvider({ children }) {
  const { user } = useAuth();
  const [features, setFeatures] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/access-control/status");
      setFeatures(data?.features || {});
    } catch {
      setFeatures({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh, user?.id]);

  const getState = useCallback(
    (key) => features[key] || { ...OPEN, key },
    [features]
  );

  return (
    <AccessControlContext.Provider value={{ features, loading, refresh, getState }}>
      {children}
    </AccessControlContext.Provider>
  );
}

export const useAccessControl = () => useContext(AccessControlContext);
