import { useState } from "react";
import {
  activeTill, fixtures, PERMISSIONS, TEXT_MODE_LABEL, type AdminMember, type PermissionKey, type Role, type Task, type TextMode
} from "@rr/core";
import { OUTCOME_PERCENTS, formatRupees, outcomeAmount, rupees, type OutcomePercent, type Paise } from "@rr/money";
import {
  BottomNav, Icon, type IconName, Button, Card, Chips, CopyButton, EmptyState, Field, FileUpload, Input, ListRow, Select,
  StatusPill, Tabs, Textarea, Toast, TopBar
} from "../../primitives";
import { AdminTicketChat, AdminTicketList, type SupportTab } from "./SupportScreens";
import { needsReply, useTickets } from "../../demo/ticketStore";
import { markPaid, usePayouts } from "../../demo/payoutStore";

export type AdminScreen =
  | "dashboard" | "tasks" | "newtask" | "taskdetail" | "removeconfirm"
  | "reviewqueue" | "reviewitem" | "payouts" | "payoutitem" | "payoutflagged"
  | "userdetail" | "tickets" | "ticket" | "access";
type AccessTab = "users" | "team" | "roles";

/** Screen -> permission needed. Mirrors the server, which checks the database on every request. */
const NEEDS: Partial<Record<AdminScreen, PermissionKey[]>> = {
  tasks: ["task.manage", "task.assign"], newtask: ["task.manage"], taskdetail: ["task.manage", "task.assign"], removeconfirm: ["task.manage"],
  reviewqueue: ["review.decide"], reviewitem: ["review.decide"],
  payouts: ["payout.mark_paid"], payoutitem: ["payout.mark_paid"], payoutflagged: ["payout.mark_paid"],
  userdetail: ["user.manage"],
  tickets: ["ticket.manage"], ticket: ["ticket.manage"]
};
const NAV_DEF: { id: AdminScreen; tab: string; label: string; icon: IconName }[] = [
  { id: "dashboard", tab: "dashboard", label: "Home", icon: "home" },
  { id: "tasks", tab: "tasks", label: "Tasks", icon: "tasks" },
  { id: "reviewqueue", tab: "review", label: "Review", icon: "review" },
  { id: "payouts", tab: "payouts", label: "Payouts", icon: "payout" },
  { id: "tickets", tab: "support", label: "Support", icon: "support" }
];
const TAB_OF: Partial<Record<AdminScreen, string>> = {
  dashboard: "dashboard", tasks: "tasks", newtask: "tasks", taskdetail: "tasks", removeconfirm: "tasks",
  reviewqueue: "review", reviewitem: "review", payouts: "payouts", payoutitem: "payouts", payoutflagged: "payouts",
  userdetail: "dashboard", tickets: "support", ticket: "support", access: "dashboard"
};

const extraTasks: { id: string; title: string; status: "closed" | "removed"; reward: Paise; claimed: string; timer: number; mode: string }[] = [
  { id: "x1", title: "Rate us on the App Store", status: "closed", reward: rupees(25), claimed: "100 of 100 claimed", timer: 20, mode: TEXT_MODE_LABEL.none },
  { id: "x2", title: "Follow our Instagram", status: "removed", reward: rupees(20), claimed: "unlimited slots", timer: 10, mode: TEXT_MODE_LABEL.none }
];

/** Same card idea as the user board: title, reward line, then a compact row with the status pill and the action button. */
function AdminTaskCard({ title, reward, claimed, timer, mode, pill, onOpen }: {
  title: string; reward: Paise; claimed: string; timer: number; mode: string; pill: React.ReactNode; onOpen?: () => void;
}) {
  return (
    <Card {...(onOpen ? { onClick: onOpen } : {})}>
      <h3>{title}</h3>
      <p>{formatRupees(reward)} reward &middot; {claimed} &middot; {timer} min limit</p>
      <div className="card-split" style={{ marginTop: "var(--space-3)" }}>
        <div className="card-split-main"><div className="chips" style={{ margin: 0 }}>{pill}<StatusPill tone="gray">{mode}</StatusPill></div></div>
        {onOpen ? <Button compact>Manage</Button> : null}
      </div>
    </Card>
  );
}

export interface AdminAppProps {
  initialScreen?: AdminScreen;
  /** Roles held by the viewing admin. Drives which nav items and screens are allowed. */
  viewerRoleIds?: string[];
  adminName?: string;
  initialTicketId?: string;
  initialAccessTab?: "users" | "team" | "roles";
}

export function AdminApp({ initialScreen = "dashboard", viewerRoleIds = ["role-owner"], adminName = "Hrishabh", initialTicketId = "tk1042", initialAccessTab = "users" }: AdminAppProps) {
  const [screen, setScreen] = useState<AdminScreen>(initialScreen);
  const [roles, setRoles] = useState<Role[]>(fixtures.roles);
  const [members, setMembers] = useState<AdminMember[]>(fixtures.members);
  const [accessTab, setAccessTab] = useState<AccessTab>(initialAccessTab);
  const [toast, setToast] = useState<string | null>(null);
  const [queue, setQueue] = useState(fixtures.reviewQueue);
  const [reviewId, setReviewId] = useState("r1");
  // Priya's requests come from the same store as the user app: paying one here updates her wallet there.
  const stored = usePayouts();
  const [others, setOthers] = useState(fixtures.adminPayouts);
  const rank = { pending: 0, flagged: 1, paid: 2 } as const;
  const payouts = [...stored.map((p) => ({ ...p, who: "Priya S." })), ...others].sort((a, b) => rank[a.status] - rank[b.status]);
  const [payoutId, setPayoutId] = useState("a1");
  const [userId, setUserId] = useState("u1");
  const [userStatus, setUserStatus] = useState<Record<string, string>>({});
  const [ticketId, setTicketId] = useState(initialTicketId);
  const [adminTaskId, setAdminTaskId] = useState("t1");
  const [supportTab, setSupportTab] = useState<SupportTab>("open");
  const allTickets = useTickets();

  const perms = new Set(roles.filter((r) => viewerRoleIds.includes(r.id)).flatMap((r) => r.permissions));
  const can = (s: AdminScreen) => { const n = NEEDS[s]; return !n || n.some((p) => perms.has(p)); };
  const navItems = NAV_DEF.filter((n) => can(n.id)).map((n) => ({
    id: n.tab, label: n.label, icon: n.icon, ...(n.id === "reviewqueue" && queue.length ? { badge: queue.length } : {}),
    ...(n.id === "tickets" && allTickets.some(needsReply) ? { badge: allTickets.filter(needsReply).length } : {})
  }));
  const show = (s: AdminScreen) => setScreen(s);
  const notify = (m: string) => setToast(m);

  let body: JSX.Element;
  if (!can(screen)) {
    body = (
      <div className="screen"><TopBar title="No access" /><div className="scrollarea"><div className="content">
        <Card alert><p style={{ color: "var(--coral)" }}>403. Your roles don't include permission for this screen.</p></Card>
        <Button block onClick={() => show("dashboard")}>Back to home</Button>
      </div></div></div>
    );
  } else switch (screen) {
    case "dashboard": {
      const payoutsDue = payouts.filter((p) => p.status !== "paid").length;
      const openTickets = allTickets.filter((t) => t.status === "open");
      const waiting = openTickets.filter(needsReply).length;
      const activeTasks = fixtures.tasks.filter((t) => t.status === "active" || t.status === "closing_soon").length;
      const cards: { go: AdminScreen; label: string; value: number; sub?: string }[] = [
        { go: "reviewqueue", label: "Pending review", value: queue.length },
        { go: "tasks", label: "Active tasks", value: activeTasks },
        { go: "payouts", label: "Payouts due", value: payoutsDue },
        { go: "tickets", label: "Open tickets", value: openTickets.length, ...(waiting ? { sub: `${waiting} need a reply` } : {}) }
      ];
      body = (
        <div className="screen">
          <div className="topbar">
            <span className="grow">Admin panel</span>
            <button className="profile-btn" aria-label="Roles and permissions" onClick={() => show("access")}>
              <Icon name="user" /><span>{adminName}</span><span className="chev" aria-hidden="true">&#9656;</span>
            </button>
          </div>
          <div className="scrollarea"><div className="content">
            <div className="metric-grid">
              {cards.filter((c) => can(c.go)).map((c) => (
                <button key={c.go} className="metric" onClick={() => show(c.go)}>
                  <div className="num">{c.value}</div><div className="lbl">{c.label}</div>{c.sub ? <div className="sub">{c.sub}</div> : null}
                </button>
              ))}
            </div>
            <p className="section-label">Recent activity</p>
            <Card><p>Priya S. submitted proof for "Pitch our CRM to a local clinic" &middot; 12 min ago</p></Card>
            <Card><p>Priya S. opened a ticket: "Screenshot upload fails on my phone" &middot; yesterday</p></Card>
            <Card><p>Rahul K. requested a payout of {formatRupees(17000n)} &middot; 1 hour ago</p></Card>
            <Card><p>"Rate us on the App Store" reached its slot limit &middot; 3 hours ago</p></Card>
          </div></div>
        </div>
      );
      break;
    }
    case "tasks": body = (
      <div className="screen"><TopBar title="Tasks" /><div className="scrollarea"><div className="content">
        {fixtures.tasks.map((t) => {
          const till = activeTill(t.activeUntil);
          const closed = t.status === "closed" || t.status === "removed" || till.kind === "closed";
          const tone = closed ? "coral" : till.kind === "left" ? "amber" : "teal";
          const pill = <StatusPill tone={tone}>{closed ? "Closed" : till.kind === "none" ? "Active · no end date" : `Active till: ${till.label}`}</StatusPill>;
          return <AdminTaskCard key={t.id} title={t.title} reward={t.reward} timer={t.timerMinutes} mode={TEXT_MODE_LABEL[t.textMode]} pill={pill}
            claimed={t.slotsTotal === null ? "unlimited slots" : `${t.slotsTotal - (t.slotsRemaining ?? 0)} of ${t.slotsTotal} claimed`}
            onOpen={() => { setAdminTaskId(t.id); show("taskdetail"); }} />;
        })}
        {extraTasks.map((t) => (
          <AdminTaskCard key={t.id} title={t.title} reward={t.reward} timer={t.timer} mode={t.mode} claimed={t.claimed}
            pill={<StatusPill tone={t.status === "removed" ? "coral" : "gray"}>{t.status === "removed" ? "Removed" : "Closed"}</StatusPill>} />
        ))}
      </div></div>
      {perms.has("task.manage") ? <div className="screen-footer"><Button variant="primary" block onClick={() => show("newtask")}>New task</Button></div> : null}
      </div>
    ); break;
    case "newtask": body = <NewTaskScreen onBack={() => show("tasks")} onPublish={() => { notify("Task published"); show("tasks"); }} />; break;
    case "taskdetail": body = <TaskDetailScreen task={fixtures.tasks.find((t) => t.id === adminTaskId) ?? fixtures.tasks[0]!} canManage={perms.has("task.manage")} canTexts={perms.has("task_text.manage")} onBack={() => show("tasks")} onRemove={() => show("removeconfirm")} notify={notify} />; break;
    case "removeconfirm": body = (
      <div className="screen"><TopBar title="Remove this task?" onBack={() => show("taskdetail")} /><div className="scrollarea"><div className="content">
        <p className="note-text">New claims will be blocked immediately. Anyone with this task in Active (not yet submitted) will have their claim voided. Submissions already awaiting review will still be processed normally.</p>
        <Button variant="danger" block style={{ margin: "14px 0 8px" }} onClick={() => { notify("Task removed"); show("tasks"); }}>Confirm remove</Button>
        <Button block onClick={() => show("taskdetail")}>Cancel</Button>
      </div></div></div>
    ); break;
    case "reviewqueue": body = (
      <div className="screen"><TopBar title="Review queue" /><div className="scrollarea"><div className="content">
        <p className="note-text" style={{ marginBottom: 10 }}>{queue.length} waiting, oldest first.</p>
        {queue.length === 0 ? <EmptyState>Queue is clear.</EmptyState> : null}
        {queue.map((q) => <ListRow key={q.id} onClick={() => { setReviewId(q.id); show("reviewitem"); }} title={q.worker} right={<span className="sub">{q.waitingLabel}</span>} sub={`${q.taskTitle} · ${q.identityEmail}`} />)}
      </div></div></div>
    ); break;
    case "reviewitem": {
      const item = queue.find((q) => q.id === reviewId);
      body = item ? <ReviewItemScreen key={item.id} item={item} onBack={() => show("reviewqueue")}
        onDone={(pct) => { setQueue(queue.filter((q) => q.id !== item.id)); notify(`Reviewed: ${pct}% credited`); show("reviewqueue"); }} />
        : <EmptyState>Already reviewed.</EmptyState>;
      break;
    }
    case "payouts": body = (
      <div className="screen"><TopBar title="Payouts" /><div className="scrollarea"><div className="content">
        <p className="note-text" style={{ marginBottom: 10 }}>{payouts.filter((p) => p.status === "pending").length} pending, {payouts.filter((p) => p.status === "flagged").length} flagged.</p>
        {payouts.map((p) => (
          <ListRow key={p.id} onClick={() => { setPayoutId(p.id); show(p.status === "flagged" ? "payoutflagged" : "payoutitem"); }} title={p.who}
            right={<StatusPill tone={p.status === "paid" ? "green" : p.status === "flagged" ? "coral" : "amber"}>{p.status === "paid" ? "Paid" : p.status === "flagged" ? "Flagged" : "Pending"}</StatusPill>}
            sub={`${formatRupees(p.amount)} · ${p.upiMasked} · ${p.whenLabel}${p.paidBy ? ` · paid by ${p.paidBy}` : ""}`} />
        ))}
      </div></div></div>
    ); break;
    case "payoutitem": {
      const p = payouts.find((x) => x.id === payoutId) ?? payouts.find((x) => x.status === "pending") ?? payouts[0]!;
      body = <PayoutItemScreen key={p.id} payout={p} adminName={adminName} onBack={() => show("payouts")}
        onPaid={() => { if (stored.some((x) => x.id === p.id)) markPaid(p.id, adminName); else setOthers(others.map((x) => (x.id === p.id ? { ...x, status: "paid", paidBy: adminName } : x))); notify(`Recorded: paid by ${adminName}`); show("payouts"); }} />;
      break;
    }
    case "payoutflagged": {
      const p = payouts.find((x) => x.id === payoutId) ?? payouts.find((x) => x.status === "flagged") ?? payouts[0]!;
      body = (
        <div className="screen"><TopBar title="Flagged payout" onBack={() => show("payouts")} /><div className="scrollarea"><div className="content">
          <Card alert><p style={{ color: "var(--coral)", margin: "0 0 8px" }}>{p.flagReason}</p><p className="muted">{p.who} &middot; {formatRupees(p.amount)} &middot; requested {p.whenLabel}</p></Card>
          <Button variant="danger" block style={{ marginBottom: 8 }} onClick={() => { notify("Both accounts suspended (records kept)"); show("payouts"); }}>Ban both accounts</Button>
          <Button block style={{ marginBottom: 8 }} onClick={() => { notify("Frozen for investigation"); show("payouts"); }}>Freeze and investigate</Button>
          <Button block onClick={() => { setOthers(others.map((x) => (x.id === p.id ? { ...x, status: "pending" } : x))); notify("Allowed once"); show("payouts"); }}>Ignore &middot; allow this once</Button>
          <p className="hint" style={{ marginTop: 12 }}>Every choice is written to the audit log with your name.</p>
        </div></div></div>
      );
      break;
    }
    case "tickets": body = <AdminTicketList tab={supportTab} setTab={setSupportTab} onOpen={(id) => { setTicketId(id); show("ticket"); }} />; break;
    case "ticket": body = (
      <AdminTicketChat ticketId={ticketId} adminName={adminName} canAssign={perms.has("ticket.manage")} onBack={() => show("tickets")}
        agents={members.filter((m) => roles.some((r) => m.roleIds.includes(r.id) && r.permissions.includes("ticket.manage"))).map((m) => m.name.replace(" (owner)", ""))} />
    ); break;
    case "access": {
      const mine = roles.filter((r) => viewerRoleIds.includes(r.id));
      const myPerms = PERMISSIONS.filter((p) => perms.has(p.key));
      const tabs: { id: AccessTab; label: string }[] = [
        ...(perms.has("user.manage") ? [{ id: "users" as const, label: "Users" }] : []),
        ...(perms.has("role.manage") ? [{ id: "team" as const, label: "Team" }, { id: "roles" as const, label: "Roles" }] : [])
      ];
      const tab = tabs.some((t) => t.id === accessTab) ? accessTab : tabs[0]?.id;
      body = (
        <div className="screen"><TopBar title="Roles and permissions" onBack={() => show("dashboard")} />
          <div className="scrollarea"><div className="content">
            <Card hero>
              <div className="card-split">
                <div className="card-split-main"><h3>{adminName}</h3></div>
                <div className="chips role-tags">{mine.map((r) => <StatusPill key={r.id} tone="teal">{r.name}</StatusPill>)}</div>
              </div>
              <p className="section-label" style={{ margin: "14px 0 0" }}>Permissions</p>
              <div className="chips perm-chips">{myPerms.map((p) => <span key={p.key} className="chip">{p.label}</span>)}</div>
            </Card>
            {tabs.length ? <div style={{ margin: "0 calc(var(--space-7) * -1)" }}><Tabs<AccessTab> value={tab as AccessTab} onChange={setAccessTab} tabs={tabs} /></div> : <p className="hint">Your roles do not include managing users or roles.</p>}
            <div style={{ paddingTop: 12 }}>
              {tab === "users" ? (<>
                <p className="note-text" style={{ marginBottom: 10 }}>People who use the app. 142 total.</p>
                {fixtures.adminUsers.map((u) => {
                  const st = userStatus[u.id] ?? u.status;
                  return <ListRow key={u.id} onClick={() => { setUserId(u.id); show("userdetail"); }} title={u.name}
                    right={<StatusPill tone={st === "active" ? "teal" : st === "suspended" ? "amber" : st === "deleted" ? "gray" : "coral"}>{st[0]!.toUpperCase() + st.slice(1)}</StatusPill>}
                    sub={`${u.emailMasked} · ${formatRupees(u.lifetime)} lifetime · ${u.identityCount} email${u.identityCount > 1 ? "s" : ""}`} />;
                })}
              </>) : null}
              {tab === "team" ? <TeamPanel members={members} roles={roles} setMembers={setMembers} notify={notify} /> : null}
              {tab === "roles" ? <RolesPanel roles={roles} setRoles={setRoles} members={members} setMembers={setMembers} notify={notify} /> : null}
            </div>
          </div></div>
        </div>
      );
      break;
    }
    case "userdetail": {
      const u = fixtures.adminUsers.find((x) => x.id === userId) ?? fixtures.adminUsers[0]!;
      const st = userStatus[u.id] ?? u.status;
      const set = (s: string, m: string) => { setUserStatus({ ...userStatus, [u.id]: s }); notify(m); };
      body = (
        <div className="screen"><TopBar title={u.name} onBack={() => { setAccessTab("users"); show("access"); }} /><div className="scrollarea"><div className="content">
          <Card><h3>{u.name}</h3><p>{u.emailMasked} &middot; {u.identityCount} email{u.identityCount > 1 ? "s" : ""} &middot; {formatRupees(u.lifetime)} lifetime</p>
            <div className="row"><StatusPill tone={st === "active" ? "teal" : st === "suspended" ? "amber" : st === "deleted" ? "gray" : "coral"}>{st}</StatusPill></div></Card>
          <p className="hint" style={{ marginBottom: 12 }}>Suspending or deleting never removes records. Claims, ledger, payouts and payment proofs are kept for audit.</p>
          {st === "active" || st === "flagged" ? <Button block style={{ marginBottom: 8 }} onClick={() => set("suspended", "User suspended")}>Suspend user</Button> : null}
          {st === "suspended" ? <Button block style={{ marginBottom: 8 }} onClick={() => set("active", "User reinstated")}>Reinstate user</Button> : null}
          {st !== "deleted" ? <Button variant="danger" block onClick={() => set("deleted", "User deleted (records kept)")}>Delete user (soft)</Button> : <p className="muted">Deleted. Personal details anonymised on request; financial records retained.</p>}
        </div></div></div>
      );
      break;
    }
  }

  const tab = TAB_OF[screen] ?? "dashboard";
  return (
    <>
      {body}
      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
      <BottomNav items={navItems} active={tab} onSelect={(t) => show(NAV_DEF.find((n) => n.tab === t)!.id)} />
    </>
  );
}

/* ---------- Screens ---------- */

function NewTaskScreen({ onBack, onPublish }: { onBack: () => void; onPublish: () => void }) {
  const [f, setF] = useState({ title: "", instructions: "", siteUrl: "", reward: "", slots: "", timer: "", cap: "", till: "" });
  const [mode, setMode] = useState<TextMode>("none");
  const [keywords, setKeywords] = useState<string[]>([]); const [kw, setKw] = useState("");
  const [pool, setPool] = useState("");
  const [ai, setAi] = useState({ tone: "", language: "", min: "", max: "", style: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const pitches = pool.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const addKw = () => { const v = kw.trim(); if (v && !keywords.includes(v)) setKeywords([...keywords, v]); setKw(""); };

  function publish() {
    const e: string[] = [];
    if (!f.title.trim()) e.push("Title is required.");
    if (!f.instructions.trim()) e.push("Instructions are required.");
    if (!/^https:\/\/\S+\.\S+/.test(f.siteUrl)) e.push("Site link must be a valid https URL.");
    if (!/^\d+(\.\d{1,2})?$/.test(f.reward)) e.push("Reward must be an amount in rupees.");
    if (f.slots && !/^\d+$/.test(f.slots)) e.push("Total slots must be a whole number or blank.");
    if (!/^\d+$/.test(f.timer) || Number(f.timer) < 1) e.push("Timer must be minutes, 1 or more.");
    if (f.till && Date.parse(f.till) <= Date.now()) e.push("Active till must be in the future.");
    if (mode === "keywords" && keywords.length === 0) e.push("Add at least one keyword.");
    if (mode === "manual_pool" && pitches.length === 0) e.push("Add at least one pitch.");
    if (mode === "ai_generated") {
      if (f.instructions.trim().length < 20) e.push("AI needs a task description of at least 20 characters.");
      if (keywords.length === 0) e.push("AI needs at least one keyword.");
      if (!ai.tone) e.push("AI: choose a tone.");
      if (!ai.language.trim()) e.push("AI: enter a language.");
      if (!ai.style) e.push("AI: choose a pitch style.");
      if (!/^\d+$/.test(ai.min) || !/^\d+$/.test(ai.max) || Number(ai.min) < 10 || Number(ai.max) < Number(ai.min)) e.push("AI: set word limits (min 10, max at least min).");
    }
    setErrors(e);
    if (!e.length) onPublish();
  }
  const slotsNum = /^\d+$/.test(f.slots) ? Number(f.slots) : null;

  return (
    <div className="screen"><TopBar title="New task template" onBack={onBack} /><div className="scrollarea"><div className="content">
      <Field label="Title"><Input value={f.title} onChange={set("title")} placeholder="e.g. Pitch our CRM to a local clinic" /></Field>
      <Field label="Instructions"><Textarea rows={3} value={f.instructions} onChange={set("instructions")} placeholder="What exactly should the user do" /></Field>
      <Field label="Site link (where the work is done)"><Input value={f.siteUrl} onChange={set("siteUrl")} placeholder="https://" inputMode="url" /></Field>
      <Field label="Reward amount (₹)"><Input value={f.reward} onChange={set("reward")} placeholder="40" inputMode="decimal" /></Field>
      <Field label="Total slots" hint="Leave blank for unlimited"><Input value={f.slots} onChange={set("slots")} placeholder="100" inputMode="numeric" /></Field>
      <Field label="Timer duration (minutes)"><Input value={f.timer} onChange={set("timer")} placeholder="30" inputMode="numeric" /></Field>
      <Field label="Active till (optional)" hint="Date and time the task stops accepting claims. Blank = no end date."><Input type="datetime-local" value={f.till} onChange={set("till")} /></Field>
      <Field label="Max claims per account" hint="Across all of one person's emails. Blank = unlimited."><Input value={f.cap} onChange={set("cap")} placeholder="e.g. 3" inputMode="numeric" /></Field>

      <hr className="divider" />
      <Field label="Task text for workers">
        <Select value={mode} onChange={(e) => setMode(e.target.value as TextMode)}>
          {(Object.keys(TEXT_MODE_LABEL) as TextMode[]).map((m) => <option key={m} value={m}>{TEXT_MODE_LABEL[m]}</option>)}
        </Select>
      </Field>
      <Field label="Keywords / features to highlight" hint="Shown to workers. The reviewer sees which ones appear in their note.">
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKw(); } }} placeholder="Type and press Add" />
          <Button style={{ marginTop: 6 }} onClick={addKw}>Add</Button>
        </div>
        <Chips items={keywords} onRemove={(k) => setKeywords(keywords.filter((x) => x !== k))} />
      </Field>

      {mode === "manual_pool" ? (
        <Field label="Pitch pool" hint="Separate pitches with a blank line. Each worker gets one at random, spread evenly.">
          <Textarea rows={7} value={pool} onChange={(e) => setPool(e.target.value)} placeholder={"Pitch one...\n\nPitch two...\n\nPitch three..."} />
          <div className="hint">{pitches.length} pitch{pitches.length === 1 ? "" : "es"}{slotsNum && pitches.length ? ` · with ${slotsNum} workers, each pitch is used about ${Math.ceil(slotsNum / pitches.length)} times` : ""}</div>
        </Field>
      ) : null}

      {mode === "ai_generated" ? (
        <Card>
          <h3>AI pitch settings</h3>
          <p className="muted" style={{ marginBottom: 10 }}>A new pitch is written for each worker. The AI only receives the task title, instructions, keywords and these settings. No worker details are ever sent.</p>
          <Field label="Tone (required)"><Select value={ai.tone} onChange={(e) => setAi({ ...ai, tone: e.target.value })}><option value="">Choose…</option><option>friendly</option><option>professional</option><option>persuasive</option><option>casual</option></Select></Field>
          <Field label="Pitch style (required)"><Select value={ai.style} onChange={(e) => setAi({ ...ai, style: e.target.value })}><option value="">Choose…</option><option value="cold_message">Cold message</option><option value="call_script">Call script</option><option value="email">Email</option></Select></Field>
          <Field label="Language (required)"><Input value={ai.language} onChange={(e) => setAi({ ...ai, language: e.target.value })} placeholder="English" /></Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Min words"><Input inputMode="numeric" value={ai.min} onChange={(e) => setAi({ ...ai, min: e.target.value })} placeholder="60" /></Field>
            <Field label="Max words"><Input inputMode="numeric" value={ai.max} onChange={(e) => setAi({ ...ai, max: e.target.value })} placeholder="120" /></Field>
          </div>
        </Card>
      ) : null}

      {errors.length ? <div className="card alert" role="alert">{errors.map((x) => <div key={x} className="field-error" style={{ marginTop: 0 }}>{x}</div>)}</div> : null}
      <Button variant="primary" block onClick={publish}>Publish task</Button>
    </div></div></div>
  );
}

function TaskDetailScreen({ task, canManage, canTexts, onBack, onRemove, notify }: {
  task: Task; canManage: boolean; canTexts: boolean; onBack: () => void; onRemove: () => void; notify: (m: string) => void;
}) {
  const [pool, setPool] = useState(fixtures.pitchPool); const [add, setAdd] = useState("");
  return (
    <div className="screen"><TopBar title="Task detail" onBack={onBack} /><div className="scrollarea"><div className="content">
      <Card>
        <h3>{task.title}</h3><p>{task.description}</p>
        <div className="row"><StatusPill tone="teal">{formatRupees(task.reward)} reward</StatusPill><StatusPill tone="gray">{task.slotsTotal === null ? "unlimited slots" : `${task.slotsTotal - (task.slotsRemaining ?? 0)} of ${task.slotsTotal} claimed`}</StatusPill><StatusPill tone="amber">{task.timerMinutes} min limit</StatusPill></div>
        <div className="linkrow">Site: <a href={task.siteUrl} target="_blank" rel="noreferrer noopener">{task.siteUrl.replace("https://", "")} &#8599;</a></div>
        <Chips items={task.keywords} />
        <p className="hint" style={{ marginTop: 8 }}>Task text: {TEXT_MODE_LABEL[task.textMode]}</p>
      </Card>
      {task.textMode === "manual_pool" ? (
        <Card>
          <h3>Pitch pool ({pool.length})</h3>
          <p className="muted">Shared evenly and randomly. With {pool.length} pitches and {task.slotsTotal ?? 100} workers, each pitch goes to about {Math.ceil((task.slotsTotal ?? 100) / pool.length)}.</p>
          {pool.map((p, i) => <div key={i} className="pitch">{p}</div>)}
          {canTexts ? (<>
            <Field label="Add a pitch"><Textarea rows={3} value={add} onChange={(e) => setAdd(e.target.value)} /></Field>
            <Button block onClick={() => { if (add.trim()) { setPool([...pool, add.trim()]); setAdd(""); notify("Pitch added"); } }}>Add to pool</Button>
          </>) : null}
        </Card>
      ) : null}
      {canManage ? (<>
        <Button block style={{ marginBottom: 8 }} onClick={() => notify("Task paused")}>Pause task</Button>
        <Button variant="danger" block onClick={onRemove}>Remove task</Button>
      </>) : null}
    </div></div></div>
  );
}

function ReviewItemScreen({ item, onBack, onDone }: { item: (typeof fixtures.reviewQueue)[number]; onBack: () => void; onDone: (pct: OutcomePercent) => void }) {
  const [pct, setPct] = useState<OutcomePercent>(100); const [note, setNote] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const misses = item.keywords.filter((k) => !item.keywordsMatched.includes(k));
  return (
    <div className="screen"><TopBar title="Review submission" onBack={onBack} /><div className="scrollarea"><div className="content">
      <div className="placeholder-img">Screenshot proof placeholder</div>
      {item.workerNote ? <p className="note-text" style={{ marginBottom: 12 }}>User note: "{item.workerNote}"</p> : null}
      <Card>
        <p style={{ fontWeight: 500, margin: "0 0 2px", color: "var(--text-primary)" }}>{item.worker} <span className="muted">· {item.identityEmail}</span></p>
        <p style={{ fontSize: 12 }}>Task: {item.taskTitle} &middot; Reward {formatRupees(item.reward)}</p>
      </Card>
      {item.keywords.length ? (
        <Card><h3>Keyword check</h3>
          <p className="muted">{item.keywordsMatched.length} of {item.keywords.length} keywords found in the worker's note. An aid only, you decide the outcome.</p>
          <Chips items={item.keywords} hits={item.keywordsMatched} misses={misses} /></Card>
      ) : null}
      {item.assignedText ? <Card><h3>Pitch given to this worker</h3><div className="pitch">{item.assignedText}</div></Card> : null}
      <p className="muted" style={{ marginBottom: 4 }}>Outcome</p>
      <div className="outcomes" role="radiogroup" aria-label="Outcome">
        {OUTCOME_PERCENTS.map((p) => <button key={p} role="radio" aria-checked={pct === p} className={`outcomebtn${pct === p ? " picked" : ""}`} onClick={() => setPct(p)}>{p}%</button>)}
      </div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>Worker will be credited {formatRupees(outcomeAmount(item.reward, pct))} of {formatRupees(item.reward)}.</p>
      <Field label="Note to user (required)" error={err}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain the outcome, even when approving in full" /></Field>
      <Button variant="primary" block disabled={busy} onClick={() => { if (!note.trim()) return setErr("A note is required for every outcome."); setBusy(true); onDone(pct); }}>Submit review</Button>
    </div></div></div>
  );
}

function PayoutItemScreen({ payout, adminName, onBack, onPaid }: { payout: (typeof fixtures.adminPayouts)[number]; adminName: string; onBack: () => void; onPaid: () => void }) {
  const [proof, setProof] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const paid = payout.status === "paid";
  return (
    <div className="screen"><TopBar title="Payout request" onBack={onBack} /><div className="scrollarea"><div className="content">
      <Card>
        <p style={{ fontSize: 13, margin: "0 0 6px", color: "var(--text-primary)" }}>{payout.who} &middot; {formatRupees(payout.amount)}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="mono">{payout.upiFull}</span><CopyButton text={payout.upiFull} /></div>
        <p className="muted" style={{ marginTop: 8 }}>Requested {payout.whenLabel}</p>
        <p className="hint">The full UPI ID is shown on this screen only.</p>
      </Card>
      {paid ? <p className="muted">Paid by {payout.paidBy}. The payment proof is stored with this record.</p> : (<>
        <p className="muted">After you transfer the money, attach the payment screenshot. It is required and is saved with your name.</p>
        <FileUpload label="Tap to upload payment screenshot" onFile={setProof} />
        <Button variant="primary" block disabled={!proof || busy} onClick={() => { setBusy(true); onPaid(); }}>Mark as paid by {adminName}</Button>
      </>)}
    </div></div></div>
  );
}

function TeamPanel({ members, roles, setMembers, notify }: { members: AdminMember[]; roles: Role[]; setMembers: (m: AdminMember[]) => void; notify: (m: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (<>
    <p className="note-text" style={{ marginBottom: 10 }}>Members can hold several roles. Owner has everything.</p>
    {members.map((m) => (
      <Card key={m.id}>
        <div className="card-split">
          <div className="card-split-main">
            <h3>{m.name}</h3>
            <div className="chips">{m.roleIds.map((id) => <StatusPill key={id} tone={id === "role-owner" ? "teal" : "gray"}>{roles.find((r) => r.id === id)?.name}</StatusPill>)}</div>
          </div>
          {!m.isOwner ? <Button compact onClick={() => setEditing(editing === m.id ? null : m.id)}>{editing === m.id ? "Done" : "Edit roles"}</Button> : null}
        </div>
        {editing === m.id ? roles.filter((r) => r.id !== "role-owner").map((r) => (
          <label key={r.id} className="check">
            <input type="checkbox" checked={m.roleIds.includes(r.id)}
              onChange={(e) => { setMembers(members.map((x) => x.id === m.id ? { ...x, roleIds: e.target.checked ? [...x.roleIds, r.id] : x.roleIds.filter((id) => id !== r.id) } : x)); notify("Roles updated"); }} />
            {r.name}
          </label>
        )) : null}
      </Card>
    ))}
  </>);
}

let nextRoleId = 100;

function RolesPanel({ roles, setRoles, members, setMembers, notify }: {
  roles: Role[]; setRoles: (r: Role[]) => void; members: AdminMember[]; setMembers: (m: AdminMember[]) => void; notify: (m: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null); const [name, setName] = useState(""); const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  function create() {
    const n = name.trim();
    if (!n) return setErr("Give the role a name.");
    if (roles.some((r) => r.name.toLowerCase() === n.toLowerCase())) return setErr("A role with that name already exists.");
    setErr(""); setRoles([...roles, { id: `role-${nextRoleId++}`, name: n, permissions: [] }]); setName(""); notify("Role created. Open Edit to choose its permissions.");
  }
  function remove(id: string) {
    setRoles(roles.filter((r) => r.id !== id));
    setMembers(members.map((m) => ({ ...m, roleIds: m.roleIds.filter((x) => x !== id) })));
    setConfirmDelete(null); setEditing(null); notify("Role deleted");
  }
  return (<>
    <p className="note-text" style={{ marginBottom: 10 }}>A role is a bundle of permissions. Add or remove roles, and tick the permissions each role gets. Owner can't be edited or deleted.</p>
    {roles.map((r) => {
      const holders = members.filter((m) => m.roleIds.includes(r.id)).length;
      return (
        <Card key={r.id}>
          <div className="card-split">
            <div className="card-split-main">
              <h3>{r.name}</h3>
              <p>{r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"} &middot; {holders} member{holders === 1 ? "" : "s"}</p>
            </div>
            {r.id !== "role-owner" ? <Button compact onClick={() => { setEditing(editing === r.id ? null : r.id); setConfirmDelete(null); }}>{editing === r.id ? "Done" : "Edit"}</Button> : null}
          </div>
          {editing === r.id ? (<>
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="check">
                <input type="checkbox" checked={r.permissions.includes(p.key)}
                  onChange={(e) => { setRoles(roles.map((x) => x.id === r.id ? { ...x, permissions: e.target.checked ? [...x.permissions, p.key] : x.permissions.filter((k) => k !== p.key) } : x)); notify("Role updated"); }} />
                {p.label}
              </label>
            ))}
            {confirmDelete === r.id ? (
              <div style={{ marginTop: 10 }}>
                <p className="field-error" style={{ marginTop: 0 }}>{holders ? `${holders} member${holders === 1 ? "" : "s"} hold${holders === 1 ? "s" : ""} this role and will lose it.` : "No member holds this role."} Delete it?</p>
                <div className="confirm-pair"><Button variant="danger" onClick={() => remove(r.id)}>Yes, delete</Button><Button onClick={() => setConfirmDelete(null)}>Cancel</Button></div>
              </div>
            ) : <Button variant="danger" block style={{ marginTop: 10 }} onClick={() => setConfirmDelete(r.id)}>Delete role</Button>}
          </>) : null}
        </Card>
      );
    })}
    <Field label="New role name" error={err}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support lead" /></Field>
    <Button block onClick={create}>Create role</Button>
  </>);
}
