import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, AuthError, type Ticket } from "@rr/core";
import { Button } from "./primitives";

export interface Async<T> {
  data: T | undefined;
  error: string | null;
  /** true until the first answer arrives; a refresh keeps showing the old data instead of flashing a spinner */
  loading: boolean;
  /** the error was "log in again" */
  unauthenticated: boolean;
  reload: () => void;
}

/** What a person should read when a call fails. API errors already carry a friendly message. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError || e instanceof AuthError) return e.message;
  return "We could not reach the server. Check your connection and try again.";
}
export const isUnauthenticated = (e: unknown): boolean => e instanceof ApiError && e.code === "unauthenticated";

/**
 * Loads data when the screen opens (and whenever `deps` change). `refreshMs` quietly re-fetches on a timer, which is
 * how chats pick up replies: nothing is ever emailed, so the app has to look.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[] = [], opts: { refreshMs?: number; enabled?: boolean } = {}): Async<T> {
  const [state, setState] = useState<{ data?: T; error: string | null; unauth: boolean; done: boolean }>({ error: null, unauth: false, done: false });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadRef.current().then(
      (data) => { if (live) setState({ data, error: null, unauth: false, done: true }); },
      (e: unknown) => { if (live) setState((s) => ({ ...s, error: messageOf(e), unauth: isUnauthenticated(e), done: true })); }
    );
    return () => { live = false; };
  }, [enabled, tick, ...deps]);

  // Signing out must not leave the last person's data on screen for the next one.
  useEffect(() => { if (!enabled) setState({ error: null, unauth: false, done: false }); }, [enabled]);

  useEffect(() => {
    if (!opts.refreshMs || !enabled) return;
    const t = setInterval(() => setTick((n) => n + 1), opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, enabled]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data: state.data, error: state.data === undefined ? state.error : null, loading: enabled && !state.done, unauthenticated: state.unauth, reload };
}

/** Calls `reload` when the person comes back to the tab or window, so what they see is not stale after time away. */
export function useRefreshOnFocus(reload: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", onVisible); };
  }, [reload, enabled]);
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="empty" role="status">{label}</div>;
}

/** Long lists load this many rows at a time. */
export const PAGE = 50;

/** Asks the server for the next rows of a long list (users, payout history, resolved tickets). */
export function LoadMore({ onClick }: { onClick: () => void }) {
  return <div className="load-more"><Button onClick={onClick}>Load more</Button></div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card alert" role="alert">
      <p style={{ color: "var(--coral)" }}>{message}</p>
      {onRetry ? <div className="row"><span /><Button compact onClick={onRetry}>Try again</Button></div> : null}
    </div>
  );
}

/** Tickets where the customer spoke last and support has not answered. The server sends the answer; the fallback reads the messages. */
export const needsReply = (t: Ticket): boolean => {
  if (t.needsReply !== undefined) return t.needsReply;
  const last = [...t.messages].reverse().find((m) => m.sender !== "system");
  return t.status === "open" && last?.sender === "customer";
};
