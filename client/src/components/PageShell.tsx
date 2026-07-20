import { ReactNode } from "react";
import SiteNav from "./SiteNav";
import SiteFooter from "./SiteFooter";
import { useReveal } from "@/hooks/useReveal";

/** Standard public page wrapper: nav + content + TREC footer. */
export default function PageShell({
  children,
  solidNav = false,
}: {
  children: ReactNode;
  solidNav?: boolean;
}) {
  useReveal([children]);
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <SiteNav solid={solidNav} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
