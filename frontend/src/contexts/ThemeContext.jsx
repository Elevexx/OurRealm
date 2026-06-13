import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const MODES = ["cypher", "business", "millennium", "stealth"];
const STORAGE_KEY = "ourrealm.mode";

const ThemeContext = createContext({
  mode: "cypher",
  setMode: () => {},
  modes: MODES,
});

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return MODES.includes(stored) ? stored : "cypher";
    } catch {
      return "cypher";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const setMode = useCallback((next) => {
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
