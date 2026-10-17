import { useEffect, useRef } from "react";

/**
 * Makes the browser's back and forward buttons move between the app's screens.
 * `state` is everything that decides what is on screen (screen name, open item ids). Each change pushes a history entry holding a
 * copy of it; going back hands the old copy to `restore`. The address bar is not changed (no deep links yet), and a reload still
 * starts at the first screen. `replace` says a change should overwrite the current entry instead of adding one (sign-in screens).
 */
export function useBrowserHistory<T extends object>(state: T, restore: (s: T) => void, replace = false): void {
  const key = JSON.stringify(state);
  const last = useRef<string | null>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = (e: PopStateEvent) => {
      const saved = (e.state as { rr?: T } | null)?.rr;
      if (!saved) return;
      last.current = JSON.stringify(saved);
      restoreRef.current(saved);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || key === last.current) return;
    const first = last.current === null;
    last.current = key;
    try {
      const entry = { ...(window.history.state ?? {}), rr: JSON.parse(key) as T };
      if (first || replace) window.history.replaceState(entry, "");
      else window.history.pushState(entry, "");
    } catch { /* history can be blocked (some embedded views); the app still works without it */ }
  }, [key, replace]);
}
