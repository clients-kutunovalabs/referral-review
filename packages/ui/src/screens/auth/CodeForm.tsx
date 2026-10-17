import { useEffect, useState, type ReactNode } from "react";
import { AuthError, CODE_LENGTH, type CodeSent } from "@rr/core";
import { Button, Field, Input } from "../../primitives";
import { useDemo } from "../../services";

export function messageOf(e: unknown): string {
  return e instanceof AuthError ? e.message : "Something went wrong. Please try again.";
}

/** One-time email code entry: used for sign-up, password reset and for adding another email. Rules (attempts, expiry, cooldown) live in the adapter; this only shows them. */
export function CodeForm({ email, intro, sent, verifyLabel = "Verify email", onVerify, onResend, onCancel, cancelLabel = "Use a different email" }: {
  email: string; intro?: ReactNode; sent: CodeSent | null; verifyLabel?: string;
  onVerify: (code: string) => Promise<void>; onResend: () => Promise<CodeSent>; onCancel?: () => void; cancelLabel?: string;
}) {
  const demo = useDemo();
  const [code, setCode] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false); const [resent, setResent] = useState(false);
  const [wait, setWait] = useState(sent?.resendAfterSeconds ?? 30);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify() {
    setBusy(true); setErr("");
    try { await onVerify(code); }
    catch (e) {
      if (e instanceof AuthError && e.code === "too_many_attempts") setLocked(true);
      setErr(messageOf(e));
    } finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setErr(""); setResent(false);
    try {
      const s = await onResend();
      setWait(s.resendAfterSeconds); setLocked(false); setCode(""); setResent(true);
    } catch (e) {
      if (e instanceof AuthError && e.retryAfterSeconds) setWait(e.retryAfterSeconds);
      setErr(messageOf(e));
    } finally { setBusy(false); }
  }

  const mm = `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`;
  return (
    <>
      {intro ?? <p className="note-text" style={{ marginTop: 0 }}>We sent a {CODE_LENGTH}-digit code to <strong>{email}</strong>.</p>}
      <Field label="Verification code" error={err}>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH} value={code} disabled={locked || busy}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setErr(""); }} placeholder={"0".repeat(CODE_LENGTH)} />
      </Field>
      <Button variant="primary" block disabled={code.length !== CODE_LENGTH || locked || busy} onClick={verify}>{busy ? "Please wait…" : verifyLabel}</Button>
      <Button block style={{ marginTop: 8 }} disabled={(wait > 0 && !locked) || busy} onClick={resend}>
        {wait > 0 && !locked ? `Resend code in ${mm}` : "Resend code"}
      </Button>
      {resent ? <p className="hint" role="status">A new code was sent.</p> : null}
      {onCancel ? <Button block style={{ marginTop: 8 }} onClick={onCancel}>{cancelLabel}</Button> : null}
      {demo.code ? <p className="hint" style={{ marginTop: 12 }}>Demo: the code is <span className="mono">{demo.code}</span>.</p> : null}
    </>
  );
}
