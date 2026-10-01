import { useState } from "react";
import { UserApp, type MyTab, type UserScreen } from "@rr/ui";
import type { PayoutScenario } from "@rr/core";
import { Gallery, GalleryItem, HubPage, JumpPanel, PhoneFrame, type JumpGroup } from "@rr/ui/hub";

interface Jump { screen: UserScreen; tab?: MyTab; scenario?: PayoutScenario; ticketId?: string; helpTab?: "open" | "closed" }
const JUMPS: Record<string, Jump & { label: string }> = {
  login: { screen: "login", label: "Log in" },
  register: { screen: "register", label: "Create account" },
  verifyEmail: { screen: "verifyEmail", label: "Verify email (one-time code)" },
  board: { screen: "board", label: "Task board" },
  detail: { screen: "detail", label: "Task detail (overlay)" },
  claimed: { screen: "claimed", label: "Task accepted" },
  active: { screen: "mytasks", tab: "active", label: "My tasks: Active" },
  review: { screen: "mytasks", tab: "review", label: "My tasks: Under review" },
  completed: { screen: "mytasks", tab: "completed", label: "My tasks: Completed" },
  rejected: { screen: "mytasks", tab: "rejected", label: "My tasks: Rejected" },
  submit: { screen: "submit", label: "Submit proof" },
  submitted: { screen: "submitted", label: "Submitted" },
  wallet: { screen: "wallet", label: "Wallet + transactions" },
  payout: { screen: "payout", label: "Payout (amount + UPI)" },
  payoutSent: { screen: "payoutSent", scenario: "inProcess", label: "Payout requested" },
  payoutFlagged: { screen: "payoutFlagged", label: "Payout: UPI flagged" },
  identities: { screen: "identities", label: "My emails" },
  help: { screen: "help", label: "Help: tickets (open)" },
  helpClosed: { screen: "help", helpTab: "closed", label: "Help: closed tickets" },
  createTicket: { screen: "createTicket", label: "Help: create ticket (overlay)" },
  ticketOpen: { screen: "ticket", ticketId: "tk1042", label: "Ticket: chat (open)" },
  ticketNew: { screen: "ticket", ticketId: "tk1038", label: "Ticket: waiting for support" },
  ticketClosed: { screen: "ticket", ticketId: "tk1029", helpTab: "closed", label: "Ticket: resolved (read-only)" },
  walletNone: { screen: "wallet", scenario: "none", label: "Wallet: never withdrawn" },
  walletProcess: { screen: "wallet", scenario: "inProcess", label: "Wallet: payout in process" },
  walletPaid: { screen: "wallet", scenario: "paid", label: "Wallet: payout paid" },
  payoutNone: { screen: "payout", scenario: "none", label: "Payout: no requests yet" },
  payoutProcess: { screen: "payout", scenario: "inProcess", label: "Payout: request in process" },
  payoutPaid: { screen: "payout", scenario: "paid", label: "Payout: request paid" }
};
const GROUPS: JumpGroup<string>[] = [
  { label: "Account", items: ["login", "register", "verifyEmail", "identities"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "Tasks", items: ["board", "detail", "claimed", "active", "review", "completed", "rejected", "submit", "submitted"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "Money", items: ["wallet", "payout", "payoutSent", "payoutFlagged"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "Help and support", items: ["help", "helpClosed", "createTicket", "ticketOpen", "ticketNew", "ticketClosed"].map((id) => ({ id, label: JUMPS[id]!.label })) },
  { label: "Payout scenarios", items: ["walletNone", "walletProcess", "walletPaid", "payoutNone", "payoutProcess", "payoutPaid"].map((id) => ({ id, label: JUMPS[id]!.label })) }
];

export function UserHub() {
  const [jump, setJump] = useState("board");
  const [all, setAll] = useState(false);
  const [rev, setRev] = useState(0);
  const j = JUMPS[jump]!;
  return (
    <HubPage>
      <JumpPanel title="User side" hint="Jump to any screen, or tap through the phone like a real user." groups={GROUPS} active={jump} onPick={(id) => { setJump(id); setRev(rev + 1); setAll(false); }}>
        <button className={`jumpbtn${all ? " on" : ""}`} onClick={() => setAll(!all)} style={{ marginBottom: 14 }}>{all ? "Back to interactive" : "Show all screens at once"}</button>
      </JumpPanel>
      {all ? (
        <Gallery>
          {Object.entries(JUMPS).map(([id, s]) => (
            <GalleryItem key={id} caption={s.label}>
              <PhoneFrame><UserApp initialScreen={s.screen} {...(s.tab ? { initialTab: s.tab } : {})} {...(s.scenario ? { payoutScenario: s.scenario } : {})} {...(s.ticketId ? { initialTicketId: s.ticketId } : {})} {...(s.helpTab ? { initialHelpTab: s.helpTab } : {})} loggedIn={id !== "login" && id !== "register" && id !== "verifyEmail"} /></PhoneFrame>
            </GalleryItem>
          ))}
        </Gallery>
      ) : (
        <PhoneFrame><UserApp key={`${jump}-${rev}`} initialScreen={j.screen} {...(j.tab ? { initialTab: j.tab } : {})} {...(j.scenario ? { payoutScenario: j.scenario } : {})} {...(j.ticketId ? { initialTicketId: j.ticketId } : {})} {...(j.helpTab ? { initialHelpTab: j.helpTab } : {})} loggedIn={jump !== "login" && jump !== "register" && jump !== "verifyEmail"} /></PhoneFrame>
      )}
    </HubPage>
  );
}
