import { useEffect, useRef, useState, type ReactNode } from "react";
import { PASSWORD_MIN_LENGTH, type AuthSession, type CodeSent } from "@rr/core";
import { Button, Field, Input, PasswordField, TopBar } from "../../primitives";
import { useDemo, useServices } from "../../services";
import { CodeForm, messageOf } from "./CodeForm";

export type AuthView = "signIn" | "signUp" | "verify" | "createPassword" | "forgot" | "resetVerify" | "resetPassword";

export interface SignUpField { key: string; label: string; type?: "text" | "tel"; required?: boolean }

export interface AuthFlowProps {
  /** Product name shown above the form on tablet and desktop, e.g. "Task board" or "Admin panel". */
  brand: string;
  /** Admin panels are invite-only: turn sign-up off and only sign-in and password reset remain. */
  allowSignUp?: boolean;
  /** Extra profile fields collected on the sign-up form (kept with the account). Email is always asked. */
  signUpFields?: SignUpField[];
  initialView?: AuthView;
  initialEmail?: string;
  /** A note above the sign-in form, e.g. "Log in to claim this task". */
  notice?: string;
  onAuthenticated: (session: AuthSession) => void;
}

const TITLES: Record<AuthView, string> = {
  signIn: "Log in", signUp: "Create account", verify: "Verify your email", createPassword: "Create a password",
  forgot: "Forgot password", resetVerify: "Enter the code", resetPassword: "Set a new password"
};
const EMAIL = /^\S+@\S+\.\S+$/;

/**
 * Universal sign-in: log in, create account (email, one-time code, password), forgot and reset password.
 * It knows nothing about the product around it. All identity work goes through AuthPort, so whatever sits behind it
 * (Authgate, or the in-memory mock) can change without touching this file.
 */
export function AuthFlow({ brand, allowSignUp = true, signUpFields = [], initialView = "signIn", initialEmail = "", notice, onAuthenticated }: AuthFlowProps) {
  const { auth } = useServices();
  const demo = useDemo();
  const [view, setView] = useState<AuthView>(initialView);
  const [email, setEmail] = useState(initialEmail);
  const [profile, setProfile] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [ticket, setTicket] = useState("");
  const [note, setNote] = useState("");

  const go = (v: AuthView) => { setNote(""); setView(v); };

  // Previewing a later step in ui-hub: walk the mock through the earlier steps so the screen is live, not empty.
  const boot = useRef(false);
  useEffect(() => {
    if (boot.current || initialView === "signIn" || initialView === "signUp" || initialView === "forgot") return;
    boot.current = true;
    const purpose = initialView === "resetVerify" || initialView === "resetPassword" ? "reset" : "signup";
    const to = initialEmail || "you@example.com";
    void (async () => {
      try {
        const s = await auth.requestCode(to, purpose, purpose === "signup" ? profile : undefined);
        setSent(s);
        if ((initialView === "createPassword" || initialView === "resetPassword") && demo.code) setTicket((await auth.verifyCode(to, demo.code, purpose)).ticket);
      } catch { /* a preview that cannot bootstrap simply shows the form */ }
    })();
  }, [auth, demo.code, initialEmail, initialView, profile]);

  const back: Partial<Record<AuthView, AuthView>> = { signUp: "signIn", verify: "signUp", createPassword: "verify", forgot: "signIn", resetVerify: "forgot", resetPassword: "resetVerify" };

  let body: ReactNode;
  switch (view) {
    case "signIn": body = (
      <SignInForm email={email} setEmail={setEmail} allowSignUp={allowSignUp} notice={notice ?? note} hint={demo.signInHint}
        onForgot={() => go("forgot")} onSignUp={() => go("signUp")} onDone={onAuthenticated} />
    ); break;
    case "signUp": body = (
      <SignUpForm email={email} setEmail={setEmail} fields={signUpFields} profile={profile} setProfile={setProfile}
        onSent={(s) => { setSent(s); go("verify"); }} onSignIn={() => go("signIn")} />
    ); break;
    case "verify": body = (
      <CodeForm email={email} sent={sent} cancelLabel="Use a different email" onCancel={() => go("signUp")}
        intro={<>
          <p className="note-text" style={{ marginTop: 0 }}>We sent a 6-digit code to <strong>{email}</strong>. You only need to confirm this address once.</p>
          <p className="hint" style={{ marginTop: 0 }}>No code after a minute? If you already have an account with this email, <button type="button" className="expander" style={{ padding: 0, minHeight: 0 }} onClick={() => go("signIn")}>log in</button> or reset your password instead.</p>
        </>}
        onVerify={async (code) => { setTicket((await auth.verifyCode(email, code, "signup")).ticket); go("createPassword"); }}
        onResend={async () => { const s = await auth.requestCode(email, "signup", profile); setSent(s); return s; }} />
    ); break;
    case "createPassword": body = (
      <NewPasswordForm intro={`Your email ${email} is confirmed. Choose a password to finish.`} submitLabel="Create account"
        onSubmit={async (pw) => onAuthenticated(await auth.setPassword(ticket, pw))}
        onExpired={() => { setNote("That step expired. Start again."); go("signUp"); }} />
    ); break;
    case "forgot": body = (
      <ForgotForm email={email} setEmail={setEmail} onSent={(s) => { setSent(s); go("resetVerify"); }} />
    ); break;
    case "resetVerify": body = (
      <CodeForm email={email} sent={sent} verifyLabel="Continue" cancelLabel="Use a different email" onCancel={() => go("forgot")}
        intro={<p className="note-text" style={{ marginTop: 0 }}>If an account exists for <strong>{email}</strong>, we sent a 6-digit code to it.</p>}
        onVerify={async (code) => { setTicket((await auth.verifyCode(email, code, "reset")).ticket); go("resetPassword"); }}
        onResend={async () => { const s = await auth.requestCode(email, "reset"); setSent(s); return s; }} />
    ); break;
    case "resetPassword": body = (
      <NewPasswordForm intro="Choose a new password. You will be logged in once it is saved." submitLabel="Save password and log in"
        onSubmit={async (pw) => onAuthenticated(await auth.resetPassword(ticket, pw))}
        onExpired={() => { setNote("That step expired. Start again."); go("forgot"); }} />
    ); break;
  }

  const prev = back[view];
  return (
    <div className="screen auth">
      <TopBar title={TITLES[view]} {...(prev ? { onBack: () => go(prev) } : {})} />
      <div className="scrollarea"><div className="content">
        <div className="auth-card">
          <div className="auth-brand">{brand}</div>
          <h2 className="auth-title">{TITLES[view]}</h2>
          {body}
        </div>
      </div></div>
    </div>
  );
}

function SignInForm({ email, setEmail, allowSignUp, notice, hint, onForgot, onSignUp, onDone }: {
  email: string; setEmail: (v: string) => void; allowSignUp: boolean; notice: string; hint: string | undefined;
  onForgot: () => void; onSignUp: () => void; onDone: (s: AuthSession) => void;
}) {
  const { auth } = useServices();
  const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!email.trim() || !pw) return setErr("Enter your email and password.");
    setBusy(true); setErr("");
    try { onDone(await auth.signIn(email, pw)); } catch (e) { setErr(messageOf(e)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {notice ? <div className="banner">{notice}</div> : null}
      <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
      <PasswordField label="Password" autoComplete="current-password" value={pw} onChange={setPw} error={err} />
      <Button variant="primary" block type="submit" disabled={busy}>{busy ? "Please wait…" : "Log in"}</Button>
      <div className="auth-links">
        <button type="button" className="link-btn" onClick={onForgot}>Forgot password?</button>
      </div>
      {allowSignUp ? <Button block style={{ marginTop: 8 }} onClick={onSignUp}>Create account</Button> : null}
      {hint ? <p className="hint" style={{ textAlign: "center", marginTop: 14 }}>{hint}</p> : null}
    </form>
  );
}

function SignUpForm({ email, setEmail, fields, profile, setProfile, onSent, onSignIn }: {
  email: string; setEmail: (v: string) => void; fields: SignUpField[]; profile: Record<string, string>; setProfile: (p: Record<string, string>) => void;
  onSent: (s: CodeSent) => void; onSignIn: () => void;
}) {
  const { auth } = useServices();
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    const missing = fields.find((f) => f.required !== false && !profile[f.key]?.trim());
    if (missing) return setErr(`Enter your ${missing.label.toLowerCase()}.`);
    if (!EMAIL.test(email.trim())) return setErr("Enter a valid email address.");
    setBusy(true); setErr("");
    try { onSent(await auth.requestCode(email, "signup", profile)); } catch (e) { setErr(messageOf(e)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <Input type={f.type ?? "text"} {...(f.type === "tel" ? { inputMode: "numeric" as const } : {})} value={profile[f.key] ?? ""} onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })} />
        </Field>
      ))}
      <Field label="Email" error={err} hint="We email you one code to confirm this address. You only do this once.">
        <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </Field>
      <Button variant="primary" block type="submit" disabled={busy}>{busy ? "Please wait…" : "Send code"}</Button>
      <div className="auth-links">Already have an account? <button type="button" className="link-btn" onClick={onSignIn}>Log in</button></div>
    </form>
  );
}

function ForgotForm({ email, setEmail, onSent }: { email: string; setEmail: (v: string) => void; onSent: (s: CodeSent) => void }) {
  const { auth } = useServices();
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!EMAIL.test(email.trim())) return setErr("Enter a valid email address.");
    setBusy(true); setErr("");
    try { onSent(await auth.requestCode(email, "reset")); } catch (e) { setErr(messageOf(e)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      <p className="note-text" style={{ marginTop: 0 }}>Enter the email you log in with. We will send a code so you can choose a new password.</p>
      <Field label="Email" error={err}><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
      <Button variant="primary" block type="submit" disabled={busy}>{busy ? "Please wait…" : "Send code"}</Button>
    </form>
  );
}

function NewPasswordForm({ intro, submitLabel, onSubmit, onExpired }: {
  intro: string; submitLabel: string; onSubmit: (password: string) => Promise<void>; onExpired: () => void;
}) {
  const [pw, setPw] = useState(""); const [again, setAgain] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    if (pw.length < PASSWORD_MIN_LENGTH) return setErr(`Password needs at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (pw !== again) return setErr("The two passwords do not match.");
    setBusy(true); setErr("");
    try { await onSubmit(pw); }
    catch (e) {
      if ((e as { code?: string }).code === "invalid_code") return onExpired();
      setErr(messageOf(e));
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      <p className="note-text" style={{ marginTop: 0 }}>{intro}</p>
      <PasswordField label="Password" autoComplete="new-password" value={pw} onChange={setPw} hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} />
      <PasswordField label="Confirm password" autoComplete="new-password" value={again} onChange={setAgain} error={err} />
      <Button variant="primary" block type="submit" disabled={busy}>{busy ? "Please wait…" : submitLabel}</Button>
    </form>
  );
}
