import { landingCss } from "@rr/ui/landing";
import { FAQ, SITE } from "./site";

/**
 * The public KwikTask page as finished HTML. It is built here rather than as a Next page so that the title, description, share
 * tags and structured data are in <head> of the first bytes for every reader (search engines, AI crawlers, link previews), the
 * styles are inlined, and no framework JavaScript is sent: the page loads in one request.
 */

const STEPS = [
  { t: "Pick a task", d: "Browse the task board and claim one in a single tap. The reward, the slots left and the time limit are shown up front." },
  { t: "Do it and upload proof", d: "Follow the instructions (and the sales script, if the task has one), then upload a screenshot of what you did." },
  { t: "Get reviewed", d: "A person checks your work and credits 100%, 75%, 50%, 25% or 0% of the reward, always with a note." },
  { t: "Withdraw your cash", d: "Type the amount and your UPI ID. The money is sent and the payment screenshot is attached to your record." }
];

export const FEATURES = [
  { t: "Several emails, one login", d: "Add up to 10 verified emails to one account. Each email can take every task once, and everything lands in one wallet." },
  { t: "Quick and simple", d: "Sign up with an email code, claim, do, upload. Clear timers, clear rewards, no clutter. Works on any phone." },
  { t: "Easy payment and cash withdrawal", d: "Earnings show in your wallet the moment work is approved. Withdraw to any UPI ID whenever you like." },
  { t: "Fair, explained reviews", d: "Every decision comes with a note, so you always know why a task was paid in full, in part or not at all." },
  { t: "Built for sales tasks", d: "Admins can attach ready-to-use sales scripts, shared out evenly, or keywords to mention, to every task." },
  { t: "Assign and manage tasks as a team", d: "Create tasks with rewards, slots and time limits, review in a queue, pay with proof. Roles decide who can do what." }
];

const TITLE = `${SITE.name}: task board and task management system that pays by UPI`;
const SHARE = "Assign tasks, manage tasks and pay for finished work by UPI. Several emails under one login, quick and simple, easy cash withdrawal.";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function jsonLd(): string {
  const data = [
    {
      "@context": "https://schema.org", "@type": "SoftwareApplication", name: SITE.name, url: `${SITE.url}/`,
      applicationCategory: "BusinessApplication", operatingSystem: "Web, Android, iOS (installable web app)",
      description: SITE.description, featureList: FEATURES.map((f) => f.t)
    },
    { "@context": "https://schema.org", "@type": "WebSite", name: SITE.name, url: `${SITE.url}/` },
    {
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
    }
  ];
  return JSON.stringify(data).replace(/</g, "\\u003c"); // can never close the script tag
}

/** `nonce` comes from the per-request CSP; only the tiny bookmark-forwarding script needs it. */
export function landingHtml(nonce: string): string {
  const url = `${SITE.url}/`;
  const og = `${SITE.url}/og.png`;
  const n = esc(nonce);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(SITE.description)}">
<meta name="keywords" content="${esc(SITE.keywords.join(", "))}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#0c6a4e">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:locale" content="en_IN">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(`${SITE.name}: ${SITE.tagline}`)}">
<meta property="og:description" content="${esc(SHARE)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${SITE.name}: ${SITE.tagline}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(`${SITE.name}: ${SITE.tagline}`)}">
<meta name="twitter:description" content="${esc(SHARE)}">
<meta name="twitter:image" content="${esc(og)}">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/rosarivo-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/urbanist-400.woff2" as="font" type="font/woff2" crossorigin>
<style>${landingCss()}</style>
<script type="application/ld+json">${jsonLd()}</script>
<script nonce="${n}">if(location.hash.indexOf("#/")===0)location.replace("/app"+location.hash)</script>
</head><body>
<header class="lp-header">
<a class="lp-logo" href="/" aria-label="${esc(SITE.name)} home">${esc(SITE.name)}</a>
<nav class="lp-nav" aria-label="Main"><a href="#how">How it works</a><a href="#features">Features</a><a href="#faq">FAQ</a><a class="lp-btn lp-btn-small" href="/app">Log in</a></nav>
</header>
<main>
<section class="lp-hero">
<p class="lp-kicker">Task board &middot; task management system</p>
<h1>${esc(SITE.name)}: the simple task board that pays</h1>
<p class="lp-lead">Assign tasks, manage tasks and pay for finished work in one place. Workers claim tasks in one tap, use several emails under one login, and withdraw their earnings to UPI whenever they like.</p>
<div class="lp-cta"><a class="lp-btn" href="/app">Get started</a><a class="lp-btn lp-btn-ghost" href="/admin">Admin login</a></div>
<ul class="lp-points"><li>Several emails, one login</li><li>Quick and simple</li><li>Easy payment and cash withdrawal</li></ul>
</section>
<section id="how" class="lp-section">
<h2>How it works</h2>
<ol class="lp-steps">${STEPS.map((s, i) => `<li><span class="lp-step-no" aria-hidden="true">${i + 1}</span><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p></li>`).join("")}</ol>
</section>
<section id="features" class="lp-section">
<h2>Why teams and workers choose ${esc(SITE.name)}</h2>
<div class="lp-grid">${FEATURES.map((f) => `<article class="lp-card"><h3>${esc(f.t)}</h3><p>${esc(f.d)}</p></article>`).join("")}</div>
</section>
<section class="lp-section lp-band">
<h2>A task management system for teams that pay per task</h2>
<p>Sales teams, field teams and freelancers use ${esc(SITE.name)} to assign tasks to many people at once, manage every task from claim to payment, and keep a record of each review and each payout. Money is counted to the paisa, nothing is ever deleted, and every payment carries its proof.</p>
</section>
<section id="faq" class="lp-section">
<h2>Questions and answers</h2>
<div class="lp-faq">${FAQ.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div>
</section>
<section class="lp-section lp-final">
<h2>Start earning with ${esc(SITE.name)}</h2>
<p>Sign up with your email, claim your first task and get paid to UPI.</p>
<a class="lp-btn" href="/app">Get started</a>
</section>
</main>
<footer class="lp-footer"><p>&copy; ${new Date().getFullYear()} ${esc(SITE.name)}. Task board and task management system.</p></footer>
</body></html>`;
}
