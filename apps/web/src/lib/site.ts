/** Public facts about the product, used by the landing page, its meta tags, structured data, the sitemap and llms.txt. */
export const SITE = {
  name: "KwikTask",
  tagline: "The simple task board that pays",
  description:
    "KwikTask is a simple task management system: assign tasks, manage tasks and review the work, then pay people straight to UPI. Workers claim tasks in one tap, use several emails under one login, and withdraw their earnings in cash whenever they like.",
  keywords: [
    "task board", "task management system", "assign tasks", "manage tasks", "task management app", "online task board",
    "team task tracker", "multiple emails one login", "easy payment", "cash withdrawal", "UPI payout", "earn by completing tasks",
    "sales team tasks", "task review and approval"
  ],
  /** The public origin, from APP_URL (set in production). Used for canonical links, the sitemap and share cards. */
  url: (process.env["APP_URL"] ?? "http://localhost:3000").replace(/\/$/, "")
} as const;

export const FAQ: { q: string; a: string }[] = [
  { q: "What is KwikTask?", a: "KwikTask is a task board and task management system. Admins assign and manage tasks, workers claim them, do the work, upload a screenshot as proof, and get paid after a review." },
  { q: "Can I use more than one email with one login?", a: "Yes. One KwikTask login can hold up to 10 verified emails. Every email can take each task once, and all earnings go to the same wallet." },
  { q: "How do I get paid?", a: "Approved work is added to your wallet straight away. You withdraw by typing the amount and your UPI ID; an admin sends the money and attaches the payment screenshot, so every withdrawal has a record." },
  { q: "How is my work checked?", a: "A person reviews each submission and decides 100%, 75%, 50%, 25% or 0% of the reward, always with a note that explains the decision." },
  { q: "Is it hard to start?", a: "No. Sign up with your email and a one-time code, pick a task, do it, upload the screenshot. Most tasks take a few minutes and show their time limit up front." },
  { q: "Who manages the tasks?", a: "Admins create tasks with a reward, slots and an optional time limit, add sales scripts or keywords, review submissions and pay out. Roles decide who can do what." }
];
