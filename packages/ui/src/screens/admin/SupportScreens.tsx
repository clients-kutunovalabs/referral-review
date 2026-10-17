import { useState } from "react";
import { whenLabel } from "@rr/core";
import { Button, DataTable, EmptyState, ListRow, Select, StatusPill, Tabs, TopBar, useLayout } from "../../primitives";
import { ErrorBox, Loading, messageOf, needsReply, useAsync } from "../../data";
import { useServices } from "../../services";
import { Composer, Conversation } from "../shared/Conversation";

export type SupportTab = "open" | "closed";

export function AdminTicketList({ tab, setTab, onOpen, version = 0 }: { tab: SupportTab; setTab: (t: SupportTab) => void; onOpen: (id: string) => void; version?: number }) {
  const { api } = useServices();
  const { data, error, loading, reload } = useAsync(() => api.admin.listTickets(), [version], { refreshMs: 20_000 });
  const tickets = data ?? [];
  const open = tickets.filter((t) => t.status === "open");
  const closed = tickets.filter((t) => t.status === "closed");
  const list = tab === "open" ? open : closed;
  const wide = useLayout() !== "phone";
  const waiting = open.filter(needsReply).length;
  return (
    <div className="screen"><TopBar title="Support" subtitle={`${open.length} open · ${waiting} need a reply`} />
      <Tabs<SupportTab> value={tab} onChange={setTab} tabs={[{ id: "open", label: `Open (${open.length})` }, { id: "closed", label: `Closed (${closed.length})` }]} />
      <div className="scrollarea"><div className="content">
        {loading ? <Loading /> : null}
        {error ? <ErrorBox message={error} onRetry={reload} /> : null}
        {!loading && !error && list.length === 0 ? <EmptyState>{tab === "open" ? "No open tickets." : "No closed tickets yet."}</EmptyState> : null}
        {wide && list.length ? (
          <DataTable caption="Support tickets" rows={list} rowKey={(t) => t.id} onRowClick={(t) => onOpen(t.id)} columns={[
            { key: "no", header: "#", width: "80px", render: (t) => `#${t.number}` },
            { key: "title", header: "Title", render: (t) => t.title },
            { key: "who", header: "Customer", render: (t) => t.customerName },
            { key: "assignee", header: "Assigned to", width: "160px", render: (t) => t.assignee ?? "Unassigned" },
            { key: "when", header: tab === "open" ? "Updated" : "Resolved", width: "130px", render: (t) => whenLabel(tab === "open" ? t.updatedAt : t.resolvedAt ?? t.updatedAt) },
            { key: "state", header: "Status", width: "130px", render: (t) => (tab === "open" && needsReply(t) ? <StatusPill tone="coral">Needs reply</StatusPill> : <StatusPill tone={t.status === "closed" ? "gray" : "teal"}>{t.status === "closed" ? "Resolved" : "Open"}</StatusPill>) }
          ]} />
        ) : null}
        {wide ? null : list.map((t) => (
          <ListRow key={t.id} onClick={() => onOpen(t.id)} title={<strong style={{ fontWeight: 500 }}>{t.title}</strong>}
            right={tab === "open" && needsReply(t) ? <StatusPill tone="coral">Needs reply</StatusPill> : <span className="sub">#{t.number}</span>}
            sub={`${t.customerName} · ${t.assignee ? `Assigned to ${t.assignee}` : "Unassigned"} · ${t.status === "closed" ? `Resolved ${whenLabel(t.resolvedAt ?? t.updatedAt)}` : `Updated ${whenLabel(t.updatedAt)}`}`} />
        ))}
      </div></div>
    </div>
  );
}

export function AdminTicketChat({ ticketId, canAssign = true, onBack, onChanged }: { ticketId: string; canAssign?: boolean; onBack: () => void; onChanged?: () => void }) {
  const { api } = useServices();
  const ticket = useAsync(() => api.admin.getTicket(ticketId), [ticketId], { refreshMs: 8_000 });
  const agents = useAsync(() => api.admin.ticketAgents(), []);
  const [confirm, setConfirm] = useState(false); const [err, setErr] = useState("");
  const t = ticket.data;
  if (ticket.loading) return <div className="screen"><TopBar title="Ticket" onBack={onBack} /><Loading /></div>;
  if (!t) return <div className="screen"><TopBar title="Ticket" onBack={onBack} /><div className="content"><ErrorBox message={ticket.error ?? "Ticket not found."} onRetry={ticket.reload} /></div></div>;
  const closed = t.status === "closed";
  const act = (p: Promise<unknown>) => { setErr(""); p.then(() => { ticket.reload(); onChanged?.(); }, (e: unknown) => setErr(messageOf(e))); };
  const assignedId = (agents.data ?? []).find((a) => a.name === t.assignee)?.id ?? "";
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
              <Select value={assignedId} disabled={!canAssign} onChange={(e) => act(api.admin.assignTicket(t.id, e.target.value || null))}>
                <option value="">Unassigned</option>
                {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </label>
            {confirm
              ? <span className="confirm-pair"><Button variant="primary" onClick={() => { setConfirm(false); act(api.admin.resolveTicket(t.id)); }}>Yes, resolve</Button><Button onClick={() => setConfirm(false)}>Cancel</Button></span>
              : <Button onClick={() => setConfirm(true)}>Mark resolved</Button>}
          </div>
        ) : <p className="muted" style={{ margin: "6px 0 0" }}>{t.assignee ? `Handled by ${t.assignee}.` : ""} The customer can no longer reply.</p>}
        {err ? <div className="field-error" role="alert">{err}</div> : null}
      </div>
      <Conversation messages={t.messages} me="admin" />
      {closed
        ? <div className="composer-closed"><p>Resolved. The conversation is read-only.</p></div>
        : <Composer placeholder="Reply to the customer" onSend={(text) => act(api.admin.replyTicket(t.id, text))} />}
    </div>
  );
}
