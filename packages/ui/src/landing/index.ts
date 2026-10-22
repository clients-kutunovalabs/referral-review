import { allTokens } from "../tokens/tokens";

/**
 * Styles for the public KwikTask page, as one string the page inlines in a <style> tag: no stylesheet request, no app CSS,
 * no app code. Built from the same design tokens as the apps.
 */
const RULES = `
@font-face { font-family: 'Rosarivo'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/rosarivo-400.woff2') format('woff2'); }
@font-face { font-family: 'Urbanist'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/urbanist-400.woff2') format('woff2'); }
@font-face { font-family: 'Urbanist'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/urbanist-500.woff2') format('woff2'); }
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body {
  font-family: var(--font-body);
  font-size: var(--text-md);
  color: var(--text-primary);
  background: var(--surface-0);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4 { font-family: var(--font-heading); font-weight: var(--weight-regular); }
button { font-family: inherit; }
:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
body { background: var(--surface-2); line-height: 1.55; }
.lp-header, main, .lp-footer { max-width: 1080px; margin: 0 auto; padding-left: var(--space-7); padding-right: var(--space-7); }
.lp-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); min-height: 64px; flex-wrap: wrap; }
.lp-logo { font-family: var(--font-heading); font-size: 24px; color: var(--brand); text-decoration: none; }
.lp-nav { display: flex; align-items: center; gap: var(--space-6); font-size: var(--text-lg); }
.lp-nav a { color: var(--text-secondary); text-decoration: none; }
.lp-nav a:hover { color: var(--text-primary); }
.lp-nav a:not(.lp-btn) { display: none; }
@media (min-width: 720px) { .lp-nav a:not(.lp-btn) { display: inline; } }

.lp-btn { display: inline-flex; align-items: center; justify-content: center; min-height: var(--tap-min); padding: 0 22px; border-radius: var(--radius-sm); background: var(--brand); color: var(--text-inverse) !important; font-weight: var(--weight-medium); font-size: var(--text-xl); text-decoration: none; border: var(--border-width) solid var(--brand); }
.lp-btn:hover { background: var(--brand-strong); }
.lp-btn-small { min-height: 40px; padding: 0 16px; font-size: var(--text-lg); }
.lp-btn-ghost { background: transparent; color: var(--brand) !important; border-color: var(--border-strong); }
.lp-btn-ghost:hover { background: var(--surface-1); }

.lp-hero { padding: 40px 0 32px; }
.lp-kicker { margin: 0 0 var(--space-4); color: var(--accent); font-size: var(--text-lg); font-weight: var(--weight-medium); }
.lp-hero h1 { font-size: 36px; line-height: 1.15; margin: 0 0 var(--space-6); color: var(--text-primary); }
.lp-lead { font-size: 18px; color: var(--text-secondary); max-width: 640px; margin: 0 0 var(--space-8); }
.lp-cta { display: flex; gap: var(--space-5); flex-wrap: wrap; }
.lp-points { list-style: none; padding: 0; margin: var(--space-8) 0 0; display: flex; flex-wrap: wrap; gap: var(--space-3); }
.lp-points li { background: var(--brand-bg); color: var(--brand); border-radius: var(--radius-pill); padding: 6px 14px; font-size: var(--text-md); font-weight: var(--weight-medium); }
@media (min-width: 720px) { .lp-hero { padding: 72px 0 48px; } .lp-hero h1 { font-size: 52px; } }

.lp-section { padding: 32px 0; border-top: var(--border-width) solid var(--border); }
.lp-section h2 { font-size: 28px; line-height: 1.2; margin: 0 0 var(--space-7); }
.lp-section h3 { font-family: var(--font-body); font-size: 18px; font-weight: var(--weight-medium); margin: 0 0 var(--space-2); }
.lp-section p { margin: 0; color: var(--text-secondary); font-size: 16px; }

.lp-steps { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--space-7); }
.lp-steps li { position: relative; padding-left: 52px; }
.lp-step-no { position: absolute; left: 0; top: 0; width: 36px; height: 36px; border-radius: 50%; background: var(--brand); color: var(--text-inverse); display: grid; place-items: center; font-weight: var(--weight-medium); }
@media (min-width: 900px) { .lp-steps { grid-template-columns: repeat(4, 1fr); } .lp-steps li { padding-left: 0; padding-top: 52px; } }

.lp-grid { display: grid; gap: var(--space-5); }
@media (min-width: 720px) { .lp-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1000px) { .lp-grid { grid-template-columns: repeat(3, 1fr); } }
.lp-card { background: var(--surface-1); border: var(--border-width) solid var(--border); border-radius: var(--radius-lg); padding: var(--space-8); }

.lp-band p { max-width: 760px; }
.lp-faq details { border-bottom: var(--border-width) solid var(--border); padding: var(--space-6) 0; }
.lp-faq summary { cursor: pointer; font-size: 17px; font-weight: var(--weight-medium); min-height: var(--tap-min); display: flex; align-items: center; }
.lp-faq details p { margin-top: var(--space-4); }
.lp-final { text-align: center; padding-bottom: 48px; }
.lp-final p { margin-bottom: var(--space-8); }
.lp-footer { padding-top: var(--space-8); padding-bottom: var(--space-9); border-top: var(--border-width) solid var(--border); color: var(--text-muted); font-size: var(--text-md); }
.lp-footer p { margin: 0; }
`;

/** tokens.css values that have no typed mirror in tokens.ts (tokens.test.ts checks these against tokens.css too). */
export const LANDING_EXTRA_TOKENS: Record<string, string> = {
  "--weight-regular": "400", "--weight-medium": "500", "--tap-min": "44px", "--border-width": "0.5px",
  "--focus-ring": "0 0 0 2px var(--surface-2), 0 0 0 4px var(--brand)"
};

export function landingCss(): string {
  const root = `:root{${Object.entries({ ...allTokens, ...LANDING_EXTRA_TOKENS }).map(([k, v]) => `${k}:${v}`).join(";")}}`;
  return (root + RULES).replace(/\n\s*/g, "\n").trim();
}
