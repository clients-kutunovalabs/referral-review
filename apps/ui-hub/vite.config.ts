import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ui-hub is dev/staging only. It is never built into the production image.
export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false }
});
