import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HubNav } from "@rr/ui/hub";
import { UserHub } from "./pages/UserHub";
import { AdminHub } from "./pages/AdminHub";

// Standalone prototype build: one flow per file, no address-bar routing, works from file://.
const view = import.meta.env.VITE_STANDALONE_VIEW === "admin" ? "admin" : "user";
const label = view === "admin" ? "Admin flow" : "User flow";
document.title = `Task board: ${label}`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HubNav links={[{ href: "#", label }]} path="#" env="Prototype: demo data, resets on reload" />
    {view === "admin" ? <AdminHub ownerOnly /> : <UserHub />}
  </StrictMode>
);
