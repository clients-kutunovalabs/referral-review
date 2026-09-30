import { useMemo, useState } from "react";
import { fixtures, type Claim, type Identity, type Task } from "@rr/core";
import { formatRupees, parseRupees, rupees, type Paise } from "@rr/money";
import {
  BottomNav, Button, Card, Chips, CopyButton, Countdown, EmptyState, Field, FileUpload, Input, Select,
  StatusPill, Tabs, Textarea, Toast, TopBar
} from "../../primitives";

export type UserScreen =
  | "login" | "register" | "board" | "detail" | "claimed" | "mytasks" | "submit" | "submitted"
  | "wallet" | "txn" | "payout" | "payoutSent" | "payoutFlagged" | "identities";
export type MyTab = "active" | "review" | "completed" | "rejected";

const NAV = [
  { id: "board", label: "Tasks" },
  { id: "mytasks", label: "My tasks" },
  { id: "wallet", label: "Wallet" },
  { id: "payout", label: "Payout" }
];
const TAB_OF: Partial<Record<UserScreen, string>> = {
  board: "board", detail: "board", claimed: "board",
  mytasks: "mytasks", submit: "mytasks", submitted: "mytasks",
  wallet: "wallet", txn: "wallet",
  payout: "payout", payoutSent: "payout", payoutFlagged: "payout"
};
const MIN_PAYOUT = rupees(100);

/** Demo-only text assignment. The real balanced random bag lives on the server (step 6). */
function demoText(task: Task, n: number): string | undefined {
  if (task.textMode === "manual_pool") return fixtures.pitchPool[n % fixtures.pitchPool.length];
  if (task.textMode === "ai_generated") {
    return `Hi, I wanted to follow up about ${task.keywords.join(" and ") || task.title}. We can get you set up quickly and our team will support the onboarding. Would you be open to a short call this week?`;
  }
  return undefined;
}

export interface UserAppProps {
  initialScreen?: UserScreen;
  initialTab?: MyTab;
  loggedIn?: boolean;
}

export function UserApp({ initialScreen = "board", initialTab = "active", loggedIn: initialLoggedIn = true }: UserAppProps) {
  const [screen, setScreen] = useState<UserScreen>(initialScreen);
  const [tab, setTab] = useState<MyTab>(initialTab);
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn);
  const [next, setNext] = useState<UserScreen | null>(null);
  const [taskId, setTaskId] = useState(initialScreen === "detail" ? "t3" : "t1");
  const [txnId, setTxnId] = useState("w1");
  const [claims, setClaims] = useState<Claim[]>(fixtures.claims);
  const [identities, setIdentities] = useState<Identity[]>(fixtures.identities);
  const [identityId, setIdentityId] = useState("i1");
  const [toast, setToast] = useState<string | null>(null);
  const [pendingHeld, setPendingHeld] = useState<Paise>(fixtures.wallet.held);

  const task = fixtures.tasks.find((t) => t.id === taskId) ?? fixtures.tasks[0]!;
  const identity = identities.find((i) => i.id === identityId) ?? identities[0]!;
  const show = (s: UserScreen) => setScreen(s);
  const notify = (m: string) => setToast(m);

  function claimTask() {
    if (!loggedIn) { setNext("claimed"); show("login"); return; }
    const already = claims.some((c) => c.taskId === task.id && c.identityId === identityId && c.status !== "void" && c.status !== "expired");
    if (already) return;
    const count = claims.filter((c) => c.taskId === task.id).length;
    const text = demoText(task, count);
    setClaims([{ id: `c${claims.length + 1}`, taskId: task.id, identityId, status: "claimed", minutesLeft: task.timerMinutes, ...(text ? { assignedText: text } : {}) }, ...claims]);
    show("claimed");
  }

  function submitProof(claimId: string) {
    setClaims(claims.map((c) => (c.id === claimId ? { ...c, status: "under_review", submittedLabel: "just now" } : c)));
    show("submitted");
  }

  const [submitClaimId, setSubmitClaimId] = useState("c1");
  const wallet = fixtures.wallet;
  const available = wallet.available - (pendingHeld - wallet.held);

  let body: JSX.Element;
  switch (screen) {
    case "login": body = <LoginScreen onLogin={() => { setLoggedIn(true); show(next ? "detail" : "board"); setNext(null); }} onRegister={() => show("register")} hasNext={!!next} />; break;
    case "register": body = <RegisterScreen onDone={() => { setLoggedIn(true); show("board"); }} onBack={() => show("login")} />; break;
    case "board": body = (
      <BoardScreen identity={identity} onIdentity={() => show("identities")} onOpen={(id) => { setTaskId(id); show("detail"); }} />
    ); break;
    case "detail": body = (
      <DetailScreen task={task} identities={identities} identityId={identityId} setIdentityId={setIdentityId} claims={claims}
        loggedIn={loggedIn} onClaim={claimTask} onBack={() => show("board")} />
    ); break;
    case "claimed": body = <ClaimedScreen task={task} minutes={task.timerMinutes} onGo={() => { setTab("active"); show("mytasks"); }} text={claims.find((c) => c.taskId === task.id && c.identityId === identityId)?.assignedText} notify={notify} />; break;
    case "mytasks": body = (
      <MyTasksScreen tab={tab} setTab={setTab} claims={claims} identities={identities}
        onSubmit={(id) => { setSubmitClaimId(id); show("submit"); }} />
    ); break;
    case "submit": body = <SubmitScreen task={fixtures.tasks.find((t) => t.id === claims.find((c) => c.id === submitClaimId)?.taskId) ?? task} onBack={() => show("mytasks")} onSubmit={() => submitProof(submitClaimId)} />; break;
    case "submitted": body = (
      <div className="screen"><TopBar title="Submitted" /><div className="scrollarea"><div className="content">
        <div className="center-icon">&#10003;</div>
        <p className="center-text">Proof submitted. Moved to Under review.</p>
        <Button block style={{ marginTop: 20 }} onClick={() => { setTab("review"); show("mytasks"); }}>View under review</Button>
      </div></div></div>
    ); break;
    case "wallet": body = <WalletScreen identities={identities} available={available} held={pendingHeld} onTxn={(id) => { setTxnId(id); show("txn"); }} />; break;
    case "txn": body = <TxnScreen id={txnId} onBack={() => show("wallet")} />; break;
    case "payout": body = (
      <PayoutScreen available={available} pending={pendingHeld > 0n}
        onRequest={(amt) => { setPendingHeld(pendingHeld + amt); show("payoutSent"); }}
        onFlagged={() => show("payoutFlagged")} />
    ); break;
    case "payoutSent": body = (
      <div className="screen"><TopBar title="Request sent" /><div className="scrollarea"><div className="content">
        <div className="center-icon">&#10003;</div>
        <p className="center-text">Payout request submitted. We'll settle it manually within a few days.</p>
        <Button block style={{ marginTop: 20 }} onClick={() => show("payout")}>Back to payout</Button>
      </div></div></div>
    ); break;
    case "payoutFlagged": body = (
      <div className="screen"><TopBar title="Payout rejected" onBack={() => show("payout")} /><div className="scrollarea"><div className="content">
        <Card alert><p style={{ color: "var(--coral)" }}>This UPI ID is already linked to another account. Enter a different UPI ID to continue.</p></Card>
        <p className="muted">Your balance is untouched. This request has been flagged for review and won't be paid until resolved.</p>
        <Button variant="primary" block style={{ marginTop: 14 }} onClick={() => show("payout")}>Try a different UPI ID</Button>
      </div></div></div>
    ); break;
    case "identities": body = (
      <IdentitiesScreen identities={identities} activeId={identityId} onSwitch={(id) => { setIdentityId(id); notify("Switched email"); }}
        onAdd={(email) => { setIdentities([...identities, { id: `i${identities.length + 1}`, email, isPrimary: false, earned: 0n }]); notify("Email added. Verification link sent."); }}
        onBack={() => show("board")} />
    ); break;
  }

  const tabId = TAB_OF[screen];
  return (
    <>
      {body}
      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
      {tabId ? <BottomNav items={NAV} active={tabId} onSelect={(id) => { if (id === "mytasks") setTab("active"); show(id as UserScreen); }} /> : null}
    </>
  );
}

/* ---------- Screens ---------- */

function LoginScreen({ onLogin, onRegister, hasNext }: { onLogin: () => void; onRegister: () => void; hasNext: boolean }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  return (
    <div className="screen"><TopBar title="Log in" /><div className="scrollarea"><div className="content">
      {hasNext ? <div className="banner">Log in to claim this task. You'll come back to it.</div> : null}
      <Field label="Email"><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
      <Field label="Password" error={err}><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Button variant="primary" block onClick={() => (email && pw ? onLogin() : setErr("Enter your email and password."))}>Log in</Button>
      <Button block style={{ marginTop: 8 }} onClick={onRegister}>Create account</Button>
      <p className="hint" style={{ textAlign: "center", marginTop: 14 }}>Only your main email can log in. Other emails are switched inside the app.</p>
    </div></div></div>
  );
}

function RegisterScreen({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", pw: "" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="screen"><TopBar title="Create account" onBack={onBack} /><div className="scrollarea"><div className="content">
      <Field label="Full name"><Input value={f.name} onChange={set("name")} /></Field>
      <Field label="Email (your main login)"><Input type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="Phone"><Input type="tel" inputMode="numeric" value={f.phone} onChange={set("phone")} /></Field>
      <Field label="Password" error={err}><Input type="password" value={f.pw} onChange={set("pw")} /></Field>
      <Button variant="primary" block onClick={() => (f.name && f.email && f.phone && f.pw.length >= 8 ? onDone() : setErr("Fill every field. Password needs 8+ characters."))}>Create account</Button>
    </div></div></div>
  );
}

function BoardScreen({ identity, onIdentity, onOpen }: { identity: Identity; onIdentity: () => void; onOpen: (id: string) => void }) {
  return (
    <div className="screen">
      <TopBar title="Tasks" right={<button className="identity-chip" onClick={onIdentity} aria-label="Switch email">{identity.email} &#9662;</button>} />
      <div className="scrollarea"><div className="content">
        {fixtures.tasks.map((t) => (
          <Card key={t.id} onClick={() => onOpen(t.id)}>
            <h3>{t.title}</h3>
            <p>Reward {formatRupees(t.reward)} &middot; {t.slotsTotal === null ? "unlimited slots" : `${t.slotsRemaining} of ${t.slotsTotal} slots left`}</p>
            <div className="row">
              <StatusPill tone={t.status === "closing_soon" ? "amber" : "teal"}>{t.status === "closing_soon" ? "closing soon" : `${t.timerMinutes} min timer`}</StatusPill>
              <Button>View</Button>
            </div>
          </Card>
        ))}
      </div></div>
    </div>
  );
}

function DetailScreen({ task, identities, identityId, setIdentityId, claims, loggedIn, onClaim, onBack }: {
  task: Task; identities: Identity[]; identityId: string; setIdentityId: (id: string) => void;
  claims: Claim[]; loggedIn: boolean; onClaim: () => void; onBack: () => void;
}) {
  const already = claims.some((c) => c.taskId === task.id && c.identityId === identityId && c.status !== "void" && c.status !== "expired");
  const perTextNote = task.textMode === "manual_pool" ? "You'll get a pitch to use once you claim."
    : task.textMode === "ai_generated" ? "A pitch is written for you when you claim." : null;
  return (
    <div className="screen"><TopBar title="Task detail" onBack={onBack} /><div className="scrollarea"><div className="content">
      <Card>
        <h3>{task.title}</h3>
        <p>{task.description}</p>
        <div className="row"><StatusPill tone="teal">{formatRupees(task.reward)} reward</StatusPill><StatusPill tone="amber">{task.timerMinutes} min once claimed</StatusPill></div>
        <div className="linkrow">Task site: <a href={task.siteUrl} target="_blank" rel="noreferrer noopener">{task.siteUrl.replace("https://", "")} &#8599;</a></div>
      </Card>
      {task.keywords.length ? (<><div className="section-label">Features to highlight</div><Chips items={task.keywords} /></>) : null}
      {perTextNote ? <p className="hint" style={{ marginTop: 12 }}>{perTextNote}</p> : null}
      <p className="muted" style={{ marginTop: 12 }}>
        {task.slotsTotal === null ? "Unlimited slots." : `${task.slotsRemaining} of ${task.slotsTotal} slots remaining.`} Each email can claim this task once.
      </p>
      {loggedIn ? (
        <Field label="Claim as">
          <Select value={identityId} onChange={(e) => setIdentityId(e.target.value)}>
            {identities.map((i) => <option key={i.id} value={i.id}>{i.email}</option>)}
          </Select>
        </Field>
      ) : null}
      <Button variant="primary" block disabled={already} onClick={onClaim}>{already ? "Already claimed from this email" : loggedIn ? "Claim task" : "Log in to claim"}</Button>
    </div></div></div>
  );
}

function ClaimedScreen({ task, minutes, text, onGo, notify }: { task: Task; minutes: number; text: string | undefined; onGo: () => void; notify: (m: string) => void }) {
  return (
    <div className="screen"><TopBar title="Task claimed" /><div className="scrollarea"><div className="content">
      <div className="center-icon">&#10003;</div>
      <p className="center-text">Task added to your list. Complete it within {minutes} minutes.</p>
      {text ? (
        <Card>
          <h3>Your pitch</h3>
          <div className="pitch">{text}</div>
          <div className="row"><span className="muted">{task.textMode === "ai_generated" ? "Written for you" : "Assigned to you"}</span><CopyButton text={text} /></div>
        </Card>
      ) : null}
      <p className="muted" style={{ textAlign: "center" }}>Find it under My tasks &rarr; Active</p>
      <Button block style={{ marginTop: 20 }} onClick={() => { notify("Task added"); onGo(); }}>Go to My tasks</Button>
    </div></div></div>
  );
}

function MyTasksScreen({ tab, setTab, claims, identities, onSubmit }: {
  tab: MyTab; setTab: (t: MyTab) => void; claims: Claim[]; identities: Identity[]; onSubmit: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const title = (c: Claim) => fixtures.tasks.find((t) => t.id === c.taskId)?.title ?? "Task";
  const email = (c: Claim) => identities.find((i) => i.id === c.identityId)?.email ?? "";
  const list = useMemo(() => claims.filter((c) =>
    tab === "active" ? c.status === "claimed"
      : tab === "review" ? c.status === "under_review"
      : tab === "completed" ? c.status === "approved" || c.status === "partial"
      : c.status === "rejected" || c.status === "expired" || c.status === "void"), [claims, tab]);
  return (
    <div className="screen"><TopBar title="My tasks" />
      <Tabs<MyTab> value={tab} onChange={setTab} tabs={[
        { id: "active", label: "Active" }, { id: "review", label: "Under review" }, { id: "completed", label: "Completed" }, { id: "rejected", label: "Rejected" }]} />
      <div className="scrollarea"><div className="content">
        {list.length === 0 ? <EmptyState>Nothing here yet.</EmptyState> : null}
        {list.map((c) => {
          const t = fixtures.tasks.find((x) => x.id === c.taskId);
          return (
            <Card key={c.id}>
              <h3>{title(c)}</h3>
              <p className="muted">{email(c)}</p>
              {c.status === "claimed" ? (<>
                <div className="row"><Countdown minutes={c.minutesLeft ?? 0} /><Button onClick={() => onSubmit(c.id)}>Submit proof</Button></div>
                {t ? <div className="linkrow">Task site: <a href={t.siteUrl} target="_blank" rel="noreferrer noopener">{t.siteUrl.replace("https://", "")} &#8599;</a></div> : null}
                {t?.keywords.length ? <Chips items={t.keywords} /> : null}
                {c.assignedText ? (<>
                  <button className="expander" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide pitch" : "Show my pitch"}</button>
                  {open === c.id ? (<><div className="pitch">{c.assignedText}</div><div className="row"><span /><CopyButton text={c.assignedText} /></div></>) : null}
                </>) : null}
              </>) : null}
              {c.status === "under_review" ? (<><p>Submitted {c.submittedLabel} &middot; waiting for admin review</p><div className="row"><StatusPill tone="teal">Under review</StatusPill></div></>) : null}
              {(c.status === "approved" || c.status === "partial") ? (<>
                <p>Paid {formatRupees(c.credited ?? 0n)}{c.status === "partial" ? ` of ${formatRupees(t?.reward ?? 0n)}` : ""} &middot; approved {c.outcome}%{c.reviewerNote ? ` · "${c.reviewerNote}"` : ""}</p>
                <div className="row"><StatusPill tone={c.status === "approved" ? "green" : "amber"}>{c.status === "approved" ? "Approved" : `Partial · ${c.outcome}%`}</StatusPill></div>
              </>) : null}
              {(c.status === "rejected" || c.status === "expired" || c.status === "void") ? (<>
                <p>{c.reviewerNote ? `"${c.reviewerNote}" ` : ""}{c.status === "rejected" ? "No payout for this task." : c.status === "expired" ? "Timer ran out." : "Task was removed."}</p>
                <div className="row"><StatusPill tone="coral">{c.status === "rejected" ? "Rejected · 0%" : c.status === "expired" ? "Expired" : "Voided"}</StatusPill></div>
              </>) : null}
            </Card>
          );
        })}
      </div></div>
    </div>
  );
}

function SubmitScreen({ task, onBack, onSubmit }: { task: Task; onBack: () => void; onSubmit: () => void }) {
  const [file, setFile] = useState(false); const [link, setLink] = useState(""); const [note, setNote] = useState(""); const [err, setErr] = useState("");
  const needsLink = task.proofType === "screenshot_link";
  const go = () => {
    if (!file) return setErr("Attach a screenshot first.");
    if (needsLink && !/^https:\/\/\S+$/.test(link)) return setErr("Add a valid https link.");
    onSubmit();
  };
  return (
    <div className="screen"><TopBar title="Submit proof" onBack={onBack} /><div className="scrollarea"><div className="content">
      <p className="muted" style={{ fontSize: 13 }}>Upload a screenshot proving you completed the task. JPG or PNG, up to 5 MB.</p>
      <FileUpload label="Tap to upload screenshot" filled={file} onPick={() => setFile(true)} />
      {needsLink ? <Field label="Link (required)"><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></Field> : null}
      <Field label={task.proofType === "screenshot_note" ? "Note (recommended: mention the features you highlighted)" : "Note (optional)"}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the reviewer should know" />
      </Field>
      {err ? <div className="field-error" role="alert">{err}</div> : null}
      <Button variant="primary" block style={{ marginTop: 14 }} onClick={go}>Submit for review</Button>
    </div></div></div>
  );
}

function WalletScreen({ identities, available, held, onTxn }: { identities: Identity[]; available: Paise; held: Paise; onTxn: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const w = fixtures.wallet;
  return (
    <div className="screen"><TopBar title="Wallet" /><div className="scrollarea"><div className="content">
      <Card>
        <div className="stat"><span>Total earned</span><span>{formatRupees(w.earned)}</span></div>
        <div className="stat"><span>Total withdrawn</span><span>{formatRupees(w.withdrawn)}</span></div>
        {held > 0n ? <div className="stat"><span>Held for pending payout</span><span>{formatRupees(held)}</span></div> : null}
        <div className="stat last"><span>Withdrawable balance</span><span>{formatRupees(available)}</span></div>
        <button className="expander" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} earnings by email</button>
        {open ? identities.map((i) => <div key={i.id} className="stat"><span>{i.email}</span><span>{formatRupees(i.earned)}</span></div>) : null}
      </Card>
      <p className="section-label">Earnings history</p>
      {w.entries.map((e) => (
        <div key={e.id} className="txn" role="button" tabIndex={0} onClick={() => onTxn(e.id)} onKeyDown={(k) => { if (k.key === "Enter") onTxn(e.id); }}>
          <span>{e.title}<div className="muted">{identities.find((i) => i.id === e.identityId)?.email}</div></span>
          <span className="amt">+{formatRupees(e.credited)}</span>
        </div>
      ))}
    </div></div></div>
  );
}

function TxnScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const e = fixtures.wallet.entries.find((x) => x.id === id) ?? fixtures.wallet.entries[0]!;
  const email = fixtures.identities.find((i) => i.id === e.identityId)?.email;
  return (
    <div className="screen"><TopBar title="Earning detail" onBack={onBack} /><div className="scrollarea"><div className="content">
      <Card>
        <h3>{e.title}</h3>
        <p>{e.outcome === 100 ? "Approved 100%" : `Partial approval ${e.outcome}%`} &middot; {e.whenLabel} &middot; {email}</p>
        <div className="row"><StatusPill tone={e.outcome === 100 ? "green" : "amber"}>{e.outcome === 100 ? `+${formatRupees(e.credited)} credited` : `+${formatRupees(e.credited)} of ${formatRupees(e.reward)} credited`}</StatusPill></div>
      </Card>
      {e.reviewerNote ? <p className="muted">Reviewer note: {e.reviewerNote}</p> : null}
    </div></div></div>
  );
}

function PayoutScreen({ available, pending, onRequest, onFlagged }: { available: Paise; pending: boolean; onRequest: (amt: Paise) => void; onFlagged: () => void }) {
  const [amount, setAmount] = useState(""); const [upi, setUpi] = useState(""); const [errs, setErrs] = useState<{ amount?: string; upi?: string }>({});
  function submit() {
    const e: typeof errs = {};
    const amt = parseRupees(amount);
    if (amt === null) e.amount = "Enter an amount in rupees, like 100 or 150.50.";
    else if (amt < MIN_PAYOUT) e.amount = `Minimum payout is ${formatRupees(MIN_PAYOUT)}.`;
    else if (amt > available) e.amount = `You can withdraw up to ${formatRupees(available)}.`;
    if (!/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(upi)) e.upi = upi ? "That doesn't look like a UPI ID (name@bank)." : "Enter a UPI ID before requesting payout.";
    setErrs(e);
    if (!e.amount && !e.upi && amt !== null) {
      if (upi.toLowerCase() === "taken@upi") return onFlagged();
      onRequest(amt);
    }
  }
  return (
    <div className="screen"><TopBar title="Payout" /><div className="scrollarea"><div className="content">
      <Card><p style={{ fontSize: 12, margin: "0 0 4px" }}>Withdrawable balance</p><h3 style={{ fontSize: 20 }}>{formatRupees(available)}</h3></Card>
      {pending ? <div className="banner">You already have a payout request pending. You can request again once it's paid.</div> : null}
      <Field label="Amount (₹)" error={errs.amount} hint={`Minimum ${formatRupees(MIN_PAYOUT)}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" disabled={pending} /></Field>
      <Field label="UPI ID" error={errs.upi} hint="You'll enter this each time. It isn't saved as a payment method."><Input id="upi-input" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@upi" disabled={pending} autoComplete="off" /></Field>
      <Button variant="primary" block disabled={pending} onClick={submit}>Request payout</Button>
      <p className="section-label">Payout history</p>
      {fixtures.userPayouts.map((p) => (
        <div className="txn" key={p.id} style={{ cursor: "default" }}>
          <span>{p.whenLabel}<div className="muted">{p.upiMasked}{p.paidBy ? ` · paid by ${p.paidBy}` : ""}</div></span>
          <StatusPill tone={p.status === "paid" ? "green" : "amber"}>{p.status === "paid" ? "Paid" : "Pending"} {formatRupees(p.amount)}</StatusPill>
        </div>
      ))}
      <p className="hint" style={{ marginTop: 20 }}>Demo: enter <span className="mono">taken@upi</span> to see the "UPI belongs to another account" state.</p>
    </div></div></div>
  );
}

function IdentitiesScreen({ identities, activeId, onSwitch, onAdd, onBack }: {
  identities: Identity[]; activeId: string; onSwitch: (id: string) => void; onAdd: (email: string) => void; onBack: () => void;
}) {
  const [email, setEmail] = useState(""); const [err, setErr] = useState("");
  return (
    <div className="screen"><TopBar title="My emails" onBack={onBack} /><div className="scrollarea"><div className="content">
      <p className="muted">One login, several emails. Pick the email you want to claim tasks with. Earnings from all emails go into one wallet.</p>
      {identities.map((i) => (
        <Card key={i.id}>
          <h3>{i.email}</h3>
          <div className="row">
            <span>{i.isPrimary ? <StatusPill tone="teal">Main login</StatusPill> : <StatusPill tone="gray">Sub-account</StatusPill>} <span className="muted">earned {formatRupees(i.earned)}</span></span>
            {i.id === activeId ? <StatusPill tone="green">Active</StatusPill> : <Button onClick={() => onSwitch(i.id)}>Use this email</Button>}
          </div>
        </Card>
      ))}
      <p className="section-label">Add an email</p>
      <Field label="New email" error={err}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="another@example.com" /></Field>
      <Button block onClick={() => { if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter a valid email."); if (identities.some((i) => i.email === email)) return setErr("That email is already added."); setErr(""); onAdd(email); setEmail(""); }}>Add email</Button>
    </div></div></div>
  );
}
