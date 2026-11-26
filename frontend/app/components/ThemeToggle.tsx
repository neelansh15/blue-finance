"use client";

import { useEffect, useRef, useState } from "react";
import { DARK_SCHEME_QUERY, THEME_COLORS, THEME_KEY } from "../theme";

type Theme = keyof typeof THEME_COLORS;

function readPreference(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById("dawn-theme-color")?.setAttribute("content", THEME_COLORS[theme]);
}

export default function ThemeToggle() {
  const preference = useRef<Theme | null>(null);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const system = window.matchMedia(DARK_SCHEME_QUERY);
    function syncTheme() {
      const next = preference.current ?? (system.matches ? "dark" : "light");
      applyTheme(next);
      setTheme(next);
    }

    function syncStorage(event: StorageEvent) {
      if (event.key === THEME_KEY || event.key === null) {
        preference.current = readPreference();
        syncTheme();
      }
    }

    preference.current = readPreference();
    syncTheme();
    system.addEventListener("change", syncTheme);
    window.addEventListener("storage", syncStorage);
    return () => {
      system.removeEventListener("change", syncTheme);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    preference.current = next;
    applyTheme(next);
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // The selected theme still applies while storage is unavailable.
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label="Dark mode"
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
    >
      <svg className="theme-moon" width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M20.5 15.2a8.6 8.6 0 0 1-11.7-11.7 8.7 8.7 0 1 0 11.7 11.7Z" />
      </svg>
      <svg className="theme-sun" width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1m0-15.6-2.1 2.1M6.3 17.7l-2.1 2.1" />
      </svg>
    </button>
  );
}
