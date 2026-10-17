import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";
import { copyText } from "../lib/clipboard";

export type Tone = "teal" | "amber" | "coral" | "green" | "gray";

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "dangerSolid";
  block?: boolean;
  small?: boolean;
  compact?: boolean;
};
export function Button({ variant = "default", block, small, compact, className = "", type = "button", ...rest }: BtnProps) {
  const cls = ["btn", variant === "default" ? "" : variant, block ? "block" : "", small ? "sm" : "", compact ? "compact" : "", className].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}

export function Card({ children, alert, hero, onClick, style }: { children: ReactNode; alert?: boolean; hero?: boolean; onClick?: () => void; style?: React.CSSProperties }) {
  const cls = ["card", alert ? "alert" : "", hero ? "hero" : "", onClick ? "clickable" : ""].filter(Boolean).join(" ");
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

/** Password box with a Show/Hide switch. The switch sits outside the <label> so it does not become part of the field's name. */
export function PasswordField({ label, error, hint, autoComplete, value, onChange, disabled }: {
  label: string; error?: string | undefined; hint?: string; autoComplete: "current-password" | "new-password";
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} />
        <button type="button" className="pw-toggle" aria-pressed={shown} aria-label={shown ? "Hide password" : "Show password"} onClick={() => setShown(!shown)}>
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {hint && !error ? <div className="hint">{hint}</div> : null}
      {error ? <div className="field-error" role="alert">{error}</div> : null}
    </div>
  );
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} />; }

export function Tabs<T extends string>({ tabs, value, onChange, inline }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; inline?: boolean }) {
  return (
    <div className={`tabs${inline ? " inline" : ""}`} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={`tab${t.id === value ? " on" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Phone: a slim bar. Tablet and desktop: the page header, with the title, an optional subtitle and the page's main action on the right. */
export function TopBar({ title, onBack, right, subtitle, actions }: { title: string; onBack?: () => void; right?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  const layout = useLayout();
  return (
    <div className="topbar">
      {onBack ? <button className="back" aria-label="Back" onClick={onBack}>&larr;</button> : null}
      <div className="grow">
        <h1 className="page-title">{title}</h1>
        {subtitle && layout !== "phone" ? <div className="page-sub">{subtitle}</div> : null}
      </div>
      {right}
      {layout !== "phone" && actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export type IconName = "tasks" | "mytasks" | "wallet" | "payout" | "help" | "home" | "review" | "people" | "support" | "user";

const ICON_PATHS: Record<IconName, ReactNode> = {
  tasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></>,
  mytasks: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12h6M9 16h4" /></>,
  wallet: <><path d="M4 8V6a2 2 0 0 1 2-2h11v4" /><rect x="4" y="8" width="16" height="12" rx="2" /><circle cx="16" cy="14" r="1" /></>,
  payout: <><path d="M12 15V4M7 9l5-5 5 5" /><path d="M5 20h14" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7" /><circle cx="12" cy="17" r=".6" /></>,
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />,
  review: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" /></>,
  people: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3 3 0 0 1 0 5.6M18 14.3c1.8.8 3 2.6 3 4.7" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>,
  support: <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
};

/** Line icon drawn in currentColor, so it follows the text colour of whatever contains it. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  );
}

export interface NavItem {
  id: string; label: string; badge?: number; icon?: IconName;
  /** Wider label used in the desktop sidebar (e.g. "Review queue" for "Review"). */
  longLabel?: string;
  /** Only shown in the tablet rail and desktop sidebar; the phone bar stays at five items. */
  wideOnly?: boolean;
}
/** Phone: bottom bar. Tablet: icon rail. Desktop: sidebar with the product name on top and `footer` at the bottom. */
export function BottomNav({ items, active, onSelect, brand, footer }: { items: NavItem[]; active: string; onSelect: (id: string) => void; brand?: string; footer?: ReactNode }) {
  const layout = useLayout();
  const shown = items.filter((i) => !i.wideOnly || layout !== "phone");
  return (
    <nav className={`bottomnav${shown.length > 5 && layout === "phone" ? " dense" : ""}`} aria-label="Main">
      {brand ? <div className="nav-brand">{brand}</div> : null}
      {shown.map((i) => (
        <button key={i.id} className={`navitem${i.id === active ? " on" : ""}`} aria-current={i.id === active ? "page" : undefined} onClick={() => onSelect(i.id)}>
          {i.icon ? <span className="navicon"><Icon name={i.icon} />{i.badge ? <span className="badge on-icon">{i.badge}</span> : null}</span> : <span className="navdot" />}
          <span className="navlabel">{layout === "desktop" ? i.longLabel ?? i.label : i.label}</span>
          {i.badge ? <span className="badge in-row">{i.badge}</span> : null}
        </button>
      ))}
      {footer ? <div className="nav-footer">{footer}</div> : null}
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

/** Image picker with client-side checks (type, size). The server re-validates; never trust the browser. */
export function FileUpload({ label, onFile, maxMb = 5 }: { label: string; onFile: (file: File | null) => void; maxMb?: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setError("Use a JPG, PNG or WebP image."); return; }
    if (f.size > maxMb * 1024 * 1024) { setError(`Image must be under ${maxMb} MB.`); return; }
    setError(""); setFile(f); setPreview(URL.createObjectURL(f)); onFile(f);
  }
  return (
    <div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} aria-label={label} />
      <button type="button" className={`upload${file ? " filled" : ""}`} onClick={() => inputRef.current?.click()}>
        {file && preview ? (
          <span className="upload-row"><img src={preview} alt="" className="upload-thumb" /><span className="upload-name">{file.name}<small>Tap to replace</small></span></span>
        ) : label}
      </button>
      {error ? <div className="field-error" role="alert">{error}</div> : null}
    </div>
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
  const h = Math.floor(secs / 3600);
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(h > 0 ? 2 : 2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return <StatusPill tone={secs < 300 ? "coral" : "amber"}>{h > 0 ? `${h}:` : ""}{mm}:{ss} left</StatusPill>;
}

/* ---------- Layout: phone, tablet and desktop follow the width of the app frame, not the browser window ---------- */

export type Layout = "phone" | "tablet" | "desktop";
export const BREAKPOINTS = { tablet: 640, desktop: 1024 } as const;
export const layoutFor = (width: number): Layout => (width >= BREAKPOINTS.desktop ? "desktop" : width >= BREAKPOINTS.tablet ? "tablet" : "phone");

const LayoutContext = createContext<Layout>("phone");
/** The layout of the frame this component is drawn in. Screens use it to choose cards or a table, a footer button or a header action. */
export const useLayout = (): Layout => useContext(LayoutContext);

/** Root of an app. Measures itself, so the same screens work inside ui-hub's phone, tablet and desktop previews and on a real site. */
export function AppFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>("phone");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setLayout(layoutFor(el.clientWidth));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => { if (entry) setLayout(layoutFor(entry.contentRect.width)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <LayoutContext.Provider value={layout}><div ref={ref} className="app-frame" data-layout={layout}>{children}</div></LayoutContext.Provider>;
}

export type Device = "phone" | "tablet" | "desktop";
/** ui-hub preview: the app inside a phone, a tablet or a desktop browser window. */
export function DeviceFrame({ device = "phone", children }: { device?: Device; children: ReactNode }) {
  return <div className={`device ${device}`}><AppFrame>{children}</AppFrame></div>;
}
export function PhoneFrame({ children }: { children: ReactNode }) {
  return <DeviceFrame device="phone">{children}</DeviceFrame>;
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

/** Inline message inside a card (not a floating toast). */
export function Notice({ tone, children }: { tone: "green" | "amber" | "coral"; children: ReactNode }) {
  return <div className={`notice ${tone}`} role="status"><span aria-hidden="true">{tone === "coral" ? "\u2715" : "\u2713"}</span><div>{children}</div></div>;
}

/** A short list of mutually exclusive choices shown as buttons (radio semantics). */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { id: T; label: string }[]; onChange: (id: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} className={`seg${o.id === value ? " on" : ""}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Overlay confirmation. The confirm button is always filled: brand for safe actions, red for destructive ones. */
export function ConfirmSheet({ title, children, confirmLabel, tone = "primary", onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; tone?: "primary" | "danger"; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <div className="note-text">{children}</div>
      <Button variant={tone === "danger" ? "dangerSolid" : "primary"} block style={{ margin: "14px 0 8px" }} onClick={onConfirm}>{confirmLabel}</Button>
      <Button block onClick={onCancel}>Cancel</Button>
    </Sheet>
  );
}

export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; align?: "right"; width?: string; /** Drop this column on tablet, where the table is narrow. */ hideOnTablet?: boolean }
/** Full-width table used on tablet and desktop in place of the phone's card list. A row is a button when `onRowClick` is given. */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, caption }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; caption: string;
}) {
  return (
    <table className="data-table">
      <caption className="sr-only">{caption}</caption>
      <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.hideOnTablet ? "hide-tablet" : ""} style={{ ...(c.width ? { width: c.width } : {}), ...(c.align ? { textAlign: c.align } : {}) }}>{c.header}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)} className={onRowClick ? "clickable" : ""} {...(onRowClick ? { onClick: () => onRowClick(r), tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") onRowClick(r); } } : {})}>
            {columns.map((c) => <td key={c.key} className={c.hideOnTablet ? "hide-tablet" : ""} style={c.align ? { textAlign: c.align } : undefined}>{c.render(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
