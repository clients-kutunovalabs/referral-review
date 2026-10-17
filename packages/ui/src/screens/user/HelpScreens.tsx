import { useState } from "react";
import { whenLabel, type Ticket } from "@rr/core";
import { Button, DataTable, EmptyState, Field, FileUpload, Input, ListRow, StatusPill, Tabs, Textarea, TopBar, useLayout } from "../../primitives";
import { Composer, Conversation } from "../shared/Conversation";
import { createTicket, sendMessage, useTickets } from "../../demo/ticketStore";

export type HelpTab = "open" | "closed";
const CUSTOMER = { name: "Priya S.", email: "priya@gmail.com" };

/** Help: two lists, Open and Closed, so rows need no status. */
export function HelpScreen({ tab, setTab, onOpen, onCreate }: { tab: HelpTab; setTab: (t: HelpTab) => void; onOpen: (id: string) => void; onCreate: () => void }) {
  const tickets = useTickets().filter((t) => t.customerEmail === CUSTOMER.email);
  const open = tickets.filter((t) => t.status === "open");
  const closed = tickets.filter((t) => t.status === "closed");
  const list = tab === "open" ? open : closed;
  const wide = useLayout() !== "phone";
  return (
    <div className="screen"><TopBar title="Help" subtitle="Ask support a question and read the replies here" actions={<Button variant="primary" onClick={onCreate}>Create ticket</Button>} />
      <Tabs<HelpTab> value={tab} onChange={setTab} tabs={[{ id: "open", label: `Open (${open.length})` }, { id: "closed", label: `Closed (${closed.length})` }]} />
      <div className="scrollarea"><div className="content">
        {list.length === 0 ? <EmptyState>{tab === "open" ? "No open tickets. Tap Create ticket if you need help." : "No closed tickets yet."}</EmptyState> : null}
        {wide && list.length ? (
          <DataTable caption="Your tickets" rows={list} rowKey={(t) => t.id} onRowClick={(t) => onOpen(t.id)} columns={[
            { key: "no", header: "#", width: "80px", render: (t) => `#${t.number}` },
            { key: "title", header: "Title", render: (t) => t.title },
            { key: "when", header: tab === "open" ? "Updated" : "Resolved", width: "150px", render: (t) => whenLabel(t.status === "closed" ? t.resolvedAt ?? t.updatedAt : t.updatedAt) }
          ]} />
        ) : null}
        {wide ? null : list.map((t) => (
          <ListRow key={t.id} onClick={() => onOpen(t.id)} title={<strong style={{ fontWeight: 500 }}>{t.title}</strong>}
            right={<span className="sub">#{t.number}</span>} sub={t.status === "closed" ? `Resolved ${whenLabel(t.resolvedAt ?? t.updatedAt)}` : `Updated ${whenLabel(t.updatedAt)}`} />
        ))}
      </div></div>
      {wide ? null : <div className="screen-footer"><Button variant="primary" block onClick={onCreate}>Create ticket</Button></div>}
    </div>
  );
}

export function CreateTicketBody({ onCreated }: { onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [errs, setErrs] = useState<{ title?: string; body?: string }>({});
  function submit() {
    const e: typeof errs = {};
    if (!title.trim()) e.title = "Give your ticket a short title.";
    if (body.trim().length < 10) e.body = "Describe the problem in at least 10 characters.";
    setErrs(e);
    if (e.title || e.body) return;
    const id = createTicket({ title: title.trim(), body: body.trim(), customerName: CUSTOMER.name, customerEmail: CUSTOMER.email, ...(file ? { attachment: { name: file.name, url: URL.createObjectURL(file) } } : {}) });
    onCreated(id);
  }
  return (
    <>
      <Field label="Title" error={errs.title}><Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Payout is still in process" /></Field>
      <Field label="Description" error={errs.body}><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened? Include dates and amounts if you can." /></Field>
      <p className="muted" style={{ margin: "0 0 4px" }}>Attach an image (optional). JPG, PNG or WebP, up to 5 MB.</p>
      <FileUpload label="Tap to attach an image" onFile={setFile} />
      <Button variant="primary" block onClick={submit}>Submit ticket</Button>
    </>
  );
}

export function TicketChatScreen({ ticketId, onBack, onNew }: { ticketId: string; onBack: () => void; onNew: () => void }) {
  const t: Ticket | undefined = useTickets().find((x) => x.id === ticketId);
  if (!t) return <div className="screen"><TopBar title="Ticket" onBack={onBack} /><EmptyState>Ticket not found.</EmptyState></div>;
  const closed = t.status === "closed";
  return (
    <div className="screen">
      <TopBar title={t.title} onBack={onBack} />
      <div className="ticket-meta">
        <span>#{t.number}</span>
        <StatusPill tone={closed ? "gray" : "teal"}>{closed ? "Resolved" : "Open"}</StatusPill>
        <span className="muted">{closed ? `Resolved ${whenLabel(t.resolvedAt ?? t.updatedAt)}` : t.assignee ? `Support: ${t.assignee}` : "Waiting for support"}</span>
      </div>
      <Conversation messages={t.messages} me="customer" />
      {closed ? (
        <div className="composer-closed">
          <p>This ticket is resolved. You can read the conversation, but you can't reply.</p>
          <Button block onClick={onNew}>Create a new ticket</Button>
        </div>
      ) : (
        <Composer onSend={(text) => { sendMessage(t.id, "customer", CUSTOMER.name, text); }} />
      )}
    </div>
  );
}
