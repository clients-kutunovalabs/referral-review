/**
 * Demo-only in-memory ticket store so the user app and the admin app in ui-hub talk to the same tickets
 * (a ticket created on the user side shows up on the admin side, a reply shows up in the chat, and so on).
 * The real apps replace this with API calls; the screens only use the hook and the actions below.
 */
import { useSyncExternalStore } from "react";
import { fixtures, type Ticket, type TicketMessage } from "@rr/core";

const seed = (): Ticket[] => fixtures.tickets.map((t) => ({ ...t, messages: t.messages.map((m) => ({ ...m })) }));
let tickets: Ticket[] = seed();
let nextNumber = 1043;
let nextMsg = 1000;
const listeners = new Set<() => void>();
const emit = () => { tickets = [...tickets]; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useTickets(): Ticket[] {
  return useSyncExternalStore(subscribe, () => tickets, () => tickets);
}

function patch(id: string, fn: (t: Ticket) => Ticket) {
  tickets = tickets.map((t) => (t.id === id ? fn(t) : t));
  emit();
}
const msg = (m: Omit<TicketMessage, "id" | "at">): TicketMessage => ({ ...m, id: `m${nextMsg++}`, at: new Date().toISOString() });

export interface NewTicket { title: string; body: string; attachment?: { name: string; url: string }; customerName: string; customerEmail: string }

export function createTicket(n: NewTicket): string {
  const now = new Date().toISOString();
  const id = `tk${nextNumber}`;
  tickets = [{
    id, number: nextNumber++, title: n.title, status: "open", customerName: n.customerName, customerEmail: n.customerEmail,
    assignee: null, createdAt: now, updatedAt: now,
    messages: [{ id: `m${nextMsg++}`, sender: "customer", senderName: n.customerName, body: n.body, at: now, ...(n.attachment ? { attachment: n.attachment } : {}) }]
  }, ...tickets];
  emit();
  return id;
}

/** Returns false (and does nothing) when the ticket is resolved: nobody can type in a closed chat. */
export function sendMessage(id: string, sender: "customer" | "admin", senderName: string, body: string): boolean {
  const t = tickets.find((x) => x.id === id);
  if (!t || t.status === "closed" || !body.trim()) return false;
  const m = msg({ sender, senderName, body: body.trim() });
  patch(id, (x) => ({ ...x, messages: [...x.messages, m], updatedAt: m.at }));
  return true;
}

export function assignTicket(id: string, assignee: string | null, by: string) {
  patch(id, (x) => {
    if (x.status === "closed" || x.assignee === assignee) return x;
    const m = msg({ sender: "system", senderName: "System", body: assignee ? `Assigned to ${assignee}${assignee === by ? "" : ` by ${by}`}` : `Unassigned by ${by}` });
    return { ...x, assignee, messages: [...x.messages, m], updatedAt: m.at };
  });
}

export function resolveTicket(id: string, by: string) {
  patch(id, (x) => {
    if (x.status === "closed") return x;
    const m = msg({ sender: "system", senderName: "System", body: `Marked as resolved by ${by}` });
    return { ...x, status: "closed", messages: [...x.messages, m], updatedAt: m.at, resolvedAt: m.at };
  });
}

export function resetTickets() { tickets = seed(); nextNumber = 1043; emit(); }

/** Tickets where the customer spoke last and an admin has not answered yet. */
export const needsReply = (t: Ticket): boolean => {
  const last = [...t.messages].reverse().find((m) => m.sender !== "system");
  return t.status === "open" && last?.sender === "customer";
};
