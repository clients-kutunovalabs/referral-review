import { useEffect, useRef } from "react";

/** What the address looks like: `#/mytasks`, or `#/ticket?ticketId=abc` when an item is open. Only plain strings, never shown as HTML. */
export type NavState = { screen: string } & Record<string, string>;

export function toHash(s: NavState, skip: (screen: string) => boolean, urlScreen: (screen: string) => string, urlKeys: (screen: string) => readonly string[]): string {
  if (skip(s.screen)) return window.location.pathname + window.location.search; // sign-in screens have no address of their own
  const q = new URLSearchParams();
  for (const k of urlKeys(s.screen)) if (s[k]) q.set(k, s[k]);
  const qs = q.toString();
  return `#/${urlScreen(s.screen)}${qs ? "?" + qs : ""}`;
}

export function fromHash(hash: string): Record<string, string> | null {
  const m = /^#\/([A-Za-z]+)(?:\?(.*))?$/.exec(hash);
  if (!m) return null;
  const out: Record<string, string> = { screen: m[1]! };
  for (const [k, v] of new URLSearchParams(m[2] ?? "")) if (/^[A-Za-z]+$/.test(k) && v.length < 200) out[k] = v;
  return out;
}

/**
 * Makes the browser's Back, Forward, Reload and bookmarks work for an app's screens (opt-in: the real site only).
 * `state` is everything that decides what is on screen. Each change pushes a history entry and puts the screen in the address
 * (`/#/mytasks`). Going back, or opening an address, hands the saved state to `restore`, which must validate it: it came from
 * the address bar, so treat it as untrusted. `replace` overwrites the current entry instead of adding one (sign-in screens).
 * `isAuth` marks screens that must not get an address of their own; `urlScreen` swaps a one-off confirmation screen for the
 * screen a reload should land on instead; `urlKeys` lists which state fields belong in the address for a screen (the rest stay
 * in the history entry only), so addresses stay short and show only what matters.
 */
export function useBrowserHistory<T extends NavState>(
  enabled: boolean, state: T, restore: (s: Record<string, string>) => void, opts: { replace?: boolean; isAuth?: (screen: string) => boolean; urlScreen?: (screen: string) => string; urlKeys?: (screen: string) => readonly string[] } = {}
): void {
  const key = JSON.stringify(state);
  const last = useRef<string | null>(null);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const isAuth = opts.isAuth ?? (() => false);
  const isAuthRef = useRef(isAuth);
  isAuthRef.current = isAuth;
  const urlScreenRef = useRef(opts.urlScreen ?? ((x: string) => x));
  urlScreenRef.current = opts.urlScreen ?? ((x: string) => x);
  const urlKeysRef = useRef(opts.urlKeys ?? (() => [] as readonly string[]));
  urlKeysRef.current = opts.urlKeys ?? (() => []);
  const openedFromAddress = useRef(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const apply = (saved: Record<string, string> | null | undefined) => {
      if (!saved) return;
      last.current = JSON.stringify(saved);
      restoreRef.current(saved);
    };
    // Someone opened a bookmark or reloaded: start on the screen in the address.
    const booted = fromHash(window.location.hash);
    if (booted) { openedFromAddress.current = true; apply(booted); }
    const onPop = (e: PopStateEvent) => apply((e.state as { rr?: Record<string, string> } | null)?.rr ?? fromHash(window.location.hash));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (openedFromAddress.current) { openedFromAddress.current = false; return; } // the address already says where we are
    if (key === last.current) return;
    const first = last.current === null;
    last.current = key;
    try {
      const entry = { ...(window.history.state ?? {}), rr: JSON.parse(key) as T };
      const url = toHash(state, isAuthRef.current, urlScreenRef.current, urlKeysRef.current);
      if (first || opts.replace) window.history.replaceState(entry, "", url);
      else window.history.pushState(entry, "", url);
    } catch { /* history can be blocked (some embedded views); the app still works without it */ }
  }, [key, enabled, opts.replace]);
}
