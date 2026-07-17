"use client";

import * as React from "react";
import { useEngineStore } from "@/store/engine-store";
import { useNativeNotifications } from "@/hooks/use-native-notifications";

function applyStoredTheme(themePreference?: "light" | "dark" | "natural") {
  if (typeof document === "undefined") {
    return;
  }

  const storedTheme = window.localStorage.getItem("studyflow-theme") ?? themePreference ?? "natural";
  document.documentElement.classList.remove("light", "dark", "natural");

  if (storedTheme === "natural") {
    document.documentElement.classList.add("natural");
    return;
  }

  document.documentElement.classList.add(storedTheme);
}

export function AppRuntime() {
  const initialize = useEngineStore((state) => state.initialize);
  const refreshView = useEngineStore((state) => state.refreshView);
  const theme = useEngineStore((state) => state.settings.theme);

  // Initialize native notifications in desktop mode
  useNativeNotifications();

  React.useEffect(() => {
    void initialize();
  }, [initialize]);

  React.useEffect(() => {
    applyStoredTheme(theme);
  }, [theme]);

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshView();
    }, 30_000);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refreshView();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [refreshView]);

  React.useEffect(() => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (isTauri || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return;
    }

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  React.useEffect(() => {
    const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
    if (!isTauri) return;

    // Prevent default context menu (right click)
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
    };

    // Prevent zoom hotkeys and standard browser shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Disable F5, Ctrl+R, Command+R (reload) in production
      if (
        e.key === "F5" || 
        ((e.ctrlKey || e.metaKey) && e.key === "r") || 
        ((e.ctrlKey || e.metaKey) && e.key === "R")
      ) {
        if (process.env.NODE_ENV === "production") {
          e.preventDefault();
        }
      }

      // Disable Ctrl+P / Command+P (print)
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
      }

      // Disable zoom key combinations
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "-" || e.key === "0" || e.key === "+")) {
        e.preventDefault();
      }
    };

    // Prevent pinch-zoom on trackpads
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("wheel", handleWheel);
    };
  }, []);

  return null;
}
