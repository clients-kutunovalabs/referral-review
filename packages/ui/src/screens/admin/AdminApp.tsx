import { useEffect, useState, type ReactElement } from "react";
import { ApiError,
  activeTill, agoLabel, formatLimit, hoursToMinutes, PERMISSIONS, TEXT_MODE_HELP, TEXT_MODE_LABEL, TEXT_MODE_ORDER, whenLabel,
  type AdminMember, type AdminTaskDetail, type AdminTaskRow, type AdminUserRow, type NewTaskInput, type PayoutRequest, type PermissionKey, type ReviewQueueItem, type Role, type TextMode
} from "@rr/core";
import { OUTCOME_PERCENTS, formatRupees, outcomeAmount, parseRupees, type OutcomePercent } from "@rr/money";
import {
  BottomNav, DataTable, Icon, Segmented, Sheet, useLayout, type Column, type IconName, Button, Card, Chips, ConfirmSheet, CopyButton, EmptyState, Field, FileUpload, Input, ListRow, Select,
  StatusPill, Tabs, Textarea, Toast, TopBar
} from "../../primitives";
import { ErrorBox, LoadMore, Loading, PAGE, isUnauthenticated, messageOf, useAsync, useRefreshOnFocus } from "../../data";
import { useServices } from "../../services";
import { useBrowserHistory } from "../../lib/useBrowserHistory";
import { AuthFlow } from "../auth/AuthFlow";
import { ChangePassword } from "../auth/ChangePassword";
import { AdminTicketChat, AdminTicketList, type SupportTab } from "./SupportScreens";

export type AdminScreen =
  | "login" | "dashboard" | "tasks" | "newtask" | "taskdetail"
  | "reviewqueue" | "reviewitem" | "payouts" | "payoutitem"
  | "userdetail" | "tickets" | "ticket" | "access";
type AccessTab = "users" | "team" | "roles";
const ADMIN_SCREENS: ReadonlySet<string> = new Set<AdminScreen>(["login", "dashboard", "tasks", "newtask", "taskdetail", "reviewqueue", "reviewitem", "payouts", "payoutitem", "userdetail", "tickets", "ticket", "access"]);
/** Which pieces of state belong in the address, per screen. */
const URL_KEYS: Partial<Record<string, readonly string[]>> = { taskdetail: ["taskId"], reviewitem: ["reviewId"], payoutitem: ["payoutId"], userdetail: ["userId"], ticket: ["ticketId"], access: ["accessTab"] };
const ACCESS_TABS: ReadonlySet<string> = new Set<AccessTab>(["users", "team", "roles"]);

/** Screen -> permission needed. Mirrors the server, which checks the database on every request. */
const NEEDS: Partial<Record<AdminScreen, PermissionKey[]>> = {
  tasks: ["task.manage", "task_text.manage"], newtask: ["task.manage"], taskdetail: ["task.manage", "task_text.manage"],
  reviewqueue: ["review.decide"], reviewitem: ["review.decide"],
  payouts: ["payout.mark_paid"], payoutitem: ["payout.mark_paid"],
  userdetail: ["user.manage"], access: ["user.manage", "role.manage"],
  tickets: ["ticket.manage"], ticket: ["ticket.manage"]
};
const NAV_DEF: { id: AdminScreen; tab: string; label: string; longLabel: string; icon: IconName; wideOnly?: boolean }[] = [
  { id: "dashboard", tab: "dashboard", label: "Home", longLabel: "Dashboard", icon: "home" },
  { id: "tasks", tab: "tasks", label: "Tasks", longLabel: "Tasks", icon: "tasks" },
  { id: "reviewqueue", tab: "review", label: "Review", longLabel: "Review queue", icon: "review" },
  { id: "payouts", tab: "payouts", label: "Payouts", longLabel: "Payouts", icon: "payout" },
  { id: "tickets", tab: "support", label: "Support", longLabel: "Support", icon: "support" },
  // Phone reaches this from the dashboard's profile button; tablet and desktop get a nav item of its own.
  { id: "access", tab: "access", label: "Users", longLabel: "Users and roles", icon: "people", wideOnly: true }
];
const TAB_OF: Partial<Record<AdminScreen, string>> = {
  dashboard: "dashboard", tasks: "tasks", newtask: "tasks", taskdetail: "tasks",
  reviewqueue: "review", reviewitem: "review", payouts: "payouts", payoutitem: "payouts",
  userdetail: "access", tickets: "support", ticket: "support", access: "access"
};
const SCREEN_OF_KIND = { reviewqueue: "reviewqueue", tickets: "tickets", payouts: "payouts", tasks: "tasks" } as const;

const claimedText = (claimed: number, total: number | null) => (total === null ? "unlimited slots" : `${claimed} of ${total} claimed`);

function taskPill(t: AdminTaskRow) {
  const till = activeTill(t.activeUntil);
  if (t.status === "removed") return <StatusPill tone="coral">Removed</StatusPill>;
  if (t.status === "closed") return <StatusPill tone="gray">Closed</StatusPill>;
  if (t.status === "paused") return <StatusPill tone="gray">Paused</StatusPill>;
  return <StatusPill tone={till.kind === "left" ? "amber" : "teal"}>{till.kind === "none" ? "Active · no end date" : `Active till: ${till.label}`}</StatusPill>;
}

/** Same card idea as the user board: title, reward line, then a compact row with the status pill and the action button. */
function AdminTaskCard({ t, onOpen }: { t: AdminTaskRow; onOpen?: () => void }) {
  return (
    <Card {...(onOpen ? { onClick: onOpen } : {})}>
      <h3>{t.title}</h3>
      <p>{formatRupees(t.reward)} reward &middot; {claimedText(t.claimed, t.slotsTotal)} &middot; {formatLimit(t.timerMinutes)}{t.timerMinutes === null ? "" : " limit"}</p>
      <div className="card-split" style={{ marginTop: "var(--space-3)" }}>
        <div className="card-split-main"><div className="chips stack" style={{ margin: 0 }}>{taskPill(t)}<StatusPill tone="gray">Script: {TEXT_MODE_LABEL[t.textMode]}</StatusPill></div></div>
        {onOpen ? <Button compact onClick={(e) => { e.stopPropagation(); onOpen(); }}>Manage</Button> : null}
      </div>
    </Card>
  );
}

export interface AdminAppProps {
  initialScreen?: AdminScreen;
  /** Known sign-in state (ui-hub). Leave it out on the real site and the app asks the server. */
  loggedIn?: boolean;
  initialTaskId?: string;
  initialReviewId?: string;
  initialPayoutId?: string;
  initialUserId?: string;
  initialTicketId?: string;
  /** The real site only: Back, Forward, Reload and bookmarks follow the screen (address like `/admin#/payouts`). */
  syncUrl?: boolean;
  initialAccessTab?: AccessTab;
}

export function AdminApp({ initialScreen = "dashboard", loggedIn: loggedInProp, initialTaskId = "", initialReviewId = "", initialPayoutId = "", initialUserId = "", initialTicketId = "", initialAccessTab = "users", syncUrl = false }: AdminAppProps) {
  const { auth, api } = useServices();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(loggedInProp === undefined ? null : loggedInProp && initialScreen !== "login");
  const [screen, setScreen] = useState<AdminScreen>(initialScreen === "login" ? "dashboard" : initialScreen);
  const [accessTab, setAccessTab] = useState<AccessTab>(initialAccessTab);
  const [toast, setToast] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [taskId, setTaskId] = useState(initialTaskId);
  const [reviewId, setReviewId] = useState(initialReviewId);
  const [payoutId, setPayoutId] = useState(initialPayoutId);
  const [userId, setUserId] = useState(initialUserId);
  const [ticketId, setTicketId] = useState(initialTicketId);
  const [taskFilter, setTaskFilter] = useState<"active" | "closed">("active");
  const [supportTab, setSupportTab] = useState<SupportTab>("open");
  const [reviewSort, setReviewSort] = useState<"oldest" | "newest">("oldest");
  useBrowserHistory(syncUrl, { screen, accessTab, taskId, reviewId, payoutId, userId, ticketId }, (s) => {
    // Comes from the address bar or an old history entry, so check every value before using it. (Permissions are still checked per screen.)
    const next = s["screen"] as AdminScreen;
    if (!ADMIN_SCREENS.has(next) || next === "login") return;
    setScreen(next);
    setAccessTab(ACCESS_TABS.has(s["accessTab"] ?? "") ? (s["accessTab"] as AccessTab) : "users");
    setTaskId(s["taskId"] ?? ""); setReviewId(s["reviewId"] ?? ""); setPayoutId(s["payoutId"] ?? ""); setUserId(s["userId"] ?? ""); setTicketId(s["ticketId"] ?? "");
  }, { urlKeys: (x) => URL_KEYS[x] ?? [] });
  const layout = useLayout();
  const wide = layout !== "phone";
  const refresh = () => setRev((n) => n + 1);

  useEffect(() => {
    if (loggedIn !== null) return;
    auth.getSession().then((s) => setLoggedIn(!!s), () => setLoggedIn(false));
  }, [auth, loggedIn]);

  const me = useAsync(() => api.admin.me(), [rev], { enabled: loggedIn === true });
  // Nav badges come from the dashboard counts, refreshed in the background.
  const counts = useAsync(() => api.admin.dashboard(), [rev], { enabled: loggedIn === true && !!me.data, refreshMs: 30_000 });
  useEffect(() => { if (me.unauthenticated) setLoggedIn(false); }, [me.unauthenticated]);
  useRefreshOnFocus(counts.reload, loggedIn === true);

  const adminName = me.data?.name ?? "";
  const perms = new Set<PermissionKey>(me.data?.permissions ?? []);
  const can = (s: AdminScreen) => { const n = NEEDS[s]; return !n || n.some((p) => perms.has(p)); };
  const show = (s: AdminScreen) => setScreen(s);
  const notify = (m: string) => setToast(m);
  const guard = (e: unknown) => { if (isUnauthenticated(e)) setLoggedIn(false); else notify(messageOf(e)); };
  const logOut = async () => { await auth.signOut().catch(() => undefined); setLoggedIn(false); };
  const [pending, setPending] = useState<{ title: string; text: string; label: string; tone: "primary" | "danger"; run: () => void } | null>(null);

  const navItems = NAV_DEF.filter((n) => can(n.id)).map((n) => ({
    id: n.tab, label: n.label, longLabel: n.longLabel, icon: n.icon, ...(n.wideOnly ? { wideOnly: true } : {}),
    ...(n.id === "reviewqueue" && counts.data?.pendingReview ? { badge: counts.data.pendingReview } : {}),
    ...(n.id === "tickets" && counts.data?.ticketsNeedReply ? { badge: counts.data.ticketsNeedReply } : {})
  }));

  let body: ReactElement;
  if (loggedIn === null) body = <div className="screen"><Loading /></div>;
  else if (!loggedIn) body = <AuthFlow brand="Admin panel" allowSignUp={false} onAuthenticated={() => { setLoggedIn(true); refresh(); show("dashboard"); }} />;
  else if (me.loading && !me.data) body = <div className="screen"><TopBar title="Loading" /><Loading /></div>;
  else if (!me.data) {
    body = (
      <div className="screen"><TopBar title="Admin panel" /><div className="scrollarea"><div className="content narrow">
        <Card alert><p style={{ color: "var(--coral)" }}>{me.error ?? "This account is not an admin."}</p></Card>
        <Button block onClick={() => { void logOut(); }}>Log out</Button>
      </div></div></div>
    );
  } else if (!can(screen)) {
    body = (
      <div className="screen"><TopBar title="No access" /><div className="scrollarea"><div className="content">
        <Card alert><p style={{ color: "var(--coral)" }}>403. Your roles don't include permission for this screen.</p></Card>
        <Button block onClick={() => show("dashboard")}>Back to home</Button>
      </div></div></div>
    );
  } else switch (screen) {
    case "dashboard": body = <DashboardScreen adminName={adminName} wide={wide} can={can} rev={rev} go={show} onProfile={() => show("access")} />; break;
    case "tasks": body = <TasksScreen wide={wide} canCreate={perms.has("task.manage")} filter={taskFilter} setFilter={setTaskFilter} rev={rev} onNew={() => show("newtask")} onOpen={(id) => { setTaskId(id); show("taskdetail"); }} />; break;
    case "newtask": body = <NewTaskScreen onBack={() => show("tasks")} onPublish={async (input) => { await api.admin.createTask(input); notify("Task published"); refresh(); show("tasks"); }} />; break;
    case "taskdetail": body = <TaskDetailScreen taskId={taskId} canManage={perms.has("task.manage")} canTexts={perms.has("task_text.manage")} rev={rev} onBack={() => show("tasks")} notify={notify} guard={guard} onChanged={refresh} onGone={() => { refresh(); show("tasks"); }} />; break;
    case "reviewqueue": body = <ReviewQueueScreen wide={wide} sort={reviewSort} setSort={setReviewSort} rev={rev} onOpen={(id) => { setReviewId(id); show("reviewitem"); }} />; break;
    case "reviewitem": body = <ReviewItemScreen id={reviewId} rev={rev} onBack={() => show("reviewqueue")} onDone={(pct) => { notify(`Reviewed: ${pct}% credited`); refresh(); show("reviewqueue"); }} />; break;
    case "payouts": body = <PayoutsScreen wide={wide} rev={rev} onOpen={(id) => { setPayoutId(id); show("payoutitem"); }} />; break;
    case "payoutitem": body = <PayoutItemScreen id={payoutId} adminName={adminName} rev={rev} onBack={() => show("payouts")} onPaid={() => { notify(`Recorded: paid by ${adminName}`); refresh(); show("payouts"); }} />; break;
    case "tickets": body = <AdminTicketList tab={supportTab} setTab={setSupportTab} version={rev} onOpen={(id) => { setTicketId(id); show("ticket"); }} />; break;
    case "ticket": body = <AdminTicketChat ticketId={ticketId} canAssign={perms.has("ticket.manage")} onBack={() => { refresh(); show("tickets"); }} onChanged={refresh} />; break;
    case "access": body = (
      <AccessScreen me={me.data} wide={wide} perms={perms} tab={accessTab} setTab={setAccessTab} rev={rev} notify={notify} guard={guard} onChanged={refresh}
        onBack={() => show("dashboard")} onLogout={() => { void logOut(); }} onOpenUser={(id) => { setUserId(id); show("userdetail"); }} />
    ); break;
    case "userdetail": body = <UserDetailScreen userId={userId} rev={rev} onBack={() => { setAccessTab("users"); show("access"); }} setPending={setPending} notify={notify} guard={guard} onChanged={refresh} />; break;
    default: body = <div className="screen"><Loading /></div>;
  }

  const tab = TAB_OF[screen] ?? "dashboard";
  const showNav = loggedIn === true && !!me.data;
  return (
    <>
      {body}
      {pending ? <ConfirmSheet title={pending.title} tone={pending.tone} confirmLabel={pending.label} onCancel={() => setPending(null)} onConfirm={() => { const run = pending.run; setPending(null); run(); }}>{pending.text}</ConfirmSheet> : null}
      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
      {showNav ? <BottomNav brand="Admin panel" items={navItems} active={wide ? tab : tab === "access" ? "dashboard" : tab} onSelect={(t) => show(NAV_DEF.find((n) => n.tab === t)!.id)}
        footer={<><span className="who">{adminName}</span><button className="link-btn" onClick={() => { void logOut(); }}>Log out</button></>} /> : null}
    </>
  );
}

/* ---------- Screens ---------- */

type Can = (s: AdminScreen) => boolean;

function DashboardScreen({ adminName, wide, can, rev, go, onProfile }: { adminName: string; wide: boolean; can: Can; rev: number; go: (s: AdminScreen) => void; onProfile: () => void }) {
  const { api } = useServices();
  const { data: d, error, loading, reload } = useAsync(() => api.admin.dashboard(), [rev], { refreshMs: 30_000 });
  const cards: { go: AdminScreen; label: string; value: number; sub?: string }[] = d ? [
    { go: "reviewqueue", label: "Pending review", value: d.pendingReview },
    { go: "tasks", label: "Active tasks", value: d.activeTasks },
    { go: "payouts", label: "Payouts due", value: d.payoutsDue },
    { go: "tickets", label: "Open tickets", value: d.openTickets, ...(d.ticketsNeedReply ? { sub: `${d.ticketsNeedReply} need a reply` } : {}) }
  ] : [];
  const recent = (d?.recent ?? []).filter((r) => can(SCREEN_OF_KIND[r.kind]));
  const list = recent.map((r) => <ListRow key={`${r.kind}${r.at}${r.text}`} onClick={() => go(SCREEN_OF_KIND[r.kind])} title={r.text} sub={agoLabel(r.at)} />);
  return (
    <div className="screen">
      <TopBar title={wide ? "Dashboard" : "Admin panel"} subtitle={`Welcome back, ${adminName}`} right={wide ? undefined : (
        <button className="profile-btn" aria-label={`${adminName}, roles and permissions`} onClick={onProfile}>
          <Icon name="user" /><span>{adminName}</span><span className="chev" aria-hidden="true">&#9656;</span>
        </button>
      )} />
      <div className="scrollarea"><div className="content">
        {loading && !d ? <Loading /> : null}
        {error ? <ErrorBox message={error} onRetry={reload} /> : null}
        {d ? (<>
          <p className="section-label" style={{ marginTop: 0 }}>Needs your attention</p>
          <div className="metric-grid">
            {cards.filter((c) => can(c.go)).map((c) => (
              <button key={c.go} className="metric" onClick={() => go(c.go)}>
                <div className="num">{c.value}</div><div className="lbl">{c.label}</div>{c.sub ? <div className="sub">{c.sub}</div> : null}
              </button>
            ))}
          </div>
          <p className="section-label">Recent activity</p>
          {list.length === 0 ? <EmptyState>Nothing new yet.</EmptyState> : wide ? <Card>{list}</Card> : list}
        </>) : null}
      </div></div>
    </div>
  );
}

function TasksScreen({ wide, canCreate, filter, setFilter, rev, onNew, onOpen }: {
  wide: boolean; canCreate: boolean; filter: "active" | "closed"; setFilter: (f: "active" | "closed") => void; rev: number; onNew: () => void; onOpen: (id: string) => void;
}) {
  const { api } = useServices();
  const [limit, setLimit] = useState(PAGE);
  const { data, error, loading, reload } = useAsync(() => api.admin.listTasks({ status: filter, limit }), [rev, filter, limit]);
  const counts = useAsync(() => api.admin.taskCounts(), [rev]);
  const rows = data ?? [];
  const activeCount = counts.data?.active ?? 0; const closedCount = counts.data?.closed ?? 0;
  const more = rows.length >= limit;
  const columns: Column<AdminTaskRow>[] = [
    { key: "title", header: "Title", render: (r) => r.title },
    { key: "reward", header: "Reward", width: "90px", render: (r) => formatRupees(r.reward) },
    { key: "slots", header: "Slots", width: "100px", render: (r) => (r.slotsTotal === null ? "unlimited" : `${r.claimed} / ${r.slotsTotal}`) },
    { key: "timer", header: "Timer", width: "110px", render: (r) => formatLimit(r.timerMinutes) },
    { key: "script", header: "Script", width: "90px", hideOnTablet: true, render: (r) => TEXT_MODE_LABEL[r.textMode] },
    { key: "status", header: "Status", width: "180px", render: (r) => taskPill(r) }
  ];
  const open = (r: AdminTaskRow) => { if (r.status !== "removed") onOpen(r.id); };
  return (
    <div className="screen"><TopBar title={wide ? "Task templates" : "Tasks"} subtitle={`${activeCount + closedCount} templates · ${activeCount} active`} {...(canCreate ? { actions: <Button variant="primary" onClick={onNew}>New task</Button> } : {})} />
      <div className="scrollarea"><div className="content">
        <div className="tabs-bleed"><Tabs<"active" | "closed"> value={filter} onChange={(f) => { setLimit(PAGE); setFilter(f); }} tabs={[{ id: "active", label: `Active (${activeCount})` }, { id: "closed", label: `Closed (${closedCount})` }]} /></div>
        {loading ? <Loading /> : null}
        {error ? <ErrorBox message={error} onRetry={reload} /> : null}
        {!loading && !error && rows.length === 0 ? <EmptyState>{filter === "active" ? "No active tasks." : "Nothing closed yet."}</EmptyState> : null}
        {wide && rows.length ? <DataTable caption="Task templates" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={open} /> : null}
        {wide ? null : rows.map((r) => <AdminTaskCard key={r.id} t={r} {...(r.status !== "removed" ? { onOpen: () => onOpen(r.id) } : {})} />)}
        {more ? <LoadMore onClick={() => setLimit(limit + PAGE)} /> : null}
      </div></div>
      {canCreate && !wide ? <div className="screen-footer"><Button variant="primary" block onClick={onNew}>New task</Button></div> : null}
    </div>
  );
}

/** One block per script, plus button to add another. Blank blocks are ignored. */
function ScriptBlocks({ blocks, onChange }: { blocks: string[]; onChange: (b: string[]) => void }) {
  return (
    <div>
      {blocks.map((b, i) => (
        <div key={i} className="field" style={{ marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span>Script {i + 1}</span>
            {blocks.length > 1 ? <Button compact onClick={() => onChange(blocks.filter((_, j) => j !== i))} aria-label={`Remove script ${i + 1}`}>Remove</Button> : null}
          </div>
          <Textarea rows={4} value={b} onChange={(e) => onChange(blocks.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Write the script here" />
        </div>
      ))}
      <Button block onClick={() => onChange([...blocks, ""])}>+ Add another script</Button>
    </div>
  );
}

function NewTaskScreen({ onBack, onPublish }: { onBack: () => void; onPublish: (input: NewTaskInput) => Promise<void> }) {
  const [f, setF] = useState({ title: "", instructions: "", siteUrl: "", reward: "", slots: "", timer: "", till: "" });
  const [mode, setMode] = useState<TextMode>("none");
  const [keywords, setKeywords] = useState<string[]>([]); const [kw, setKw] = useState("");
  const [pool, setPool] = useState<string[]>([""]);
  const [ai, setAi] = useState({ tone: "", language: "", min: "", max: "", style: "" });
  const [errors, setErrors] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const scripts = pool.map((x) => x.trim()).filter(Boolean);
  const addKw = () => { const v = kw.trim(); if (v && !keywords.includes(v)) setKeywords([...keywords, v]); setKw(""); };

  async function publish() {
    const e: string[] = [];
    const reward = parseRupees(f.reward);
    const timer = hoursToMinutes(f.timer);
    if (!f.title.trim()) e.push("Title is required.");
    if (!f.instructions.trim()) e.push("Instructions are required.");
    if (!/^https:\/\/\S+\.\S+/.test(f.siteUrl)) e.push("Site link must be a valid https URL.");
    if (reward === null || reward <= 0n) e.push("Reward must be an amount in rupees.");
    if (f.slots && !/^\d+$/.test(f.slots)) e.push("Total slots must be a whole number or blank.");
    if (timer === "invalid") e.push("Time limit must be hours (e.g. 2 or 1.5) or blank for unlimited.");
    if (f.till && Date.parse(f.till) <= Date.now()) e.push("Active till must be in the future.");
    if (mode === "keywords" && keywords.length === 0) e.push("Add at least one keyword.");
    if (mode === "manual_pool" && scripts.length === 0) e.push("Add at least one script.");
    if (mode === "ai_generated") {
      if (f.instructions.trim().length < 20) e.push("AI needs a task description of at least 20 characters.");
      if (keywords.length === 0) e.push("AI needs at least one keyword.");
      if (!ai.tone) e.push("AI: choose a tone.");
      if (!ai.language.trim()) e.push("AI: enter a language.");
      if (!ai.style) e.push("AI: choose a script style.");
      if (!/^\d+$/.test(ai.min) || !/^\d+$/.test(ai.max) || Number(ai.min) < 10 || Number(ai.max) < Number(ai.min)) e.push("AI: set word limits (min 10, max at least min).");
    }
    setErrors(e);
    if (e.length || reward === null || timer === "invalid") return;
    setBusy(true);
    try {
      await onPublish({
        title: f.title.trim(), description: f.instructions.trim(), siteUrl: f.siteUrl.trim(), reward, slotsTotal: f.slots ? Number(f.slots) : null, timerMinutes: timer,
        activeUntil: f.till ? new Date(f.till).toISOString() : null, textMode: mode, keywords: mode === "none" || mode === "manual_pool" ? [] : keywords, scripts: mode === "manual_pool" ? scripts : [],
        ...(mode === "ai_generated" ? { aiConfig: { tone: ai.tone as "friendly", language: ai.language.trim(), minWords: Number(ai.min), maxWords: Number(ai.max), style: ai.style as "email" } } : {}),
        maxClaimsPerAccount: null
      });
    } catch (err) { setErrors([messageOf(err)]); setBusy(false); }
  }
  const slotsNum = /^\d+$/.test(f.slots) ? Number(f.slots) : null;

  return (
    <div className="screen"><TopBar title="New task template" onBack={onBack} /><div className="scrollarea"><div className="content narrow">
      <h3 className="section-title" style={{ marginTop: 0 }}>Task details</h3>
      <Field label="Title"><Input value={f.title} onChange={set("title")} placeholder="e.g. Introduce our CRM to a local clinic" /></Field>
      <Field label="Instructions"><Textarea rows={3} value={f.instructions} onChange={set("instructions")} placeholder="What exactly should the user do" /></Field>
      <Field label="Site link (where the work is done)"><Input value={f.siteUrl} onChange={set("siteUrl")} placeholder="https://" inputMode="url" /></Field>

      <hr className="divider" />
      <h3 className="section-title" style={{ marginTop: 0 }}>Reward and limits</h3>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}><Field label="Reward (₹)"><Input value={f.reward} onChange={set("reward")} placeholder="40" inputMode="decimal" /></Field></div>
        <div style={{ flex: 1, minWidth: 0 }}><Field label="Total slots" hint="Blank = unlimited"><Input value={f.slots} onChange={set("slots")} placeholder="100" inputMode="numeric" /></Field></div>
      </div>
      <Field label="Time limit (hours)" hint="Leave blank for unlimited time. Decimals allowed, e.g. 1.5."><Input value={f.timer} onChange={set("timer")} placeholder="e.g. 2" inputMode="decimal" /></Field>
      <Field label="Active till (optional)" hint="Date and time the task stops accepting claims. Blank = no end date."><Input type="datetime-local" value={f.till} onChange={set("till")} /></Field>

      <hr className="divider" />
      <h3 className="section-title" style={{ marginTop: 0 }}>Task script</h3>
      <div className="field" style={{ marginBottom: 12 }}>
        <span id="task-script-label" className="sr-only">Task script</span>
        <Segmented<TextMode> label="Task script" value={mode} onChange={setMode} options={TEXT_MODE_ORDER.map((m) => ({ id: m, label: TEXT_MODE_LABEL[m] }))} />
        <div className="hint">{TEXT_MODE_HELP[mode]}</div>
      </div>
      {mode === "ai_generated" || mode === "keywords" ? (
      <Field label="Keywords / features to highlight" hint={mode === "ai_generated" ? "Required. The AI uses these to write each script." : "Required. Shown to workers. The reviewer sees which ones appear in their note."}>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKw(); } }} placeholder="Type and press Add" />
          <Button style={{ marginTop: 6 }} onClick={addKw}>Add</Button>
        </div>
        <Chips items={keywords} onRemove={(k) => setKeywords(keywords.filter((x) => x !== k))} />
      </Field>
      ) : null}

      {mode === "manual_pool" ? (
        <div className="field">
          <span>Scripts (one block per script)</span>
          <ScriptBlocks blocks={pool} onChange={setPool} />
          <div className="hint">{scripts.length} script{scripts.length === 1 ? "" : "s"}{slotsNum && scripts.length ? ` · with ${slotsNum} workers, each script is used about ${Math.ceil(slotsNum / scripts.length)} times` : ""}</div>
        </div>
      ) : null}

      {mode === "ai_generated" ? (
        <Card>
          <h3>AI script settings</h3>
          <p className="muted" style={{ marginBottom: 10 }}>A new script is written for each worker. The AI only receives the task title, instructions, keywords and these settings. No worker details are ever sent.</p>
          <Field label="Tone (required)"><Select value={ai.tone} onChange={(e) => setAi({ ...ai, tone: e.target.value })}><option value="">Choose…</option><option>friendly</option><option>professional</option><option>persuasive</option><option>casual</option></Select></Field>
          <Field label="Script style (required)"><Select value={ai.style} onChange={(e) => setAi({ ...ai, style: e.target.value })}><option value="">Choose…</option><option value="cold_message">Cold message</option><option value="call_script">Call script</option><option value="email">Email</option></Select></Field>
          <Field label="Language (required)"><Input value={ai.language} onChange={(e) => setAi({ ...ai, language: e.target.value })} placeholder="English" /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Min words"><Input inputMode="numeric" value={ai.min} onChange={(e) => setAi({ ...ai, min: e.target.value })} placeholder="60" /></Field>
            <Field label="Max words"><Input inputMode="numeric" value={ai.max} onChange={(e) => setAi({ ...ai, max: e.target.value })} placeholder="120" /></Field>
          </div>
        </Card>
      ) : null}

      {errors.length ? <div className="card alert" role="alert">{errors.map((x) => <div key={x} className="field-error" style={{ marginTop: 0 }}>{x}</div>)}</div> : null}
      <Button variant="primary" block disabled={busy} onClick={() => { void publish(); }}>{busy ? "Publishing…" : "Publish task"}</Button>
    </div></div></div>
  );
}

function TaskDetailScreen({ taskId, canManage, canTexts, rev, onBack, notify, guard, onChanged, onGone }: {
  taskId: string; canManage: boolean; canTexts: boolean; rev: number; onBack: () => void; notify: (m: string) => void; guard: (e: unknown) => void; onChanged: () => void; onGone: () => void;
}) {
  const { api } = useServices();
  const first = useAsync(() => (taskId ? Promise.resolve(taskId) : api.admin.listTasks().then((t) => t[0]?.id ?? "")), [taskId]);
  const id = taskId || first.data || "";
  const q = useAsync<AdminTaskDetail | null>(() => (id ? api.admin.getTask(id) : Promise.resolve(null)), [id, rev], { enabled: !first.loading });
  const [confirm, setConfirm] = useState<"pause" | "remove" | null>(null);
  const [adding, setAdding] = useState(false); const [draft, setDraft] = useState<string[]>([""]);
  const task = q.data;
  const drafted = draft.map((x) => x.trim()).filter(Boolean);
  if (q.loading || first.loading) return <div className="screen"><TopBar title="Task detail" onBack={onBack} /><Loading /></div>;
  if (!task) return <div className="screen"><TopBar title="Task detail" onBack={onBack} /><div className="content"><ErrorBox message={q.error ?? "No task selected."} onRetry={q.reload} /></div></div>;
  const status = (s: "active" | "paused" | "removed", done: string) => api.admin.setTaskStatus(task.id, s).then(() => { notify(done); onChanged(); if (s === "removed") onGone(); }, guard);
  return (
    <>
    <div className="screen"><TopBar title="Task detail" onBack={onBack} /><div className="scrollarea"><div className="content narrow">
      <Card>
        <h3>{task.title}</h3><p>{task.description}</p>
        <div className="row"><StatusPill tone="teal">{formatRupees(task.reward)} reward</StatusPill><StatusPill tone="gray">{task.slotsTotal === null ? "unlimited slots" : `${task.claimed} of ${task.slotsTotal} claimed`}</StatusPill><StatusPill tone="amber">{formatLimit(task.timerMinutes)}{task.timerMinutes === null ? "" : " limit"}</StatusPill>{task.status === "paused" ? <StatusPill tone="gray">Paused</StatusPill> : null}</div>
        <div className="linkrow">Site: <a href={task.siteUrl} target="_blank" rel="noreferrer noopener">{task.siteUrl.replace("https://", "")} &#8599;</a></div>
        <Chips items={task.keywords} />
        <p className="hint" style={{ marginTop: 8 }}>Task script: {TEXT_MODE_LABEL[task.textMode]}</p>
      </Card>
      {task.textMode === "manual_pool" ? (
        <Card>
          <h3>Scripts ({task.scripts.length})</h3>
          <p className="muted">Shared evenly and randomly. With {task.scripts.length} scripts and {task.slotsTotal ?? 100} workers, each script goes to about {Math.ceil((task.slotsTotal ?? 100) / Math.max(task.scripts.length, 1))}.</p>
          {task.scripts.map((p, i) => <div key={i} className="script">{p}</div>)}
          {canTexts ? <Button block style={{ marginTop: 10 }} onClick={() => setAdding(true)}>Add scripts</Button> : null}
        </Card>
      ) : null}
      {canManage && task.status !== "removed" ? (<>
        {task.status === "paused"
          ? <Button block style={{ marginBottom: 8 }} onClick={() => { void status("active", "Task resumed"); }}>Resume task</Button>
          : <Button block style={{ marginBottom: 8 }} onClick={() => setConfirm("pause")}>Pause task</Button>}
        <Button variant="danger" block onClick={() => setConfirm("remove")}>Remove task</Button>
      </>) : null}
    </div></div></div>
    {confirm === "pause" ? (
      <ConfirmSheet title="Pause this task?" confirmLabel="Yes, pause" onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void status("paused", "Task paused"); }}>
        New claims are blocked while it is paused. Workers who already claimed it can still submit. You can resume it later.
      </ConfirmSheet>
    ) : null}
    {confirm === "remove" ? (
      <ConfirmSheet title="Remove this task?" tone="danger" confirmLabel="Yes, remove" onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void status("removed", "Task removed"); }}>
        New claims will be blocked immediately. Anyone with this task in Active (not yet submitted) will have their claim voided. Submissions already awaiting review will still be processed normally.
      </ConfirmSheet>
    ) : null}
    {adding ? (
      <Sheet title="Add scripts" onClose={() => { setAdding(false); setDraft([""]); }}>
        <ScriptBlocks blocks={draft} onChange={setDraft} />
        <div style={{ height: 12 }} />
        <p className="muted" style={{ margin: "0 0 12px" }}>{drafted.length} script{drafted.length === 1 ? "" : "s"} to add</p>
        <Button variant="primary" block disabled={!drafted.length} onClick={() => { api.admin.addScripts(task.id, drafted).then(() => { notify(`${drafted.length} script${drafted.length === 1 ? "" : "s"} added`); setDraft([""]); setAdding(false); onChanged(); }, guard); }}>Add scripts</Button>
      </Sheet>
    ) : null}
    </>
  );
}

function ReviewQueueScreen({ wide, sort, setSort, rev, onOpen }: { wide: boolean; sort: "oldest" | "newest"; setSort: (s: "oldest" | "newest") => void; rev: number; onOpen: (id: string) => void }) {
  const { api } = useServices();
  const [limit, setLimit] = useState(PAGE);
  // The server sorts and pages, so Newest really means the newest of all waiting submissions, not of the first page.
  const { data, error, loading, reload } = useAsync(() => api.admin.reviewQueue({ sort, limit }), [rev, sort, limit], { refreshMs: 30_000 });
  const queue = data ?? [];
  const sorted = queue;
  const more = queue.length >= limit;
  const count = `${queue.length}${more ? "+" : ""}`;
  return (
    <div className="screen"><TopBar title="Review queue" subtitle={`${count} submission${queue.length === 1 && !more ? "" : "s"} waiting for a decision`} /><div className="scrollarea"><div className="content">
      <div className="list-toolbar">
        <span className="list-count"><strong>{count}</strong> to review</span>
        <Tabs<"oldest" | "newest"> inline value={sort} onChange={(s) => { setLimit(PAGE); setSort(s); }} tabs={[{ id: "oldest", label: "Oldest" }, { id: "newest", label: "Newest" }]} />
      </div>
      {loading ? <Loading /> : null}
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {!loading && !error && queue.length === 0 ? <EmptyState>Queue is clear.</EmptyState> : null}
      {wide && sorted.length ? <DataTable caption="Review queue" rows={sorted} rowKey={(q) => q.id} onRowClick={(q) => onOpen(q.id)} columns={[
        { key: "worker", header: "Worker", render: (q) => q.worker },
        { key: "task", header: "Task", render: (q) => q.taskTitle },
        { key: "email", header: "Email used", render: (q) => q.identityEmail },
        { key: "reward", header: "Reward", width: "110px", render: (q) => formatRupees(q.reward) },
        { key: "wait", header: "Waiting", width: "130px", render: (q) => agoLabel(q.submittedAt) }
      ]} /> : null}
      {wide ? null : sorted.map((q) => <ListRow key={q.id} onClick={() => onOpen(q.id)} title={q.worker} right={<span className="sub">{agoLabel(q.submittedAt)}</span>} sub={`${q.taskTitle} · ${q.identityEmail}`} />)}
      {more ? <LoadMore onClick={() => setLimit(limit + PAGE)} /> : null}
    </div></div></div>
  );
}

function ReviewItemScreen({ id, rev, onBack, onDone }: { id: string; rev: number; onBack: () => void; onDone: (pct: OutcomePercent) => void }) {
  const { api } = useServices();
  const { data: item, error, loading, reload } = useAsync<ReviewQueueItem | undefined>(
    () => (id ? api.admin.reviewItem(id).catch((e: unknown) => { if (e instanceof ApiError && e.code === "not_found") return undefined; throw e; }) : api.admin.reviewQueue({ limit: 1 }).then((l) => l[0])),
    [rev, id]);
  if (loading) return <div className="screen"><TopBar title="Review submission" onBack={onBack} /><Loading /></div>;
  if (!item) return <div className="screen"><TopBar title="Review submission" onBack={onBack} /><div className="content">{error ? <ErrorBox message={error} onRetry={reload} /> : <EmptyState>Already reviewed.</EmptyState>}</div></div>;
  return <ReviewForm key={item.id} item={item} onBack={onBack} onDone={onDone} />;
}

function ReviewForm({ item, onBack, onDone }: { item: ReviewQueueItem; onBack: () => void; onDone: (pct: OutcomePercent) => void }) {
  const { api } = useServices();
  const [pct, setPct] = useState<OutcomePercent>(100); const [note, setNote] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const misses = item.keywords.filter((k) => !item.keywordsMatched.includes(k));
  async function submit() {
    if (!note.trim()) return setErr("A note is required for every outcome.");
    setBusy(true); setErr("");
    try { await api.admin.decide(item.id, pct, note.trim()); onDone(pct); } catch (e) { setErr(messageOf(e)); setBusy(false); }
  }
  return (
    <div className="screen"><TopBar title="Review submission" onBack={onBack} /><div className="scrollarea"><div className="content"><div className="split">
      {item.proofUrl ? <a href={item.proofUrl} target="_blank" rel="noreferrer noopener" className="proof-link"><img className="proof-img" src={item.proofUrl} alt="Screenshot proof from the worker" /></a> : <div className="placeholder-img">Screenshot proof placeholder</div>}
      {item.workerNote ? <Card><h3>Note from user</h3><p>{item.workerNote}</p></Card> : null}
      <Card>
        <p style={{ fontWeight: 500, margin: "0 0 2px", color: "var(--text-primary)" }}>{item.worker} <span className="muted">· {item.identityEmail}</span></p>
        <p style={{ fontSize: 12 }}>Task: {item.taskTitle}</p>
      </Card>
      <div className="card-pair">
        <div className="info-cell green"><span className="info-label">Reward</span><span className="info-value big">{formatRupees(item.reward)}</span></div>
        <div className="info-cell amber"><span className="info-label">Time taken</span><span className="info-value time">{formatLimit(item.timeTakenMinutes)}{item.timeLimitMinutes === null ? " (no limit)" : ` of ${formatLimit(item.timeLimitMinutes)}`}</span></div>
      </div>
      {item.keywords.length ? (
        <Card><h3>Keyword check</h3>
          <p className="muted">{item.keywordsMatched.length} of {item.keywords.length} keywords found in the worker's note. An aid only, you decide the outcome.</p>
          <Chips items={item.keywords} hits={item.keywordsMatched} misses={misses} /></Card>
      ) : null}
      {item.assignedText ? <Card><h3>Script given to this worker</h3><div className="script">{item.assignedText}</div></Card> : null}
      <p className="muted" style={{ marginBottom: 4 }}>Outcome</p>
      <div className="outcomes" role="radiogroup" aria-label="Outcome">
        {OUTCOME_PERCENTS.map((p) => <button key={p} role="radio" aria-checked={pct === p} className={`outcomebtn${pct === p ? " picked" : ""}`} onClick={() => setPct(p)}>{p}%</button>)}
      </div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>Worker will be credited {formatRupees(outcomeAmount(item.reward, pct))} of {formatRupees(item.reward)}.</p>
      <Field label="Note to user (required)" error={err}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain the outcome, even when approving in full" /></Field>
      <Button variant="primary" block disabled={busy} onClick={() => { void submit(); }}>{busy ? "Saving…" : "Submit review"}</Button>
    </div></div></div></div>
  );
}

function PayoutsScreen({ wide, rev, onOpen }: { wide: boolean; rev: number; onOpen: (id: string) => void }) {
  const { api } = useServices();
  const [limit, setLimit] = useState(PAGE);
  const { data, error, loading, reload } = useAsync(() => api.admin.listPayouts(limit), [rev, limit], { refreshMs: 30_000 });
  const payouts = data ?? [];
  const action = payouts.filter((p) => p.status === "pending");
  const history = payouts.filter((p) => p.status !== "pending");
  const moreHistory = history.length >= limit;
  const pill = (p: PayoutRequest) => <StatusPill tone={p.status === "paid" ? "green" : p.status === "rejected" ? "coral" : "amber"}>{p.status === "paid" ? "Paid" : p.status === "rejected" ? "Rejected" : "Pending"}</StatusPill>;
  const row = (p: PayoutRequest) => (
    <ListRow key={p.id} onClick={() => onOpen(p.id)} title={`${p.who} · ${formatRupees(p.amount)}`}
      right={pill(p)}
      sub={`${p.upiMasked} · ${agoLabel(p.at)}${p.paidBy ? ` · paid by ${p.paidBy}` : ""}${p.rejectReason ? ` · ${p.rejectReason}` : ""}`} />
  );
  const cols: Column<PayoutRequest>[] = [
    { key: "who", header: "Worker", render: (p) => p.who },
    { key: "amount", header: "Amount", width: "120px", render: (p) => formatRupees(p.amount) },
    { key: "upi", header: "UPI ID", render: (p) => <span className="mono">{p.upiMasked}</span> },
    { key: "when", header: "Requested", width: "140px", render: (p) => agoLabel(p.at) },
    { key: "by", header: "Paid by / reason", width: "190px", render: (p) => p.paidBy ?? p.rejectReason ?? "" },
    { key: "status", header: "Status", width: "120px", render: pill }
  ];
  return (
    <div className="screen"><TopBar title="Payouts" subtitle={`${action.length} to pay · ${history.length} done`} /><div className="scrollarea"><div className="content">
      {loading ? <Loading /> : null}
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {!loading && !error ? (wide ? (<>
        <section className="table-section"><h2>Needs action ({action.length})</h2>
          {action.length ? <DataTable caption="Payouts needing action" columns={cols} rows={action} rowKey={(p) => p.id} onRowClick={(p) => onOpen(p.id)} /> : <EmptyState>Nothing to pay right now.</EmptyState>}
        </section>
        <section className="table-section"><h2>History ({history.length}{moreHistory ? "+" : ""})</h2>
          {history.length ? <DataTable caption="Payout history" columns={cols} rows={history} rowKey={(p) => p.id} onRowClick={(p) => onOpen(p.id)} /> : <EmptyState>No payments yet.</EmptyState>}
          {moreHistory ? <LoadMore onClick={() => setLimit(limit + PAGE)} /> : null}
        </section>
      </>) : (<>
        <p className="section-label" style={{ marginTop: 0 }}>Needs action ({action.length})</p>
        {action.length ? action.map(row) : <EmptyState>Nothing to pay right now.</EmptyState>}
        <p className="section-label">History ({history.length}{moreHistory ? "+" : ""})</p>
        {history.map(row)}
        {moreHistory ? <LoadMore onClick={() => setLimit(limit + PAGE)} /> : null}
      </>)) : null}
    </div></div></div>
  );
}

function PayoutItemScreen({ id, adminName, rev, onBack, onPaid }: { id: string; adminName: string; rev: number; onBack: () => void; onPaid: () => void }) {
  const { api } = useServices();
  const first = useAsync(() => (id ? Promise.resolve(id) : api.admin.listPayouts().then((l) => (l.find((p) => p.status === "pending") ?? l[0])?.id ?? "")), [id]);
  const pid = id || first.data || "";
  const q = useAsync(() => (pid ? api.admin.getPayout(pid) : Promise.resolve(null)), [pid, rev], { enabled: !first.loading });
  const [proof, setProof] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [rejecting, setRejecting] = useState(false); const [reason, setReason] = useState("");
  const payout = q.data;
  if (q.loading || first.loading) return <div className="screen"><TopBar title="Payout request" onBack={onBack} /><Loading /></div>;
  if (!payout) return <div className="screen"><TopBar title="Payout request" onBack={onBack} /><div className="content"><ErrorBox message={q.error ?? "Nothing to pay."} onRetry={q.reload} /></div></div>;
  const paid = payout.status === "paid";
  const rejected = payout.status === "rejected";
  async function reject() {
    setBusy(true); setErr("");
    try { await api.admin.rejectPayout((payout as PayoutRequest).id, reason); onPaid(); } catch (e) { setErr(messageOf(e)); setBusy(false); }
  }
  async function pay() {
    if (!proof) return;
    setBusy(true); setErr("");
    try { await api.admin.markPaid((payout as PayoutRequest).id, proof); onPaid(); } catch (e) { setErr(messageOf(e)); setBusy(false); }
  }
  return (
    <div className="screen"><TopBar title="Payout request" onBack={onBack} /><div className="scrollarea"><div className="content narrow">
      <Card>
        <p style={{ fontSize: 13, margin: "0 0 6px", color: "var(--text-primary)" }}>{payout.who} &middot; {formatRupees(payout.amount)}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="mono">{payout.upiFull}</span><CopyButton text={payout.upiFull ?? ""} /></div>
        <p className="muted" style={{ marginTop: 8 }}>Requested {whenLabel(payout.at)}</p>
        <p className="hint">The full UPI ID is shown on this screen only, and each view is logged.</p>
      </Card>
      {paid ? (<>
        <p className="muted">Paid by {payout.paidBy}{payout.paidAt ? ` on ${whenLabel(payout.paidAt)}` : ""}. The payment proof is stored with this record.</p>
        {payout.proofUrl ? <a href={payout.proofUrl} target="_blank" rel="noreferrer noopener" className="proof-link"><img className="proof-img" src={payout.proofUrl} alt="Payment screenshot" /></a> : null}
      </>) : rejected ? (
        <p className="muted">Rejected{payout.rejectedAt ? ` on ${whenLabel(payout.rejectedAt)}` : ""}: {payout.rejectReason}. Nothing was paid, and the amount is back in the worker's balance.</p>
      ) : rejecting ? (<>
        <Field label="Why is it rejected? (the worker sees this)" error={err}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: UPI ID is invalid. Check it and try again." /></Field>
        <Button block variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => { void reject(); }}>{busy ? "Saving…" : "Reject request"}</Button>
        <Button block style={{ marginTop: 8 }} onClick={() => { setRejecting(false); setErr(""); }}>Go back</Button>
      </>) : (<>
        <p className="muted">After you transfer the money, attach the payment screenshot. It is required and is saved with your name.</p>
        <FileUpload label="Tap to upload payment screenshot" onFile={setProof} />
        {err ? <div className="field-error" role="alert">{err}</div> : null}
        <p className="hint">Can't pay it (wrong UPI ID, the bank refuses)? <button className="expander" style={{ padding: 0, minHeight: 0 }} onClick={() => { setRejecting(true); setErr(""); }}>Reject the request</button> and tell the worker why.</p>
      </>)}
    </div></div>
    {paid || rejected || rejecting ? null : <div className="screen-footer"><Button variant="primary" block disabled={!proof || busy} onClick={() => { void pay(); }}>{busy ? "Saving…" : `Mark as paid by ${adminName}`}</Button></div>}
    </div>
  );
}

const statusTone = (s: string) => (s === "active" ? "teal" : s === "suspended" ? "amber" : s === "deleted" ? "gray" : "coral");

function AccessScreen({ me, wide, perms, tab: want, setTab, rev, notify, guard, onChanged, onBack, onLogout, onOpenUser }: {
  me: { name: string; roleIds: string[] }; wide: boolean; perms: Set<PermissionKey>; tab: AccessTab; setTab: (t: AccessTab) => void; rev: number;
  notify: (m: string) => void; guard: (e: unknown) => void; onChanged: () => void; onBack: () => void; onLogout: () => void; onOpenUser: (id: string) => void;
}) {
  const { api } = useServices();
  const roles = useAsync(() => api.admin.listRoles(), [rev]);
  const myRoles = (roles.data ?? []).filter((r) => me.roleIds.includes(r.id));
  const myPerms = PERMISSIONS.filter((p) => perms.has(p.key));
  const tabs: { id: AccessTab; label: string }[] = [
    ...(perms.has("user.manage") ? [{ id: "users" as const, label: "Users" }] : []),
    ...(perms.has("role.manage") ? [{ id: "team" as const, label: "Team" }, { id: "roles" as const, label: "Roles" }] : [])
  ];
  const tab = tabs.some((t) => t.id === want) ? want : tabs[0]?.id;
  return (
    <div className="screen"><TopBar title={wide ? "Users and roles" : "Roles and permissions"} subtitle="People who use the app, your team and what each role can do" {...(wide ? {} : { onBack })} />
      <div className="scrollarea"><div className="content">
        <Card hero>
          <div className="card-split">
            <div className="card-split-main"><h3>{me.name}</h3></div>
            <div className="chips role-tags">{myRoles.map((r) => <StatusPill key={r.id} tone="teal">{r.name}</StatusPill>)}</div>
          </div>
          <p className="section-label" style={{ margin: "14px 0 0" }}>Permissions</p>
          <div className="chips perm-chips">{myPerms.map((p) => <span key={p.key} className="chip">{p.label}</span>)}</div>
        </Card>
        <div style={{ marginBottom: 8 }}><ChangePassword /></div>
        {wide ? null : <Button block style={{ marginBottom: 8 }} onClick={onLogout}>Log out</Button>}
        {tabs.length ? <div className="tabs-bleed" style={{ marginBottom: 0 }}><Tabs<AccessTab> value={tab as AccessTab} onChange={setTab} tabs={tabs} /></div> : <p className="hint">Your roles do not include managing users or roles.</p>}
        <div style={{ paddingTop: 12 }}>
          {tab === "users" ? <UsersPanel wide={wide} rev={rev} onOpen={onOpenUser} /> : null}
          {tab === "team" ? <TeamPanel rev={rev} roles={roles.data ?? []} notify={notify} guard={guard} onChanged={onChanged} /> : null}
          {tab === "roles" ? <RolesPanel rev={rev} roles={roles.data ?? []} notify={notify} guard={guard} onChanged={onChanged} /> : null}
        </div>
      </div></div>
    </div>
  );
}

function UsersPanel({ wide, rev, onOpen }: { wide: boolean; rev: number; onOpen: (id: string) => void }) {
  const { api } = useServices();
  const [limit, setLimit] = useState(PAGE);
  const { data, error, loading, reload } = useAsync(() => api.admin.listUsers(limit), [rev, limit]);
  const users = data ?? [];
  const more = users.length >= limit;
  return (<>
    <p className="note-text" style={{ marginBottom: 10 }}>People who use the app, newest first. Showing {users.length}{more ? "" : " (all)"}.</p>
    {loading ? <Loading /> : null}
    {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    {wide && users.length ? <DataTable caption="Users" rows={users} rowKey={(u) => u.id} onRowClick={(u) => onOpen(u.id)} columns={[
      { key: "name", header: "Name", render: (u) => u.name },
      { key: "email", header: "Email", render: (u) => u.emailMasked },
      { key: "emails", header: "Emails", width: "90px", render: (u) => u.identityCount },
      { key: "life", header: "Lifetime earned", width: "150px", render: (u) => formatRupees(u.lifetime) },
      { key: "status", header: "Status", width: "130px", render: (u) => <StatusPill tone={statusTone(u.status)}>{u.status[0]!.toUpperCase() + u.status.slice(1)}</StatusPill> }
    ]} /> : null}
    {wide ? null : users.map((u) => (
      <ListRow key={u.id} onClick={() => onOpen(u.id)} title={u.name} right={<StatusPill tone={statusTone(u.status)}>{u.status[0]!.toUpperCase() + u.status.slice(1)}</StatusPill>}
        sub={`${u.emailMasked} · ${formatRupees(u.lifetime)} lifetime · ${u.identityCount} email${u.identityCount > 1 ? "s" : ""}`} />
    ))}
    {more ? <LoadMore onClick={() => setLimit(limit + PAGE)} /> : null}
  </>);
}

function UserDetailScreen({ userId, rev, onBack, setPending, notify, guard, onChanged }: {
  userId: string; rev: number; onBack: () => void; notify: (m: string) => void; guard: (e: unknown) => void; onChanged: () => void;
  setPending: (p: { title: string; text: string; label: string; tone: "primary" | "danger"; run: () => void } | null) => void;
}) {
  const { api } = useServices();
  const { data: u, error, loading, reload } = useAsync<AdminUserRow | undefined>(
    () => (userId ? api.admin.getUser(userId) : api.admin.listUsers(1).then((l) => l[0])), [rev, userId]);
  if (loading) return <div className="screen"><TopBar title="User" onBack={onBack} /><Loading /></div>;
  if (!u) return <div className="screen"><TopBar title="User" onBack={onBack} /><div className="content"><ErrorBox message={error ?? "User not found."} onRetry={reload} /></div></div>;
  const set = (status: "active" | "suspended" | "deleted", m: string) => api.admin.setUserStatus(u.id, status).then(() => { notify(m); onChanged(); }, guard);
  return (
    <div className="screen"><TopBar title={u.name} onBack={onBack} /><div className="scrollarea"><div className="content narrow">
      <Card><h3>{u.name}</h3><p>{u.emailMasked} &middot; {u.identityCount} email{u.identityCount > 1 ? "s" : ""} &middot; {formatRupees(u.lifetime)} lifetime</p>
        <div className="row"><StatusPill tone={statusTone(u.status)}>{u.status}</StatusPill></div></Card>
      <p className="hint" style={{ marginBottom: 12 }}>Suspending or deleting never removes records. Claims, ledger, payouts and payment proofs are kept for audit.</p>
      {u.status === "active" ? <Button block style={{ marginBottom: 8 }} onClick={() => setPending({ title: `Suspend ${u.name}?`, text: "They cannot log in, claim or request payouts. Every record is kept. You can reinstate them later.", label: "Yes, suspend", tone: "danger", run: () => { void set("suspended", "User suspended"); } })}>Suspend user</Button> : null}
      {u.status === "suspended" ? <Button block style={{ marginBottom: 8 }} onClick={() => { void set("active", "User reinstated"); }}>Reinstate user</Button> : null}
      {u.status !== "deleted" ? <Button variant="danger" block onClick={() => setPending({ title: `Delete ${u.name}?`, text: "The account is closed and can never log in again. Claims, ledger, payouts and payment proofs are kept for audit. This cannot be undone.", label: "Yes, delete", tone: "danger", run: () => { void set("deleted", "User deleted (records kept)"); } })}>Delete user (soft)</Button> : <p className="muted">Deleted. Financial records are retained.</p>}
    </div></div></div>
  );
}

function TeamPanel({ rev, roles, notify, guard, onChanged }: { rev: number; roles: Role[]; notify: (m: string) => void; guard: (e: unknown) => void; onChanged: () => void }) {
  const { api } = useServices();
  const { data, error, loading, reload } = useAsync(() => api.admin.listMembers(), [rev]);
  const members: AdminMember[] = data ?? [];
  const [editing, setEditing] = useState<string | null>(null); const [email, setEmail] = useState(""); const [err, setErr] = useState("");
  async function add() {
    setErr("");
    try { await api.admin.addMember(email); setEmail(""); notify("Team member added. Give them a role."); onChanged(); reload(); } catch (e) { setErr(messageOf(e)); }
  }
  return (<>
    <p className="note-text" style={{ marginBottom: 10 }}>Members can hold several roles. Owner has everything.</p>
    {loading ? <Loading /> : null}
    {error ? <ErrorBox message={error} onRetry={reload} /> : null}
    <div className="card-grid">{members.map((m) => (
      <Card key={m.id}>
        <div className="card-split">
          <div className="card-split-main">
            <h3>{m.name}</h3>
            <div className="chips">{m.roleIds.length === 0 ? <StatusPill tone="gray">No role yet</StatusPill> : m.roleIds.map((id) => <StatusPill key={id} tone={roles.find((r) => r.id === id)?.name === "Owner" ? "teal" : "gray"}>{roles.find((r) => r.id === id)?.name ?? "Role"}</StatusPill>)}</div>
          </div>
          {!m.isOwner ? <Button compact onClick={() => setEditing(editing === m.id ? null : m.id)}>{editing === m.id ? "Done" : "Edit roles"}</Button> : null}
        </div>
        {editing === m.id ? roles.filter((r) => r.name !== "Owner").map((r) => (
          <label key={r.id} className="check">
            <input type="checkbox" checked={m.roleIds.includes(r.id)}
              onChange={(e) => { api.admin.setMemberRoles(m.id, e.target.checked ? [...m.roleIds, r.id] : m.roleIds.filter((id) => id !== r.id)).then(() => { notify("Roles updated"); reload(); onChanged(); }, guard); }} />
            {r.name}
          </label>
        )) : null}
      </Card>
    ))}</div>
    <Field label="Add a team member" error={err} hint="Their main login email. They need to sign up first."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
    <Button block onClick={() => { void add(); }}>Add to team</Button>
  </>);
}

function RolesPanel({ rev, roles, notify, guard, onChanged }: { rev: number; roles: Role[]; notify: (m: string) => void; guard: (e: unknown) => void; onChanged: () => void }) {
  const { api } = useServices();
  const members = useAsync(() => api.admin.listMembers(), [rev]);
  const [editing, setEditing] = useState<string | null>(null); const [name, setName] = useState(""); const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  async function create() {
    setErr("");
    try { await api.admin.createRole(name); setName(""); notify("Role created. Open Edit to choose its permissions."); onChanged(); } catch (e) { setErr(messageOf(e)); }
  }
  const holders = (id: string) => (members.data ?? []).filter((m) => m.roleIds.includes(id)).length;
  return (<>
    <p className="note-text" style={{ marginBottom: 10 }}>A role is a bundle of permissions. Add or remove roles, and tick the permissions each role gets. Owner can't be edited or deleted.</p>
    <div className="card-grid">{roles.map((r) => (
      <Card key={r.id}>
        <div className="card-split">
          <div className="card-split-main">
            <h3>{r.name}</h3>
            <p>{r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"} &middot; {holders(r.id)} member{holders(r.id) === 1 ? "" : "s"}</p>
          </div>
          {r.name !== "Owner" ? <Button compact onClick={() => { setEditing(editing === r.id ? null : r.id); setConfirmDelete(null); }}>{editing === r.id ? "Done" : "Edit"}</Button> : null}
        </div>
        {editing === r.id ? (<>
          {PERMISSIONS.map((p) => (
            <label key={p.key} className="check">
              <input type="checkbox" checked={r.permissions.includes(p.key)}
                onChange={(e) => { api.admin.setRolePermissions(r.id, e.target.checked ? [...r.permissions, p.key] : r.permissions.filter((k) => k !== p.key)).then(() => { notify("Role updated"); onChanged(); }, guard); }} />
              {p.label}
            </label>
          ))}
          <Button variant="danger" block style={{ marginTop: 10 }} onClick={() => setConfirmDelete(r.id)}>Delete role</Button>
        </>) : null}
      </Card>
    ))}</div>
    {confirmDelete ? (() => {
      const r = roles.find((x) => x.id === confirmDelete); if (!r) return null;
      const n = holders(r.id);
      return (
        <ConfirmSheet title={`Delete role "${r.name}"?`} tone="danger" confirmLabel="Yes, delete" onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { setConfirmDelete(null); setEditing(null); api.admin.deleteRole(r.id).then(() => { notify("Role deleted"); onChanged(); }, guard); }}>
          {n ? `${n} member${n === 1 ? "" : "s"} hold${n === 1 ? "s" : ""} this role and will lose it.` : "No member holds this role."}
        </ConfirmSheet>
      );
    })() : null}
    <Field label="New role name" error={err}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support lead" /></Field>
    <Button block onClick={() => { void create(); }}>Create role</Button>
  </>);
}

