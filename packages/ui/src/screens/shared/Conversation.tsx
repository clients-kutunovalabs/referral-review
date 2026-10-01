import { useEffect, useRef, useState } from "react";
import { dateParts, type TicketMessage } from "@rr/core";
import { Button, Textarea } from "../../primitives";

/** Chat bubbles. `me` is the side of the person looking at the screen. */
export function Conversation({ messages, me }: { messages: TicketMessage[]; me: "customer" | "admin" }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages.length]);
  let lastDay = "";
  return (
    <div className="chat" role="log" aria-label="Conversation">
      {messages.map((m) => {
        const { date, time } = dateParts(m.at);
        const dayBreak = date !== lastDay ? (lastDay = date) : null;
        return (
          <div key={m.id}>
            {dayBreak ? <div className="chat-day">{dayBreak}</div> : null}
            {m.sender === "system" ? (
              <div className="chat-sys">{m.body} &middot; {time}</div>
            ) : (
              <div className={`msg ${m.sender === me ? "me" : "them"}`}>
                <div className="msg-name">{m.sender === me ? "You" : m.senderName}</div>
                {m.attachment ? <img className="msg-img" src={m.attachment.url} alt={m.attachment.name} /> : null}
                <div className="msg-body">{m.body}</div>
                <div className="msg-time">{time}</div>
              </div>
            )}
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

export function Composer({ onSend, placeholder = "Type a message" }: { onSend: (text: string) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const send = () => { if (text.trim()) { onSend(text); setText(""); } };
  return (
    <div className="composer">
      <Textarea rows={1} aria-label="Message" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <Button variant="primary" disabled={!text.trim()} onClick={send}>Send</Button>
    </div>
  );
}
