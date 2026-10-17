import { useMemo, useState } from "react";
import { activeTill, dateParts, fixtures, formatLimit, walletTotals, type Claim, type Identity, type PayoutRequest, type PayoutScenario, type Task } from "@rr/core";
import { formatRupees, parseRupees, rupees, type Paise } from "@rr/money";
import {
  BottomNav, Button, Card, Chips, CopyButton, Countdown, EmptyState, Field, FileUpload, Input, Notice, Select,
  Sheet, StatusPill, Tabs, Textarea, Toast, TopBar
} from "../../primitives";
import { markPaid, maskUpi, requestPayout, usePayouts } from "../../demo/payoutStore";
import { CreateTicketBody, HelpScreen, TicketChatScreen, type HelpTab } from "./HelpScreens";
import { AuthFlow, type AuthView, type SignUpField } from "../auth/AuthFlow";
import { CodeForm, messageOf } from "../auth/CodeForm";
import { useServices } from "../../services";
import type { CodeSent } from "@rr/core";

export type UserScreen =
  | "login" | "register" | "verifyEmail" | "createPassword" | "forgot" | "resetVerify" | "resetPassword" | "board" | "detail" | "claimed" | "mytasks" | "submit" | "submitted"
  | "wallet" | "payout" | "payoutSent" | "identities" | "help" | "createTicket" | "ticket";
export type MyTab = "active" | "review" | "completed" | "rejected";

const NAV = [
  { id: "board", label: "Tasks", icon: "tasks" as const },
  { id: "mytasks", label: "My tasks", icon: "mytasks" as const },
  { id: "wallet", label: "Wallet", icon: "wallet" as const },
  { id: "payout", label: "Payout", icon: "payout" as const },
  { id: "help", label: "Help", icon: "help" as const }
];
const TAB_OF: Partial<Record<UserScreen, string>> = {
  board: "board", detail: "board", claimed: "board",
  mytasks: "mytasks", submit: "mytasks", submitted: "mytasks",
  wallet: "wallet",
  payout: "payout", payoutSent: "payout",
  help: "help", createTicket: "help", ticket: "help", identities: "board"
};
const MIN_PAYOUT = rupees(10);

/** Screens that belong to the sign-in flow, mapped to the AuthFlow step they open on. */
const AUTH_VIEW: Partial<Record<UserScreen, AuthView>> = {
  login: "signIn", register: "signUp", verifyEmail: "verify", createPassword: "createPassword",
  forgot: "forgot", resetVerify: "resetVerify", resetPassword: "resetPassword"
};
export const isUserAuthScreen = (s: UserScreen): boolean => s in AUTH_VIEW;
const SIGN_UP_FIELDS: SignUpField[] = [{ key: "name", label: "Full name" }, { key: "phone", label: "Phone", type: "tel" }];

/** Demo-only text assignment. The real balanced random bag lives on the server (step 6). */
function demoText(task: Task, n: number): string | undefined {
  if (task.textMode === "manual_pool") return fixtures.scriptPool[n % fixtures.scriptPool.length];
  if (task.textMode === "ai_generated") {
    return `Hi, I wanted to follow up about ${task.keywords.join(" and ") || task.title}. We can get you set up quickly and our team will support the onboarding. Would you be open to a short call this week?`;
  }
  return undefined;
}

export interface UserAppProps {
  initialScreen?: UserScreen;
  initialTab?: MyTab;
  loggedIn?: boolean;
  /** start in an isolated payout scenario (ui-hub). Without it the app shares its payouts with the admin app, so an admin confirming a payment shows up here. */
  payoutScenario?: PayoutScenario;
  initialTicketId?: string;
  initialHelpTab?: HelpTab;
}

export function UserApp({ initialScreen = "board", initialTab = "active", loggedIn: initialLoggedIn = true, payoutScenario, initialTicketId = "tk1042", initialHelpTab = "open" }: UserAppProps) {
  const [screen, setScreen] = useState<UserScreen>(initialScreen);
  const [tab, setTab] = useState<MyTab>(initialTab);
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn);
  const [next, setNext] = useState<UserScreen | null>(null);
  const [taskId, setTaskId] = useState(initialScreen === "detail" ? "t3" : "t1");
  const [claims, setClaims] = useState<Claim[]>(fixtures.claims);
  const [identities, setIdentities] = useState<Identity[]>(fixtures.identities);
  const [identityId, setIdentityId] = useState("i1");
  const [toast, setToast] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState(initialTicketId);
  const [helpTab, setHelpTab] = useState<HelpTab>(initialHelpTab);
  const shared = usePayouts();
  const [local, setLocal] = useState<PayoutRequest[] | null>(() => (payoutScenario ? fixtures.payoutScenarios[payoutScenario] : null));
  const payouts = local ?? shared;

  const task = fixtures.tasks.find((t) => t.id === taskId) ?? fixtures.tasks[0]!;
  const identity = identities.find((i) => i.id === identityId) ?? identities[0]!;
  const { auth } = useServices();
  const show = (s: UserScreen) => setScreen(s);
  const logOut = async () => { await auth.signOut(); setLoggedIn(false); setNext(null); show("login"); };
  const notify = (m: string) => setToast(m);

  function claimTask() {
    if (!loggedIn) { setNext("claimed"); show("login"); return; }
    const already = claims.some((c) => c.taskId === task.id && c.identityId === identityId && c.status !== "void" && c.status !== "expired");
    if (already) return;
    const count = claims.filter((c) => c.taskId === task.id).length;
    const text = demoText(task, count);
    setClaims([{ id: `c${claims.length + 1}`, taskId: task.id, identityId, status: "claimed", ...(task.timerMinutes === null ? {} : { minutesLeft: task.timerMinutes }), ...(text ? { assignedText: text } : {}) }, ...claims]);
    show("claimed");
  }

  function submitProof(claimId: string) {
    setClaims(claims.map((c) => (c.id === claimId ? { ...c, status: "under_review", submittedLabel: "just now" } : c)));
    show("submitted");
  }

  const [submitClaimId, setSubmitClaimId] = useState("c1");
  const wallet = fixtures.wallet;
  // Wallet numbers are always derived, never stored. A request blocks its amount the moment it is made.
  const { withdrawn, processing: inProcess, available } = walletTotals(wallet.earned, payouts);

  let body: JSX.Element;
  switch (screen) {
    case "login": case "register": case "verifyEmail": case "createPassword": case "forgot": case "resetVerify": case "resetPassword": body = (
      <AuthFlow key={screen} brand="Task board" signUpFields={SIGN_UP_FIELDS} initialView={AUTH_VIEW[screen]!} initialEmail={screen === "login" || screen === "register" || screen === "forgot" ? "" : "you@example.com"}
        {...(next ? { notice: "Log in to claim this task. You'll come back to it." } : {})}
        onAuthenticated={() => { setLoggedIn(true); show(next ? "detail" : "board"); setNext(null); }} />
    ); break;
    case "board": body = (
      <BoardScreen identity={identity} onIdentity={() => show("identities")} onOpen={(id) => { setTaskId(id); show("detail"); }} />
    ); break;
    case "detail": body = (
      <>
        <BoardScreen identity={identity} onIdentity={() => show("identities")} onOpen={(id) => { setTaskId(id); show("detail"); }} />
        <Sheet title="Task details" onClose={() => show("board")}>
          <DetailBody task={task} identities={identities} identityId={identityId} setIdentityId={setIdentityId} claims={claims}
            loggedIn={loggedIn} onClaim={claimTask} />
        </Sheet>
      </>
    ); break;
    case "claimed": body = <ClaimedScreen minutes={task.timerMinutes} onGo={() => { setTab("active"); show("mytasks"); }} onMore={() => show("board")} />; break;
    case "mytasks": body = (
      <MyTasksScreen tab={tab} setTab={setTab} claims={claims} identities={identities}
        onSubmit={(id) => { setSubmitClaimId(id); show("submit"); }} />
    ); break;
    case "submit": {
      const sc = claims.find((c) => c.id === submitClaimId);
      const st = fixtures.tasks.find((t) => t.id === sc?.taskId) ?? task;
      body = (
        <>
          <MyTasksScreen tab="active" setTab={setTab} claims={claims} identities={identities} onSubmit={(id) => { setSubmitClaimId(id); show("submit"); }} />
          <Sheet title="Submit proof" onClose={() => show("mytasks")}>
            <SubmitBody task={st} onSubmit={() => submitProof(submitClaimId)} />
          </Sheet>
        </>
      );
      break;
    }
    case "submitted": body = (
      <div className="screen"><TopBar title="Submitted" /><div className="scrollarea"><div className="content narrow center">
        <div className="center-icon">&#10003;</div>
        <p className="center-text">Proof submitted. Moved to Under review.</p>
        <Button block style={{ marginTop: 20 }} onClick={() => { setTab("review"); show("mytasks"); }}>View under review</Button>
      </div></div></div>
    ); break;
    case "wallet": body = <WalletScreen identities={identities} earned={wallet.earned} withdrawn={withdrawn} inProcess={inProcess} available={available} payouts={payouts} />; break;
    case "payout": body = (
      <PayoutScreen available={available} inProcess={inProcess} payouts={payouts}
        onRequest={(amt, upi) => {
          if (local) setLocal([{ id: `p${local.length + 10}`, who: "You", amount: amt, status: "pending", upiMasked: maskUpi(upi), upiFull: upi, whenLabel: "just now", at: new Date().toISOString() }, ...local]);
          else requestPayout(amt, upi);
          show("payoutSent");
        }}
        onHelp={() => show("help")}
        onDemoPaid={() => {
          const pending = payouts.find((p) => p.status === "pending");
          if (!pending) return;
          if (local) setLocal(local.map((p) => (p.id === pending.id ? { ...p, status: "paid", paidBy: "Anil (Payments)", paidAt: new Date().toISOString() } : p)));
          else markPaid(pending.id, "Anil (Payments)");
          notify("Demo: admin marked it paid");
        }} />
    ); break;
    case "payoutSent": {
      const req = payouts.find((p) => p.status === "pending");
      body = (
        <div className="screen"><TopBar title="Request sent" /><div className="scrollarea"><div className="content narrow center">
          <div className="center-icon">&#10003;</div>
          <p className="center-text" style={{ fontWeight: 500 }}>Payout requested</p>
          {req ? (
            <Card>
              <div className="stat"><span>Amount</span><span>{formatRupees(req.amount)}</span></div>
              <div className="stat"><span>UPI ID</span><span>{req.upiMasked}</span></div>
              <div className="stat last"><span>Status</span><StatusPill tone="amber">Processing</StatusPill></div>
            </Card>
          ) : null}
          <p className="center-text note-text">That amount is blocked from your balance now. We settle it manually within a few days. Once an admin pays and confirms it, it moves to Completed, is added to Total withdrawn and shows in your wallet transactions.</p>
          <Button variant="primary" block style={{ marginTop: 20 }} onClick={() => show("payout")}>View payout requests</Button>
        </div></div></div>
      );
      break;
    }
    case "help": body = <HelpScreen tab={helpTab} setTab={setHelpTab} onOpen={(id) => { setTicketId(id); show("ticket"); }} onCreate={() => show("createTicket")} />; break;
    case "createTicket": body = (
      <>
        <HelpScreen tab={helpTab} setTab={setHelpTab} onOpen={(id) => { setTicketId(id); show("ticket"); }} onCreate={() => show("createTicket")} />
        <Sheet title="Create ticket" onClose={() => show("help")}>
          <CreateTicketBody onCreated={() => { setHelpTab("open"); notify("Ticket created. Support will reply here."); show("help"); }} />
        </Sheet>
      </>
    ); break;
    case "ticket": body = <TicketChatScreen ticketId={ticketId} onBack={() => show("help")} onNew={() => show("createTicket")} />; break;
    case "identities": body = (
      <IdentitiesScreen identities={identities} activeId={identityId} onSwitch={(id) => { setIdentityId(id); notify("Switched email"); }}
        onAdd={(email) => { setIdentities([...identities, { id: `i${identities.length + 1}`, email, isPrimary: false, earned: 0n }]); notify("Email verified and added"); }}
        onLogout={logOut}
        onBack={() => show("board")} />
    ); break;
  }

  const tabId = TAB_OF[screen];
  return (
    <>
      {body}
      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
      {tabId ? <BottomNav brand="Task board" items={NAV} active={tabId} onSelect={(id) => { if (id === "mytasks") setTab("active"); show(id as UserScreen); }}
        footer={<><span className="who">{identity.email}</span><button className="link-btn" onClick={() => show("identities")}>My emails</button><button className="link-btn" onClick={logOut}>Log out</button></>} /> : null}
    </>
  );
}

/* ---------- Screens ---------- */

function BoardScreen({ identity, onIdentity, onOpen }: { identity: Identity; onIdentity: () => void; onOpen: (id: string) => void }) {
  return (
    <div className="screen">
      <TopBar title="Tasks" subtitle={`${fixtures.tasks.filter((t) => t.status !== "closed" && t.status !== "removed").length} tasks you can claim`} right={<button className="identity-chip" onClick={onIdentity} aria-label="Switch email">{identity.email} &#9662;</button>} />
      <div className="scrollarea"><div className="content"><div className="card-grid">
        {fixtures.tasks.map((t) => {
          const till = activeTill(t.activeUntil);
          const closed = till.kind === "closed" || t.status === "closed" || t.status === "removed";
          const tone = closed ? "coral" : till.kind === "left" ? "amber" : "teal";
          return (
            <Card key={t.id} {...(closed ? {} : { onClick: () => onOpen(t.id) })}>
              <h3>{t.title}</h3>
              <p>Reward {formatRupees(t.reward)} &middot; {t.slotsTotal === null ? "unlimited slots" : `${t.slotsRemaining} of ${t.slotsTotal} slots left`}</p>
              <div className="row tight">
                <StatusPill tone={tone}>{closed ? "Closed" : till.kind === "none" ? "Active · no end date" : `Active till: ${till.label}`}</StatusPill>
                <Button compact disabled={closed}>View</Button>
              </div>
            </Card>
          );
        })}
      </div></div></div>
    </div>
  );
}

function DetailBody({ task, identities, identityId, setIdentityId, claims, loggedIn, onClaim }: {
  task: Task; identities: Identity[]; identityId: string; setIdentityId: (id: string) => void;
  claims: Claim[]; loggedIn: boolean; onClaim: () => void;
}) {
  const already = claims.some((c) => c.taskId === task.id && c.identityId === identityId && c.status !== "void" && c.status !== "expired");
  return (
    <>
      <h3 style={{ fontSize: 17, margin: "0 0 6px", fontFamily: "var(--font-body)", fontWeight: 500 }}>{task.title}</h3>
      <p className="note-text" style={{ margin: 0 }}>{task.description}</p>
      <div className="info-grid">
        <div className="info-cell neutral">
          <span className="info-label">Task site &#8599;</span>
          <span className="info-value"><a href={task.siteUrl} target="_blank" rel="noreferrer noopener" title={task.siteUrl}>{task.siteUrl.replace("https://", "")}</a></span>
        </div>
        <div className="info-cell amber">
          <span className="info-label">Time limit</span>
          <span className="info-value time">{formatLimit(task.timerMinutes)}</span>
        </div>
        <div className="info-cell green">
          <span className="info-label">Reward</span>
          <span className="info-value big">{formatRupees(task.reward)}</span>
        </div>
        <div className="info-cell neutral">
          <span className="info-label">Slots remaining</span>
          <span className="info-value big">{task.slotsTotal === null ? "Unlimited" : `${task.slotsRemaining} of ${task.slotsTotal}`}</span>
        </div>
      </div>
      {loggedIn ? (
        <Field label="Claim as" hint="Each email can claim this task once.">
          <Select value={identityId} onChange={(e) => setIdentityId(e.target.value)}>
            {identities.map((i) => <option key={i.id} value={i.id}>{i.email}</option>)}
          </Select>
        </Field>
      ) : null}
      <Button variant="primary" block disabled={already} onClick={onClaim}>{already ? "Already claimed from this email" : loggedIn ? "Claim task" : "Log in to claim"}</Button>
    </>
  );
}

function ClaimedScreen({ minutes, onGo, onMore }: { minutes: number | null; onGo: () => void; onMore: () => void }) {
  return (
    <div className="screen"><TopBar title="Task accepted" /><div className="scrollarea"><div className="content narrow center">
      <div className="center-icon">&#10003;</div>
      <p className="center-text" style={{ fontWeight: 500 }}>Task accepted</p>
      <p className="center-text note-text">{minutes === null ? "There is no time limit." : `Complete it within ${formatLimit(minutes)}.`} Find it under My tasks &rarr; Active.</p>
      <Button variant="primary" block style={{ marginTop: 20 }} onClick={onGo}>Go to My tasks</Button>
      <Button block style={{ marginTop: 8 }} onClick={onMore}>Select more tasks</Button>
    </div></div></div>
  );
}

function MyTasksScreen({ tab, setTab, claims, identities, onSubmit }: {
  tab: MyTab; setTab: (t: MyTab) => void; claims: Claim[]; identities: Identity[]; onSubmit: (id: string) => void;
}) {
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
        <div className="card-grid">{list.map((c) => {
          const t = fixtures.tasks.find((x) => x.id === c.taskId);
          return (
            <Card key={c.id}>
              {c.status === "claimed" ? (
                <div className="card-head"><h3>{title(c)}</h3>{c.minutesLeft === undefined ? <StatusPill tone="gray">No time limit</StatusPill> : <Countdown minutes={c.minutesLeft} />}</div>
              ) : <h3>{title(c)}</h3>}
              {c.status === "claimed" ? <p className="muted">{email(c)}</p> : null}
              {c.status === "claimed" && t ? (<>
                <div className="active-row">
                  <div className="info-cell white">
                    <span className="info-label">Task site &#8599;</span>
                    <span className="info-value"><a href={t.siteUrl} target="_blank" rel="noreferrer noopener" title={t.siteUrl}>{t.siteUrl.replace("https://", "")}</a></span>
                  </div>
                  <Button onClick={() => onSubmit(c.id)}>Submit proof</Button>
                </div>
                <div className="task-text">
                  {t.keywords.length ? (<><div className="section-label">Keywords</div><Chips items={t.keywords} /></>) : null}
                  {c.assignedText ? (<>
                    <textarea className="script-box" readOnly aria-label="Script to use" rows={Math.min(9, Math.ceil(c.assignedText.length / 38))} value={c.assignedText} />
                    <div className="row"><span /><CopyButton text={c.assignedText} /></div>
                  </>) : null}
                  {!t.keywords.length && !c.assignedText ? <p className="hint" style={{ marginTop: 12 }}>You are free to use your own script.</p> : null}
                </div>
              </>) : null}
              {c.status === "under_review" ? (<>
                <div className="tagrow"><StatusPill tone="gray">{email(c)}</StatusPill><StatusPill tone="teal">Under review</StatusPill></div>
                <p className="small" style={{ marginTop: 8 }}>Submitted {c.submittedLabel}</p>
              </>) : null}
              {(c.status === "approved" || c.status === "partial") ? (<>
                <div className="tagrow"><StatusPill tone="gray">{email(c)}</StatusPill><StatusPill tone={c.status === "approved" ? "green" : "amber"}>{c.status === "approved" ? "Approved" : `Partial · ${c.outcome}%`}</StatusPill></div>
                {c.reviewedLabel ? <p className="small" style={{ marginTop: 8 }}>Reviewed {c.reviewedLabel}</p> : null}
                <Notice tone={c.status === "approved" ? "green" : "amber"}>
                  <div>{c.status === "approved"
                    ? `Completed successfully. Task amount ${formatRupees(t?.reward ?? 0n)} added to your wallet.`
                    : `Completed successfully. ${formatRupees(c.credited ?? 0n)} of ${formatRupees(t?.reward ?? 0n)} added to your wallet.`}</div>
                  {c.status === "partial" && c.reviewerNote ? <div className="notice-note">Reviewer note: {c.reviewerNote}</div> : null}
                </Notice>
              </>) : null}
              {(c.status === "rejected" || c.status === "expired" || c.status === "void") ? (<>
                <div className="tagrow"><StatusPill tone="gray">{email(c)}</StatusPill><StatusPill tone="coral">{c.status === "rejected" ? "Rejected · 0%" : c.status === "expired" ? "Expired" : "Voided"}</StatusPill></div>
                {c.reviewedLabel ? <p className="small" style={{ marginTop: 8 }}>{c.status === "rejected" ? "Reviewed" : "Ended"} {c.reviewedLabel}</p> : null}
                <Notice tone="coral">
                  {c.status === "rejected" ? `${c.reviewerNote ? c.reviewerNote + " " : ""}No payout for this task.` : c.status === "expired" ? "Timer ran out. No payout for this task." : "Task was removed. No payout for this task."}
                </Notice>
              </>) : null}
            </Card>
          );
        })}</div>
      </div></div>
    </div>
  );
}

function SubmitBody({ task, onSubmit }: { task: Task; onSubmit: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [note, setNote] = useState(""); const [err, setErr] = useState("");
  return (
    <>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Upload a screenshot proving you completed "{task.title}". JPG, PNG or WebP, up to 5 MB.</p>
      <FileUpload label="Tap to upload screenshot" onFile={(f) => { setFile(f); setErr(""); }} />
      <Field label="Note (optional)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the reviewer should know" /></Field>
      {err ? <div className="field-error" role="alert" style={{ marginBottom: 8 }}>{err}</div> : null}
      <Button variant="primary" block onClick={() => (file ? onSubmit() : setErr("Attach a screenshot first."))}>Submit for review</Button>
    </>
  );
}

const when = (iso: string | undefined): string => { if (!iso) return ""; const d = dateParts(iso); return `${d.date}, ${d.time}`; };

interface TxRowProps {
  id: string; at: string; title: string; sub: string; amount: string; income?: boolean; badge?: React.ReactNode;
  details: [string, string][]; open: boolean; onToggle: () => void;
}
/** One transaction: date/time | title + sub | amount, expanding in place to show details. */
function TxRow({ id, at, title, sub, amount, income, badge, details, open, onToggle }: TxRowProps) {
  const { date, time } = dateParts(at);
  return (
    <div className="tx">
      <button className="tx-row" aria-expanded={open} aria-controls={`tx-${id}`} onClick={onToggle}>
        <span className="tx-when"><span className="tx-date">{date}</span><span className="tx-time">{time}</span></span>
        <span className="tx-main"><span className="tx-title">{title}</span><span className="tx-sub">{sub}</span></span>
        <span className={`tx-amt ${income ? "in" : ""}`}>{amount}{badge ? <span className="tx-badge">{badge}</span> : null}</span>
        <span className={`tx-chev${open ? " open" : ""}`} aria-hidden="true">&#9662;</span>
      </button>
      {open ? <dl className="tx-detail" id={`tx-${id}`}>{details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null}
    </div>
  );
}

function payoutDetails(p: PayoutRequest): [string, string][] {
  return [
    ["Status", p.status === "paid" ? "Paid" : "Processing. The amount is blocked until an admin pays and confirms it."],
    ["Amount", formatRupees(p.amount)],
    ["UPI ID", p.upiMasked],
    ["Requested", when(p.at)],
    ...(p.status === "paid" ? [["Paid on", when(p.paidAt)] as [string, string], ["Paid by", p.paidBy ?? ""] as [string, string]] : [])
  ];
}

function WalletScreen({ identities, earned, withdrawn, inProcess, available, payouts }: {
  identities: Identity[]; earned: Paise; withdrawn: Paise; inProcess: Paise; available: Paise; payouts: PayoutRequest[];
}) {
  const [open, setOpen] = useState(false);
  const [openTx, setOpenTx] = useState<string | null>(null);
  const w = fixtures.wallet;
  const email = (id: string) => identities.find((i) => i.id === id)?.email ?? "";
  type Tx = { id: string; at: string; title: string; sub: string; amount: string; income: boolean; details: [string, string][] };
  // Only approved and paid withdrawals appear here. A request still processing shows on the Payout page.
  const txns: Tx[] = [
    ...w.entries.map((e): Tx => ({
      id: e.id, at: e.at, title: e.title, sub: email(e.identityId), amount: `+${formatRupees(e.credited)}`, income: true,
      details: [
        ["Result", e.outcome === 100 ? "Approved 100%" : `Partial approval ${e.outcome}%`],
        ["Task amount", formatRupees(e.reward)],
        ["Added to wallet", e.outcome === 100 ? formatRupees(e.credited) : `${formatRupees(e.credited)} of ${formatRupees(e.reward)}`],
        ["Email used", email(e.identityId)]
      ]
    })),
    ...payouts.filter((p) => p.status === "paid").map((p): Tx => ({
      id: p.id, at: p.paidAt ?? p.at ?? "", title: "Withdrawal", sub: p.upiMasked, amount: `\u2212${formatRupees(p.amount)}`, income: false, details: payoutDetails(p)
    }))
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <div className="screen"><TopBar title="Wallet" subtitle="Your earnings and withdrawals" /><div className="scrollarea"><div className="content"><div className="two-col"><div className="sticky">
      <Card hero>
        <div className="stat"><span>Total earned</span><span>{formatRupees(earned)}</span></div>
        <div className="stat"><span>Total withdrawn</span><span>{formatRupees(withdrawn)}</span></div>
        {inProcess > 0n ? <div className="stat" style={{ color: "var(--amber)" }}><span>Withdrawal in process</span><span>{formatRupees(inProcess)}</span></div> : null}
        <div className="stat last"><span>Withdrawable balance</span><span>{formatRupees(available)}</span></div>
        <button className="expander" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} earnings by email</button>
        {open ? identities.map((i) => <div key={i.id} className="stat"><span>{i.email}</span><span>{formatRupees(i.earned)}</span></div>) : null}
      </Card>
      </div><div>
      <h2 className="section-title">Transactions</h2>
      {txns.length === 0 ? <EmptyState>No transactions yet.</EmptyState> : null}
      {txns.map((t) => (
        <TxRow key={t.id} id={t.id} at={t.at} title={t.title} sub={t.sub} amount={t.amount} income={t.income} details={t.details}
          open={openTx === t.id} onToggle={() => setOpenTx(openTx === t.id ? null : t.id)} />
      ))}
    </div></div></div></div></div>
  );
}

function PayoutScreen({ available, inProcess, payouts, onRequest, onDemoPaid, onHelp }: {
  available: Paise; inProcess: Paise; payouts: PayoutRequest[]; onRequest: (amt: Paise, upi: string) => void; onDemoPaid: () => void; onHelp: () => void;
}) {
  const [amount, setAmount] = useState(""); const [upi, setUpi] = useState(""); const [errs, setErrs] = useState<{ amount?: string; upi?: string }>({});
  const [openTx, setOpenTx] = useState<string | null>(null);
  const pending = inProcess > 0n;
  function submit() {
    const e: typeof errs = {};
    const amt = parseRupees(amount);
    if (amt === null) e.amount = "Enter an amount in rupees, like 100 or 150.50.";
    else if (amt < MIN_PAYOUT) e.amount = `Minimum payout is ${formatRupees(MIN_PAYOUT)}.`;
    else if (amt > available) e.amount = `You can withdraw up to ${formatRupees(available)}.`;
    if (!/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(upi)) e.upi = upi ? "That doesn't look like a UPI ID (name@bank)." : "Enter a UPI ID before requesting payout.";
    setErrs(e);
    if (!e.amount && !e.upi && amt !== null) {
      onRequest(amt, upi);
    }
  }
  return (
    <div className="screen"><TopBar title="Payout" subtitle="Withdraw your balance to your UPI ID" right={<button className="identity-chip" onClick={onHelp}>Help</button>} /><div className="scrollarea"><div className="content"><div className="two-col"><div>
      <Card hero>
        <p style={{ fontSize: 12, margin: "0 0 4px" }}>Withdrawable balance</p>
        <h3 style={{ fontSize: 20 }}>{formatRupees(available)}</h3>
        {pending ? <p className="small" style={{ marginTop: 4, color: "var(--amber)" }}>{formatRupees(inProcess)} is processing and blocked until it is paid.</p> : null}
      </Card>
      {pending ? <div className="banner">You already have a payout request processing. You can request again once it's paid.</div> : null}
      <Field label="Amount (₹)" error={errs.amount} hint={`Minimum ${formatRupees(MIN_PAYOUT)}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10" disabled={pending} /></Field>
      <Field label="UPI ID" error={errs.upi} hint="You'll enter this each time. It isn't saved as a payment method."><Input id="upi-input" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@upi" disabled={pending} autoComplete="off" /></Field>
      <Button variant="primary" block disabled={pending} onClick={submit}>Request payout</Button>
      </div><div>
      <h2 className="section-title">Payout requests</h2>
      {payouts.length === 0 ? <EmptyState>No payout requests yet.</EmptyState> : null}
      {[...payouts].sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1)).map((p) => (
        <TxRow key={p.id} id={`po-${p.id}`} at={p.at ?? ""} title="Payout request" sub={p.upiMasked} amount={formatRupees(p.amount)}
          badge={<StatusPill tone={p.status === "paid" ? "green" : "amber"}>{p.status === "paid" ? "Paid" : "Processing"}</StatusPill>}
          details={payoutDetails(p)} open={openTx === p.id} onToggle={() => setOpenTx(openTx === p.id ? null : p.id)} />
      ))}
      {pending ? <p className="hint">Demo: <button className="expander" style={{ padding: 0, minHeight: 0 }} onClick={onDemoPaid}>admin marks the request as paid</button></p> : null}
    </div></div></div></div></div>
  );
}

function IdentitiesScreen({ identities, activeId, onSwitch, onAdd, onLogout, onBack }: {
  identities: Identity[]; activeId: string; onSwitch: (id: string) => void; onAdd: (email: string) => void; onLogout: () => void; onBack: () => void;
}) {
  const { emailVerification } = useServices();
  const [email, setEmail] = useState(""); const [err, setErr] = useState("");
  const [verifying, setVerifying] = useState<{ email: string; sent: CodeSent } | null>(null);
  async function sendCode() {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("Enter a valid email.");
    if (identities.some((i) => i.email.toLowerCase() === email.trim().toLowerCase())) return setErr("That email is already added.");
    setErr("");
    try { setVerifying({ email, sent: await emailVerification.send(email) }); } catch (e) { setErr(messageOf(e)); }
  }
  return (
    <div className="screen"><TopBar title="My emails" onBack={onBack} /><div className="scrollarea"><div className="content narrow">
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
      {verifying ? (
        <Card>
          <CodeForm email={verifying.email} sent={verifying.sent} cancelLabel="Use a different email" onCancel={() => setVerifying(null)}
            intro={<p className="note-text" style={{ marginTop: 0 }}>We sent a 6-digit code to <strong>{verifying.email}</strong> to confirm it.</p>}
            onVerify={async (code) => { await emailVerification.verify(verifying.email, code); onAdd(verifying.email); setVerifying(null); setEmail(""); }}
            onResend={async () => { const sent = await emailVerification.send(verifying.email); setVerifying({ email: verifying.email, sent }); return sent; }} />
        </Card>
      ) : (<>
        <Field label="New email" error={err} hint="We email one code to confirm it."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="another@example.com" /></Field>
        <Button block onClick={() => { void sendCode(); }}>Send code</Button>
      </>)}
      <hr className="divider" />
      <Button block onClick={onLogout}>Log out</Button>
    </div></div></div>
  );
}
