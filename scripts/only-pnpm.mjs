// Runs before `npm install`/`pnpm install`. The workspace links only work with pnpm, and plain `npm install` fails halfway.
if (!process.env.RR_BOOTSTRAP && !(process.env.npm_config_user_agent ?? "").startsWith("pnpm")) {
  console.error("\nThis project installs with pnpm, not npm.\nJust run:  npm run dev   (it installs and starts everything)\nOr:       corepack enable && pnpm install\n");
  process.exit(1);
}
