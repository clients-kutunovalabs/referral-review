import "../styles/index.css";
import "./hub.css";
import type { ReactNode } from "react";

export { PhoneFrame } from "../primitives";

export interface HubLink { href: string; label: string }
export function HubNav({ links, path, env }: { links: HubLink[]; path: string; env: string }) {
  return (
    <header className="hub-nav">
      <span className="brand">UI Hub</span>
      {links.map((l) => <a key={l.href} href={l.href} className={path === l.href ? "on" : ""}>{l.label}</a>)}
      <span className="env pill amber">{env}: not deployed to production</span>
    </header>
  );
}

export interface JumpGroup<T extends string> { label: string; items: { id: T; label: string }[] }
export function JumpPanel<T extends string>({ title, hint, groups, active, onPick, children }: {
  title: string; hint: string; groups: JumpGroup<T>[]; active: T; onPick: (id: T) => void; children?: ReactNode;
}) {
  return (
    <aside className="jumppanel">
      <h4>{title}</h4>
      <p>{hint}</p>
      {children}
      {groups.map((g) => (
        <div className="jumpgroup" key={g.label}>
          <div className="glabel">{g.label}</div>
          {g.items.map((i) => <button key={i.id} className={`jumpbtn${i.id === active ? " on" : ""}`} onClick={() => onPick(i.id)}>{i.label}</button>)}
        </div>
      ))}
    </aside>
  );
}

export function Gallery({ children }: { children: ReactNode }) { return <div className="gallery">{children}</div>; }
export function GalleryItem({ caption, children }: { caption: string; children: ReactNode }) {
  return <figure>{children}<figcaption>{caption}</figcaption></figure>;
}
export function HubPage({ children }: { children: ReactNode }) { return <div className="hub-page">{children}</div>; }
