import { useState } from "react";
import { AdminApp, type AdminScreen } from "@rr/ui";
import { fixtures } from "@rr/core";
import { Gallery, GalleryItem, HubPage, JumpPanel, PhoneFrame, type JumpGroup } from "@rr/ui/hub";

const JUMPS: Record<string, { screen: AdminScreen; tab?: "users" | "team" | "roles"; label: string }> = {
  dashboard: { screen: "dashboard", label: "Dashboard" },
  tasks: { screen: "tasks", label: "Task list" },
  newtask: { screen: "newtask", label: "New task (text modes, AI fields)" },
  taskdetail: { screen: "taskdetail", label: "Task detail (pitch pool)" },
  removeconfirm: { screen: "removeconfirm", label: "Remove task confirm" },
  reviewqueue: { screen: "reviewqueue", label: "Review queue" },
  reviewitem: { screen: "reviewitem", label: "Review submission" },
  payouts: { screen: "payouts", label: "Payouts" },
  payoutitem: { screen: "payoutitem", label: "Payout: mark paid + proof" },
  payoutflagged: { screen: "payoutflagged", label: "Payout: flagged" },
  access: { screen: "access", label: "Roles and permissions: Users tab" },
  accessTeam: { screen: "access", tab: "team", label: "Roles and permissions: Team tab" },
  accessRoles: { screen: "access", tab: "roles", label: "Roles and permissions: Roles tab" },
  userdetail: { screen: "userdetail", label: "User detail" },
  tickets: { screen: "tickets", label: "Support: tickets" },
  ticket: { screen: "ticket", label: "Support: ticket chat" }
};
const GROUPS: JumpGroup<string>[] = [
  { label: "Overview", items: ["dashboard", "access", "accessTeam", "accessRoles"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "Tasks", items: ["tasks", "newtask", "taskdetail", "removeconfirm"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "Review", items: ["reviewqueue", "reviewitem"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "Payments", items: ["payouts", "payoutitem", "payoutflagged"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "Support", items: ["tickets", "ticket"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "User detail", items: ["userdetail"].map((id) => ({ id, label: JUMPS[id]!.label })) }
];

export function AdminHub() {
  const [jump, setJump] = useState("dashboard");
  const [all, setAll] = useState(false);
  const [rev, setRev] = useState(0);
  const [viewer, setViewer] = useState("role-owner");
  return (
    <HubPage>
      <JumpPanel title="Admin side" hint="Switch the viewing role to see permission-gated navigation and 403 screens." groups={GROUPS} active={jump} onPick={(id) => { setJump(id); setRev(rev + 1); setAll(false); }}>
        <label className="field" style={{ marginBottom: 10 }}>View as
          <select value={viewer} onChange={(e) => { setViewer(e.target.value); setRev(rev + 1); }}>
            {fixtures.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button className={`jumpbtn${all ? " on" : ""}`} onClick={() => setAll(!all)} style={{ marginBottom: 14 }}>{all ? "Back to interactive" : "Show all screens at once"}</button>
      </JumpPanel>
      {all ? (
        <Gallery>
          {Object.entries(JUMPS).map(([id, s]) => (
            <GalleryItem key={id} caption={s.label}><PhoneFrame><AdminApp initialScreen={s.screen} {...(s.tab ? { initialAccessTab: s.tab } : {})} viewerRoleIds={[viewer]} /></PhoneFrame></GalleryItem>
          ))}
        </Gallery>
      ) : (
        <PhoneFrame><AdminApp key={`${jump}-${rev}-${viewer}`} initialScreen={JUMPS[jump]!.screen} {...(JUMPS[jump]!.tab ? { initialAccessTab: JUMPS[jump]!.tab } : {})} viewerRoleIds={[viewer]} /></PhoneFrame>
      )}
    </HubPage>
  );
}
