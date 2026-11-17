import { useEffect } from "react";
import { useLocation } from "wouter";
import { ClientList } from "@/components/apartments/ClientList";
import { LocatorWorkspace } from "@/components/apartments/LocatorWorkspace";
import { PublicApartments } from "@/components/apartments/PublicApartments";

/**
 * Apartment locating (Nov 17, 2026). /apartments is the renter page, /apartments/team the locators' workspace and
 * /apartments/list/<token> a client's options. Not linked from the rest of the site, and kept out of search
 * engines, until Peter says it is done.
 */
export default function Apartments() {
  const [path] = useLocation();
  useEffect(() => {
    const previous = document.title;
    document.title = "Apartment Locating | Lifestyle Design Realty";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => { document.title = previous; meta.remove(); };
  }, []);
  const list = /^\/apartments\/list\/([a-f0-9]{48})\/?$/.exec(path);
  if (list) return <ClientList token={list[1]!} />;
  if (/^\/apartments\/team\/?$/.test(path)) return <LocatorWorkspace />;
  return <PublicApartments />;
}
