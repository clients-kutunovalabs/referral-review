import { useState } from "react";
import {
  fixtures, PERMISSIONS, TEXT_MODE_LABEL, type AdminMember, type PermissionKey, type Role, type Task, type TextMode
} from "@rr/core";
import { OUTCOME_PERCENTS, formatRupees, outcomeAmount, type OutcomePercent } from "@rr/money";
import {
  BottomNav, Button, Card, Chips, CopyButton, EmptyState, Field, FileUpload, Input, ListRow, Select,
  StatusPill, Tabs, Textarea, Toast, TopBar
} from "../../primitives";

export type AdminScreen =
  | "dashboard" | "tasks" | "newtask" | "taskdetail" | "removeconfirm"
  | "reviewqueue" | "reviewitem" | "payouts" | "payoutitem" | "payoutflagged"
  | "users" | "userdetail";
type PeopleTab = "users" | "team" | "roles";

/** Screen -> permission needed. Mirrors the server, which checks the database on every request. */
const NEEDS: Partial<Record<AdminScreen, PermissionKey[]>> = {
  tasks: ["task.manage", "task.assign"], newtask: ["task.manage"], taskdetail: ["task.manage", "task.assign"], removeconfirm: ["task.manage"],
  reviewqueue: ["review.decide"], reviewitem: ["review.decide"],
  payouts: ["payout.mark_paid"], payoutitem: ["payout.mark_paid"], payoutflagged: ["payout.mark_paid"],
  users: ["user.manage", "role.manage"], userdetail: ["user.manage"]
};
const NAV_DEF: { id: AdminScreen; tab: string; label: string }[] = [
  { id: "dashboard", tab: "dashboard", label: "Home" },
  { id: "tasks", tab: "tasks", label: "Tasks" },
  { id: "reviewqueue", tab: "review", label: "Review" },
  { id: "payouts", tab: "payouts", label: "Payouts" },
  { id: "users", tab: "users", label: "People" }
];
const TAB_OF: Partial<Record<AdminScreen, string>> = {
  dashboard: "dashboard", tasks: "tasks", newtask: "tasks", taskdetail: "tasks", removeconfirm: "tasks",
  reviewqueue: "review", reviewitem: "review", payouts: "payouts", payoutitem: "payouts", payoutflagged: "payouts",
  users: "users", userdetail: "users"
};

const extraTasks: { title: string; status: "closed" | "removed"; meta: string }[] = [
  { title: "Rate us on the App Store", status: "closed", meta: "₹25 · 100/100 slots · 20 min timer" },
  { title: "Follow our Instagram", status: "removed", meta: "₹20 · unlimited · 10 min timer" }
];

export interface AdminAppProps {
  initialScreen?: AdminScreen;
  /** Roles held by the viewing admin. Drives which nav items and screens are allowed. */
  viewerRoleIds?: string[];
  adminName?: string;
}

export function AdminApp({ initialScreen = "dashboard", viewerRoleIds = ["role-owner"], adminName = "Hrishabh" }: AdminAppProps) {
  const [screen, setScreen] = useState<AdminScreen>(initialScreen);
  const [roles, setRoles] = useState<Role[]>(fixtures.roles);
  const [members, setMembers] = useState<AdminMember[]>(fixtures.members);
  const [peopleTab, setPeopleTab] = useState<PeopleTab>("users");
  const [toast, setToast] = useState<string | null>(null);
  const [queue, setQueue] = useState(fixtures.reviewQueue);
  const [reviewId, setReviewId] = useState("r1");
  const [payouts, setPayouts] = useState(fixtures.adminPayouts);
  const [payoutId, setPayoutId] = useState("a1");
  const [userId, setUserId] = useState("u1");
  const [userStatus, setUserStatus] = useState<Record<string, string>>({});

  const perms = new Set(roles.filter((r) => viewerRoleIds.includes(r.id)).flatMap((r) => r.permissions));
  const can = (s: AdminScreen) => { const n = NEEDS[s]; return !n || n.some((p) => perms.has(p)); };
  const navItems = NAV_DEF.filter((n) => can(n.id)).map((n) => ({
    id: n.tab, label: n.label, ...(n.id === "reviewqueue" && queue.length ? { badge: queue.length } : {})
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
    case "dashboard": body = (
      <div className="screen"><TopBar title="Admin panel" right={<span className="muted">{adminName}</span>} /><div className="scrollarea"><div className="content">
        <div className="metricrow">
          <div className="metric"><div className="num">{queue.length}</div><div className="lbl">Pending review</div></div>
          <div className="metric"><div className="num">12</div><div className="lbl">Active tasks</div></div>
          <div className="metric"><div className="num">{payouts.filter((p) => p.status !== "paid").length}</div><div className="lbl">Payouts due</div></div>
        </div>
        <p className="section-label">Recent activity</p>
        <Card><p>Priya S. submitted proof for "Pitch our CRM to a local clinic" &middot; 12 min ago</p></Card>
        <Card><p>Rahul K. requested a payout of {formatRupees(17000n)} &middot; 1 hour ago</p></Card>
        <Card><p>"Rate us on the App Store" reached its slot limit &middot; 3 hours ago</p></Card>
      </div></div></div>
    ); break;
    case "tasks": body = (
      <div className="screen"><TopBar title="Tasks" /><div className="scrollarea"><div className="content">
        {perms.has("task.manage") ? <Button variant="primary" block style={{ marginBottom: 14 }} onClick={() => show("newtask")}>New task</Button> : null}
        {fixtures.tasks.map((t) => (
          <ListRow key={t.id} onClick={() => show("taskdetail")} title={t.title}
            right={<StatusPill tone={t.status === "closing_soon" ? "amber" : "teal"}>{t.status === "closing_soon" ? "Closing soon" : "Active"}</StatusPill>}
            sub={`${formatRupees(t.reward)} · ${t.slotsTotal === null ? "unlimited" : `${t.slotsTotal - (t.slotsRemaining ?? 0)}/${t.slotsTotal} slots`} · ${t.timerMinutes} min timer · ${TEXT_MODE_LABEL[t.textMode]}`} />
        ))}
        {extraTasks.map((t) => (
          <ListRow key={t.title} title={t.title} right={<StatusPill tone={t.status === "removed" ? "coral" : "gray"}>{t.status === "removed" ? "Removed" : "Closed"}</StatusPill>} sub={t.meta} />
        ))}
      </div></div></div>
    ); break;
    case "newtask": body = <NewTaskScreen onBack={() => show("tasks")} onPublish={() => { notify("Task published"); show("tasks"); }} />; break;
    case "taskdetail": body = <TaskDetailScreen task={fixtures.tasks[0]!} canManage={perms.has("task.manage")} canTexts={perms.has("task_text.manage")} onBack={() => show("tasks")} onRemove={() => show("removeconfirm")} notify={notify} />; break;
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
      const p = payouts.find((x) => x.id === payoutId) ?? payouts[0]!;
      body = <PayoutItemScreen key={p.id} payout={p} adminName={adminName} onBack={() => show("payouts")}
        onPaid={() => { setPayouts(payouts.map((x) => (x.id === p.id ? { ...x, status: "paid", paidBy: adminName } : x))); notify(`Recorded: paid by ${adminName}`); show("payouts"); }} />;
      break;
    }
    case "payoutflagged": {
      const p = payouts.find((x) => x.id === payoutId) ?? payouts[2]!;
      body = (
        <div className="screen"><TopBar title="Flagged payout" onBack={() => show("payouts")} /><div className="scrollarea"><div className="content">
          <Card alert><p style={{ color: "var(--coral)", margin: "0 0 8px" }}>{p.flagReason}</p><p className="muted">{p.who} &middot; {formatRupees(p.amount)} &middot; requested {p.whenLabel}</p></Card>
          <Button variant="danger" block style={{ marginBottom: 8 }} onClick={() => { notify("Both accounts suspended (records kept)"); show("payouts"); }}>Ban both accounts</Button>
          <Button block style={{ marginBottom: 8 }} onClick={() => { notify("Frozen for investigation"); show("payouts"); }}>Freeze and investigate</Button>
          <Button block onClick={() => { setPayouts(payouts.map((x) => (x.id === p.id ? { ...x, status: "pending" } : x))); notify("Allowed once"); show("payouts"); }}>Ignore &middot; allow this once</Button>
          <p className="hint" style={{ marginTop: 12 }}>Every choice is written to the audit log with your name.</p>
        </div></div></div>
      );
      break;
    }
    case "users": body = (
      <div className="screen"><TopBar title="People" />
        <Tabs<PeopleTab> value={peopleTab} onChange={setPeopleTab} tabs={[
          ...(perms.has("user.manage") ? [{ id: "users" as const, label: "Users" }] : []),
          ...(perms.has("role.manage") ? [{ id: "team" as const, label: "Team" }, { id: "roles" as const, label: "Roles" }] : [])]} />
        <div className="scrollarea"><div className="content">
          {peopleTab === "users" && perms.has("user.manage") ? (<>
            <p className="note-text" style={{ marginBottom: 10 }}>142 total.</p>
            {fixtures.adminUsers.map((u) => {
              const st = userStatus[u.id] ?? u.status;
              return <ListRow key={u.id} onClick={() => { setUserId(u.id); show("userdetail"); }} title={u.name}
                right={<StatusPill tone={st === "active" ? "teal" : st === "suspended" ? "amber" : st === "deleted" ? "gray" : "coral"}>{st[0]!.toUpperCase() + st.slice(1)}</StatusPill>}
                sub={`${u.emailMasked} · ${formatRupees(u.lifetime)} lifetime · ${u.identityCount} email${u.identityCount > 1 ? "s" : ""}`} />;
            })}
          </>) : null}
          {peopleTab === "team" && perms.has("role.manage") ? <TeamPanel members={members} roles={roles} setMembers={setMembers} notify={notify} /> : null}
          {peopleTab === "roles" && perms.has("role.manage") ? <RolesPanel roles={roles} setRoles={setRoles} notify={notify} /> : null}
        </div></div>
      </div>
    ); break;
    case "userdetail": {
      const u = fixtures.adminUsers.find((x) => x.id === userId) ?? fixtures.adminUsers[0]!;
      const st = userStatus[u.id] ?? u.status;
      const set = (s: string, m: string) => { setUserStatus({ ...userStatus, [u.id]: s }); notify(m); };
      body = (
        <div className="screen"><TopBar title={u.name} onBack={() => show("users")} /><div className="scrollarea"><div className="content">
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
  const [f, setF] = useState({ title: "", instructions: "", siteUrl: "", proof: "screenshot", reward: "", slots: "", timer: "", cap: "" });
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
      <Field label="Proof type"><Select value={f.proof} onChange={set("proof")}><option value="screenshot">Screenshot only</option><option value="screenshot_link">Screenshot + link</option><option value="screenshot_note">Screenshot + text note</option></Select></Field>
      <Field label="Reward amount (₹)"><Input value={f.reward} onChange={set("reward")} placeholder="40" inputMode="decimal" /></Field>
      <Field label="Total slots" hint="Leave blank for unlimited"><Input value={f.slots} onChange={set("slots")} placeholder="100" inputMode="numeric" /></Field>
      <Field label="Timer duration (minutes)"><Input value={f.timer} onChange={set("timer")} placeholder="30" inputMode="numeric" /></Field>
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
        <div className="row"><StatusPill tone="teal">{formatRupees(task.reward)} reward</StatusPill><StatusPill tone="gray">68/100 slots</StatusPill><StatusPill tone="amber">{task.timerMinutes} min timer</StatusPill></div>
        <div className="linkrow">Site: <a href={task.siteUrl} target="_blank" rel="noreferrer noopener">{task.siteUrl.replace("https://", "")} &#8599;</a></div>
        <Chips items={task.keywords} />
        <p className="hint" style={{ marginTop: 8 }}>Task text: {TEXT_MODE_LABEL[task.textMode]}</p>
      </Card>
      {task.textMode === "manual_pool" ? (
        <Card>
          <h3>Pitch pool ({pool.length})</h3>
          <p className="muted">Shared evenly and randomly. With {pool.length} pitches and 100 workers, each pitch goes to about {Math.ceil(100 / pool.length)}.</p>
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
  const [proof, setProof] = useState(false); const [busy, setBusy] = useState(false);
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
        <FileUpload label="Tap to upload payment screenshot" filled={proof} onPick={() => setProof(true)} />
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
        <h3>{m.name}</h3>
        <div className="chips">{m.roleIds.map((id) => <StatusPill key={id} tone={id === "role-owner" ? "teal" : "gray"}>{roles.find((r) => r.id === id)?.name}</StatusPill>)}</div>
        {!m.isOwner ? <div className="row"><span /><Button onClick={() => setEditing(editing === m.id ? null : m.id)}>{editing === m.id ? "Done" : "Edit roles"}</Button></div> : null}
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

function RolesPanel({ roles, setRoles, notify }: { roles: Role[]; setRoles: (r: Role[]) => void; notify: (m: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null); const [name, setName] = useState("");
  return (<>
    <p className="note-text" style={{ marginBottom: 10 }}>A role is a bundle of permissions. Owner can't be edited.</p>
    {roles.map((r) => (
      <Card key={r.id}>
        <h3>{r.name}</h3>
        <p>{r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}</p>
        {r.id !== "role-owner" ? <div className="row"><span /><Button onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? "Done" : "Edit"}</Button></div> : null}
        {editing === r.id ? PERMISSIONS.map((p) => (
          <label key={p.key} className="check">
            <input type="checkbox" checked={r.permissions.includes(p.key)}
              onChange={(e) => { setRoles(roles.map((x) => x.id === r.id ? { ...x, permissions: e.target.checked ? [...x.permissions, p.key] : x.permissions.filter((k) => k !== p.key) } : x)); notify("Role updated"); }} />
            {p.label}
          </label>
        )) : null}
      </Card>
    ))}
    <Field label="New role name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support" /></Field>
    <Button block onClick={() => { if (name.trim()) { setRoles([...roles, { id: `role-${roles.length + 1}`, name: name.trim(), permissions: [] }]); setName(""); notify("Role created"); } }}>Create role</Button>
  </>);
}
