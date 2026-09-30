import { useEffect, useState } from "react";
import { HubNav } from "@rr/ui/hub";
import { UserHub } from "./pages/UserHub";
import { AdminHub } from "./pages/AdminHub";
import { DesignSystem } from "./pages/DesignSystem";

const LINKS = [
  { href: "/", label: "User app" },
  { href: "/admin", label: "Admin app" },
  { href: "/design-system", label: "Design system" }
];

const normalise = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function App() {
  const [path, setPath] = useState(normalise(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(normalise(window.location.pathname));
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target || e.metaKey || e.ctrlKey) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      window.history.pushState({}, "", url.pathname);
      setPath(normalise(url.pathname));
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("click", onClick); };
  }, []);

  const page = path === "/admin" ? <AdminHub /> : path === "/design-system" ? <DesignSystem /> : <UserHub />;
  const active = LINKS.find((l) => l.href === path)?.href ?? "/";
  return (<><HubNav links={LINKS} path={active} env="Dev/staging" />{page}</>);
}
