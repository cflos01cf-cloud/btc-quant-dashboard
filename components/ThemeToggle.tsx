"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !isLight;
    setIsLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("btc-dashboard-theme", next ? "light" : "dark");
    } catch {
      /* localStorage unavailable (private mode) — theme just won't persist */
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label="Cambiar tema claro/oscuro"
      className="h-9 w-9 rounded-lg border border-edge bg-surface flex items-center justify-center text-ink-300 hover:text-bitcoin transition-colors"
    >
      {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
