import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const MODES = ["neon", "business", "millennium", "stealth"];
const STORAGE_KEY = "ourrealm.mode";

const ThemeContext = createContext({
  mode: "neon",
  setMode: () => {},
  modes: MODES,
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

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const setMode = useCallback((next) => {
    if (next === "cypher") next = "neon";
    if (MODES.includes(next)) setModeState(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, setMode, modes: MODES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
export { MODES };
