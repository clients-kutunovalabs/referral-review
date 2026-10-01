import { useState } from "react";
import { whenLabel } from "@rr/core";
import { Button, EmptyState, ListRow, Select, StatusPill, Tabs, TopBar } from "../../primitives";
import { Composer, Conversation } from "../shared/Conversation";
import { assignTicket, needsReply, resolveTicket, sendMessage, useTickets } from "../../demo/ticketStore";

export type SupportTab = "open" | "closed";

export function AdminTicketList({ tab, setTab, onOpen }: { tab: SupportTab; setTab: (t: SupportTab) => void; onOpen: (id: string) => void }) {
  const tickets = useTickets();
  const open = tickets.filter((t) => t.status === "open");
  const closed = tickets.filter((t) => t.status === "closed");
  const list = tab === "open" ? open : closed;
  return (
    <div className="screen"><TopBar title="Support" />
      <Tabs<SupportTab> value={tab} onChange={setTab} tabs={[{ id: "open", label: `Open (${open.length})` }, { id: "closed", label: `Closed (${closed.length})` }]} />
      <div className="scrollarea"><div className="content">
        {list.length === 0 ? <EmptyState>{tab === "open" ? "No open tickets." : "No closed tickets yet."}</EmptyState> : null}
        {list.map((t) => (
          <ListRow key={t.id} onClick={() => onOpen(t.id)} title={<strong style={{ fontWeight: 500 }}>{t.title}</strong>}
            right={tab === "open" && needsReply(t) ? <StatusPill tone="coral">Needs reply</StatusPill> : <span className="sub">#{t.number}</span>}
            sub={`${t.customerName} · ${t.assignee ? `Assigned to ${t.assignee}` : "Unassigned"} · ${t.status === "closed" ? `Resolved ${whenLabel(t.resolvedAt ?? t.updatedAt)}` : `Updated ${whenLabel(t.updatedAt)}`}`} />
        ))}
      </div></div>
    </div>
  );
}

export function AdminTicketChat({ ticketId, adminName, agents, canAssign = true, onBack }: { ticketId: string; adminName: string; agents: string[]; canAssign?: boolean; onBack: () => void }) {
  const t = useTickets().find((x) => x.id === ticketId);
  const [confirm, setConfirm] = useState(false);
  if (!t) return <div className="screen"><TopBar title="Ticket" onBack={onBack} /><EmptyState>Ticket not found.</EmptyState></div>;
  const closed = t.status === "closed";
  return (
    <div className="screen">
      <TopBar title={t.title} onBack={onBack} />
      <div className="ticket-admin">
        <div className="ticket-meta" style={{ border: 0, padding: 0 }}>
          <span>#{t.number}</span>
          <StatusPill tone={closed ? "gray" : "teal"}>{closed ? "Resolved" : "Open"}</StatusPill>
          <span className="muted">{t.customerName} &middot; {t.customerEmail}</span>
        </div>
        {!closed ? (
          <div className="ticket-actions">
            <label className="field" style={{ margin: 0, flex: 1 }}>Assigned to
              <Select value={t.assignee ?? ""} disabled={!canAssign} onChange={(e) => assignTicket(t.id, e.target.value || null, adminName)}>
                <option value="">Unassigned</option>
                {agents.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            </label>
            {confirm
              ? <span className="confirm-pair"><Button variant="primary" onClick={() => { resolveTicket(t.id, adminName); setConfirm(false); }}>Yes, resolve</Button><Button onClick={() => setConfirm(false)}>Cancel</Button></span>
              : <Button onClick={() => setConfirm(true)}>Mark resolved</Button>}
          </div>
        ) : <p className="muted" style={{ margin: "6px 0 0" }}>{t.assignee ? `Handled by ${t.assignee}.` : ""} The customer can no longer reply.</p>}
      </div>
      <Conversation messages={t.messages} me="admin" />
      {closed
        ? <div className="composer-closed"><p>Resolved. The conversation is read-only.</p></div>
        : <Composer placeholder="Reply to the customer" onSend={(text) => { sendMessage(t.id, "admin", `${adminName} (Support)`, text); }} />}
    </div>
  );
}
