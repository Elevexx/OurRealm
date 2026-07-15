import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const MODES = ["neon", "business", "millennium", "stealth"];
const STORAGE_KEY = "ourrealm.mode";
const COLORS_KEY = "ourrealm.customColors"; // per-mode accent overrides

function readCustomColors() {
  try { return JSON.parse(localStorage.getItem(COLORS_KEY) || "{}"); } catch { return {}; }
}

const ThemeContext = createContext({
  mode: "neon",
  setMode: () => {},
  modes: MODES,
  customColors: {},
  setCustomColor: () => {},
  resetCustomColors: () => {},
});

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    try {
      let stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "cypher") stored = "neon"; // migration
      return MODES.includes(stored) ? stored : "neon";
    } catch {
      return "neon";
    }
  });
  const [allCustom, setAllCustom] = useState(readCustomColors);
  const customColors = allCustom[mode] || {};

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  // Apply per-mode accent overrides as inline CSS variables (they win over
  // every mode stylesheet). Removing the property restores mode defaults.
  useEffect(() => {
    const root = document.documentElement.style;
    ["primary", "secondary"].forEach((key) => {
      const val = customColors[key];
      if (val) root.setProperty(`--${key}`, val);
      else root.removeProperty(`--${key}`);
    });
  }, [mode, customColors.primary, customColors.secondary]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMode = useCallback((next) => {
    if (next === "cypher") next = "neon";
    if (MODES.includes(next)) setModeState(next);
  }, []);

  const setCustomColor = useCallback((key, value) => {
    setAllCustom((prev) => {
      const next = { ...prev, [mode]: { ...(prev[mode] || {}), [key]: value } };
      try { localStorage.setItem(COLORS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [mode]);

  const resetCustomColors = useCallback(() => {
    setAllCustom((prev) => {
      const next = { ...prev };
      delete next[mode];
      try { localStorage.setItem(COLORS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [mode]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, modes: MODES, customColors, setCustomColor, resetCustomColors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
export { MODES };
