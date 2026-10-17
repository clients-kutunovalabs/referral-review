import { useState } from "react";
import { PASSWORD_MIN_LENGTH } from "@rr/core";
import { messageOf } from "../../data";
import { Button, Card, PasswordField } from "../../primitives";
import { useServices } from "../../services";

/** Change the password of the signed-in account. Shared by the worker app and the admin app (it is one account). */
export function ChangePassword() {
  const { api } = useServices();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [err, setErr] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);

  async function save() {
    setErr(""); setDone(false);
    if (!current) return setErr("Enter your current password.");
    if (next.length < PASSWORD_MIN_LENGTH) return setErr(`The new password needs at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (next !== again) return setErr("The two new passwords are not the same.");
    setBusy(true);
    try {
      await api.user.changePassword(current, next);
      setDone(true); setOpen(false); setCurrent(""); setNext(""); setAgain("");
    } catch (e) { setErr(messageOf(e)); }
    setBusy(false);
  }

  if (!open) {
    return (<>
      {done ? <p className="hint" role="status">Password changed. Your other devices were signed out.</p> : null}
      <Button block onClick={() => { setOpen(true); setDone(false); }}>Change password</Button>
    </>);
  }
  return (
    <Card>
      <h3>Change password</h3>
      <PasswordField label="Current password" autoComplete="current-password" value={current} onChange={setCurrent} />
      <PasswordField label="New password" autoComplete="new-password" value={next} onChange={setNext} hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} />
      <PasswordField label="New password again" autoComplete="new-password" value={again} onChange={setAgain} error={err || undefined} />
      <Button variant="primary" block disabled={busy} onClick={() => { void save(); }}>{busy ? "Saving…" : "Save new password"}</Button>
      <Button block style={{ marginTop: 8 }} onClick={() => { setOpen(false); setErr(""); }}>Cancel</Button>
    </Card>
  );
}
