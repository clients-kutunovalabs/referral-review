import { useState } from "react";
import {
  BottomNav, Button, Card, Chips, CopyButton, Countdown, EmptyState, Field, FileUpload, Input, ListRow, Select,
  StatusPill, Tabs, Textarea, TopBar, colorTokens, fontTokens, radiusTokens, sizeTokens, spaceTokens, allTokens
} from "@rr/ui";

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return ((x! + 0.05) / (y! + 0.05)).toFixed(1); };

function Swatches({ group, against }: { group: Record<string, string>; against?: string }) {
  return (
    <div className="swatches">
      {Object.entries(group).map(([name, value]) => (
        <div className="swatch" key={name}>
          <div className="chip-color" style={{ background: `var(${name})` }} />
          <div className="meta"><strong>{name.replace("--", "")}</strong><code>{value}</code>
            {against ? <code>{ratio(value, allTokens[against]!)}:1 on {against.replace("--", "")}</code> : null}</div>
        </div>
      ))}
    </div>
  );
}

export function DesignSystem() {
  const [tab, setTab] = useState("a");
  return (
    <main className="ds">
      <h1>Design system</h1>
      <p className="lead">Every colour, font, size and component used by the user site, the admin and ui-hub. It starts from the original prototypes and lives in <code>packages/ui</code>. Nothing else in the repo defines styles. In production this page is not deployed.</p>

      <h2>Colour</h2>
      <h3>Neutrals: surfaces</h3><Swatches group={colorTokens.surface} />
      <h3>Text (contrast against white)</h3><Swatches group={colorTokens.text} against="--surface-2" />
      <h3>Borders</h3><Swatches group={colorTokens.border} />
      <h3>Brand: one colour for actions, active, success and money</h3>
      <Swatches group={colorTokens.brand} against="--surface-2" />
      <h3>Accent: one colour for reward highlights, processing and time pressure</h3>
      <Swatches group={colorTokens.accent} against="--surface-2" />
      <h3>Functional red: rejected, flagged, errors only (not a brand colour)</h3>
      <Swatches group={{ "--coral": colorTokens.status["--coral"], "--coral-bg": colorTokens.status["--coral-bg"] }} against="--surface-2" />
      <p className="lead">The palette is two colours plus neutrals. The older names stay as roles: <code>--teal</code> and <code>--green</code> are the brand, <code>--amber</code> is the accent.</p>
      <div className="specimen states">
        <StatusPill tone="teal">Active</StatusPill><StatusPill tone="green">+₹60 earned</StatusPill><StatusPill tone="amber">Processing</StatusPill>
        <StatusPill tone="coral">Rejected</StatusPill><StatusPill tone="gray">Closed</StatusPill>
      </div>
      <div className="specimen states">
        <Button variant="primary">Brand action</Button><Button>Secondary</Button><Button variant="danger">Danger</Button>
      </div>

      <h2>Typography</h2>
      <div className="specimen">
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 32 }}>Rosarivo heading: Task marketplace</div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 15, marginTop: 8 }}>Urbanist body: Pick a task, do the work, get paid.</div>
        <div className="mono" style={{ marginTop: 8 }}>Mono: rahul.kumar@okhdfc</div>
        <p className="hint">Fonts: {Object.entries(fontTokens).map(([k, v]) => `${k}: ${v}`).join(" | ")}</p>
      </div>
      <table><thead><tr><th>Token</th><th>Size</th><th>Sample</th></tr></thead><tbody>
        {Object.entries(sizeTokens).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td><td style={{ fontSize: `var(${k})` }}>The quick brown fox</td></tr>)}
      </tbody></table>

      <h2>Radius and spacing</h2>
      <div className="specimen states">
        {Object.entries(radiusTokens).map(([k, v]) => <div key={k} style={{ width: 90, height: 56, border: "1px solid var(--border-strong)", borderRadius: `var(${k})`, display: "grid", placeItems: "center", fontSize: 11 }}>{k.replace("--radius-", "")} {v}</div>)}
      </div>
      <div className="specimen">
        {Object.entries(spaceTokens).map(([k, v]) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, fontSize: 12 }}><code style={{ width: 90 }}>{k}</code><div style={{ height: 10, width: `var(${k})`, background: "var(--teal)" }} />{v}</div>)}
      </div>

      <h2>Buttons</h2>
      <div className="specimen states">
        <Button>Default</Button><Button variant="primary">Primary</Button><Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button><Button small>Small</Button><CopyButton text="rahul.kumar@okhdfc" />
      </div>

      <h2>Forms</h2>
      <div className="specimen state-box">
        <Field label="Text input" hint="Helper text"><Input placeholder="Placeholder" /></Field>
        <Field label="With error" error="This field is required."><Input defaultValue="oops" /></Field>
        <Field label="Textarea"><Textarea rows={3} placeholder="Note" /></Field>
        <Field label="Select"><Select><option>Tone: friendly</option><option>Tone: professional</option></Select></Field>
        <FileUpload label="Tap to upload screenshot" onFile={() => undefined} />
      </div>

      <h2>Cards, rows, chips</h2>
      <div className="specimen state-box">
        <Card><h3>Card title</h3><p>Reward ₹40 · 32 of 100 slots left</p><div className="row"><StatusPill tone="teal">30 min timer</StatusPill><Button>View</Button></div></Card>
        <Card alert><p style={{ color: "var(--coral)" }}>Alert card for blocking problems.</p></Card>
        <ListRow title="Priya S." right={<StatusPill tone="teal">Active</StatusPill>} sub="priya••@gmail.com · ₹540 lifetime" />
        <Chips items={["appointment reminders", "patient records", "free trial"]} />
        <Chips items={["found", "missing"]} hits={["found"]} misses={["missing"]} />
        <div style={{ marginTop: 10 }}><Countdown minutes={18} /> <Countdown minutes={3} /></div>
        <EmptyState>Nothing here yet.</EmptyState>
      </div>

      <h2>Navigation</h2>
      <div className="specimen">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "a", label: "Active" }, { id: "b", label: "Under review" }, { id: "c", label: "Completed" }]} />
        <div className="frame-box" style={{ marginTop: 12 }}><div className="app-frame"><TopBar title="Top bar" onBack={() => undefined} /><div style={{ flex: 1 }} /><BottomNav items={[{ id: "1", label: "Tasks" }, { id: "2", label: "My tasks" }, { id: "3", label: "Review", badge: 3 }]} active="1" onSelect={() => undefined} /></div></div>
      </div>

      <h2>Accessibility baseline</h2>
      <ul>
        <li>Text meets 4.5:1 on all surfaces (checked by a test in <code>packages/ui</code>).</li>
        <li>Tap targets are at least 44px, except <em>small</em> buttons (36px) used beside another target.</li>
        <li>Visible keyboard focus ring; every input has a label.</li>
      </ul>
    </main>
  );
}
