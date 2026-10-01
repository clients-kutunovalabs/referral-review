import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";
import { copyText } from "../lib/clipboard";

export type Tone = "teal" | "amber" | "coral" | "green" | "gray";

export function StatusPill({ tone, large, children }: { tone: Tone; large?: boolean; children: ReactNode }) {
  return <span className={`pill ${tone}${large ? " lg" : ""}`}>{children}</span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger";
  block?: boolean;
  small?: boolean;
};
export function Button({ variant = "default", block, small, className = "", type = "button", ...rest }: BtnProps) {
  const cls = ["btn", variant === "default" ? "" : variant, block ? "block" : "", small ? "sm" : "", className].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}

export function Card({ children, alert, onClick, style }: { children: ReactNode; alert?: boolean; onClick?: () => void; style?: React.CSSProperties }) {
  const cls = ["card", alert ? "alert" : "", onClick ? "clickable" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} onClick={onClick} style={style} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}>
      {children}
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string | undefined; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && !error ? <div className="hint">{hint}</div> : null}
      {error ? <div className="field-error" role="alert">{error}</div> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} />; }

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={`tab${t.id === value ? " on" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="topbar">
      {onBack ? <button className="back" aria-label="Back" onClick={onBack}>&larr;</button> : null}
      <span className="grow">{title}</span>
      {right}
    </div>
  );
}

export interface NavItem { id: string; label: string; badge?: number }
export function BottomNav({ items, active, onSelect }: { items: NavItem[]; active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((i) => (
        <button key={i.id} className={`navitem${i.id === active ? " on" : ""}`} aria-current={i.id === active ? "page" : undefined} onClick={() => onSelect(i.id)}>
          <span className="navdot" />
          <span>{i.label}{i.badge ? <span className="badge">{i.badge}</span> : null}</span>
        </button>
      ))}
    </nav>
  );
}

export function ListRow({ title, right, sub, onClick }: { title: ReactNode; right?: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  return (
    <div className="listrow" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}>
      <div className="top"><span>{title}</span>{right}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Chips({ items, hits, misses, onRemove }: { items: string[]; hits?: string[]; misses?: string[]; onRemove?: (k: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="chips">
      {items.map((k) => {
        const tone = hits?.includes(k) ? " hit" : misses?.includes(k) ? " miss" : "";
        return (
          <span key={k} className={`chip${tone}`}>
            {hits?.includes(k) ? "✓ " : misses?.includes(k) ? "✗ " : ""}{k}
            {onRemove ? <button aria-label={`Remove ${k}`} onClick={() => onRemove(k)}>&times;</button> : null}
          </span>
        );
      })}
    </div>
  );
}

/** Screenshot upload: UI only; the real one validates type/size client and server side. */
export function FileUpload({ label, filled, onPick }: { label: string; filled: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`upload${filled ? " filled" : ""}`} onClick={onPick}>
      {filled ? "✓ Screenshot attached (tap to replace)" : label}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button small onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1200); } }}>
      {done ? "Copied" : label}
    </Button>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t); }, [message, onDone]);
  return <div className="toast" role="status">{message}</div>;
}

export function Countdown({ minutes }: { minutes: number }) {
  const [secs, setSecs] = useState(minutes * 60);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return <StatusPill tone={secs < 300 ? "coral" : "amber"}>{mm}:{ss} left</StatusPill>;
}

export function PhoneFrame({ children }: { children: ReactNode }) {
  return <div className="phone"><div className="app-frame">{children}</div></div>;
}

/** Overlay panel: slides up over the current screen. Closes on backdrop tap, close button or Esc. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="grow">{title}</span>
          <button className="sheet-close" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
