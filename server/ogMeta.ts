import type { Express, NextFunction, Request, Response } from "express";
import { getCityMatchBySlug, getPartnerPitchBySlug } from "./db";
import { selectCityImage } from "../shared/cityImagery";

const OG_IMAGE = "/manus-storage/convince-og-card_a3d08b2e.png";

/**
 * Recruiting-specific share card for /join. Shared links must sell the hiring
 * opportunity at a glance rather than the general brokerage homepage.
 * Rendered at exactly 1200x630 to match the declared og:image dimensions —
 * crawlers reserve space from those numbers, so they must not lie.
 */
export const JOIN_OG_IMAGE = "/manus-storage/join-og-card-1200x630_68cc9bda.png";

export const JOIN_OG_TITLE = "Now Hiring: Licensed Agents — Lifestyle Design Realty";

export const JOIN_OG_DESCRIPTION =
  "Real leads. Real support. Lease commissions up to $6,000 per deal. Veteran-owned brokerage hiring in Austin, San Antonio, Dallas & Houston.";

/** Public landing-only card. Never attach metadata to personal Deals URLs. */
export const DEALS_OG_IMAGE = "/manus-storage/builder-deals-og-card_1b97dbbc.png";
export const DEALS_OG_TITLE = "This week's best new-build deals in San Antonio";
export const DEALS_OG_DESCRIPTION =
  "A private, phone-verified list for buyers who have not chosen an agent yet.";

/** The share card for one community, from its public catalog entry only. */
export function dealsCommunityShareCard(community: { label: string; area: string; fromPriceLabel?: string | null; homesAvailable: number; schoolDistrict?: string | null; redHotDeals?: number }): { title: string; description: string } {
  const homes = community.homesAvailable > 0 ? `${community.homesAvailable} move-in ready home${community.homesAvailable === 1 ? "" : "s"}` : "New homes to build";
  const parts = [community.fromPriceLabel ? `${homes} ${community.fromPriceLabel.replace(/^From/, "from")}` : homes, community.schoolDistrict ?? null, community.redHotDeals ? `${community.redHotDeals} Red Hot Deal${community.redHotDeals === 1 ? "" : "s"}` : null].filter(Boolean);
  return { title: community.label, description: `${parts.join(" · ")}. Photos, prices and this week's builder incentive, before you pick an agent.` };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Origin of a full URL, used to make relative image paths absolute for crawlers. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** Builder Deals is intentionally telemetry-free, including host-injected Umami markup. */
function stripDealsTelemetry(html: string) {
  return html.replace(/\s*<script\b[^>]*\bsrc=["'][^"']*\/umami[^"']*["'][\s\S]*?<\/script>/gi, "");
}

export function buildTags(opts: {
  title: string;
  description: string;
  url: string;
  /** Site-relative image path. Defaults to the Convince letter card. */
  image?: string;
  /** The static cards are 1200x630; a photo of unknown size declares none (crawlers must not be lied to). */
  imageSize?: { width: number; height: number } | null;
}): string {
  const t = escapeHtml(opts.title);
  const d = escapeHtml(opts.description);
  const u = escapeHtml(opts.url);
  const img = escapeHtml(`${originOf(opts.url)}${opts.image ?? OG_IMAGE}`);
  const size = opts.imageSize === undefined ? { width: 1200, height: 630 } : opts.imageSize;
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Lifestyle Design Realty" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:image" content="${img}" />`,
    ...(size ? [`<meta property="og:image:width" content="${size.width}" />`, `<meta property="og:image:height" content="${size.height}" />`] : []),
    `<meta property="og:url" content="${u}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${img}" />`,
  ].join("\n    ");
}

/**
 * Express middleware that rewrites the HTML response for shareable result
 * pages (/convince and /city-finder, including their :slug variants) to
 * include Open Graph meta tags. Crawlers (iMessage, WhatsApp, Facebook,
 * Twitter) don't execute JS, so tags must be present in the HTML itself.
 * A /city-finder/:slug card uses the same vibe-matched city image the result
 * page renders, so the shared preview matches what the recipient will see.
 * Works in both dev (Vite transform) and production (static serve) because it
 * intercepts res.send/res.sendFile output for matching routes.
 */
export function registerOgMeta(app: Express) {
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const isConvince = req.path.startsWith("/convince");
    const isCityFinder = req.path.startsWith("/city-finder");
    const isJoin = req.path === "/join" || req.path === "/join/";
    const isDealsLanding = req.path === "/deals" || req.path === "/deals/";
    const isDealsPrivateDocument = req.path.startsWith("/deals/") && !req.path.startsWith("/deals/v/") && !req.path.startsWith("/deals/auth/");
    // Personal Deals routes deliberately have no OG preview. A pasted private
    // token or /mine URL must reveal nothing useful to a crawler.
    if (!isConvince && !isCityFinder && !isJoin && !isDealsLanding && !isDealsPrivateDocument) return next();
    // Only intercept HTML document requests, not assets/api
    const accepts = req.headers.accept || "";
    if (!accepts.includes("text/html") && accepts !== "*/*" && accepts !== "") return next();

    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";
    const fullUrl = `${proto}://${host}${req.originalUrl}`;

    let title = "A letter written for you about your life in Texas";
    let description =
      "Someone wants to move to Texas with you — and asked us to make the case. Read the letter Lifestyle Design Realty wrote about the life waiting for you here.";
    let image: string | undefined;
    let imageSize: { width: number; height: number } | null | undefined;

    // Recruiting card: canonicalised to the non-trailing-slash /join URL so
    // every share of the page collapses onto one preview.
    if (isJoin) {
      title = JOIN_OG_TITLE;
      description = JOIN_OG_DESCRIPTION;
      image = JOIN_OG_IMAGE;
    }

    // A shared community link (/deals?k=<key>, Oct 26, 2026; ?c= is an agent's private client link and gets no card): the card shows that community's public label, price
    // band and cover, so the spouse it was sent to sees the home, not the generic card. Only public catalog fields are
    // used: the key is opaque and nothing names the builder, the community or an address.
    const sharedKey = typeof req.query.k === "string" && /^[a-f0-9]{12}$/i.test(req.query.k) ? req.query.k.toLowerCase() : null;
    if (isDealsLanding) {
      title = DEALS_OG_TITLE;
      description = DEALS_OG_DESCRIPTION;
      image = DEALS_OG_IMAGE;
      if (sharedKey) {
        try {
          const { cachedPublicCatalog } = await import("./dealsRouter");
          const community = (await cachedPublicCatalog()).find((entry) => entry.key === sharedKey);
          if (community) {
            const card = dealsCommunityShareCard(community);
            title = card.title;
            description = card.description;
            if (community.cover) { image = community.cover; imageSize = null; }
          }
        } catch {
          // The generic Builder Deals card stands in; never break page delivery over a preview.
        }
      }
    }

    const cityFinderSlug = req.path.match(/^\/city-finder\/([A-Za-z0-9_-]+)$/);
    if (isCityFinder) {
      title = "Find Your Texas City — Lifestyle Design Realty";
      description =
        "Answer a few questions about your budget, lifestyle, and timeline, and we'll match you with the Texas cities that fit you best.";
      if (cityFinderSlug) {
        try {
          const match = await getCityMatchBySlug(cityFinderSlug[1]);
          if (match) {
            const ranked = JSON.parse(match.rankedCities) as string[];
            const answers = JSON.parse(match.answers) as Record<string, string>;
            const top = ranked[0];
            if (top) {
              title = `My Texas city match: ${top}`;
              const runnersUp = ranked.slice(1, 3).join(" and ");
              description = runnersUp
                ? `${top} came out on top, ahead of ${runnersUp} — see the full match report from Lifestyle Design Realty.`
                : `${top} came out on top — see the full match report from Lifestyle Design Realty.`;
              // Same vibe-matched art the result card shows.
              image = selectCityImage(top, answers).src;
            }
          }
        } catch {
          // fall back to the generic City Finder card — never break delivery
        }
      }
    }

    const slugMatch = req.path.match(/^\/convince\/([A-Za-z0-9_-]+)$/);
    if (slugMatch) {
      try {
        const pitch = await getPartnerPitchBySlug(slugMatch[1]);
        if (pitch) {
          title = pitch.partnerName
            ? `A letter written for ${pitch.partnerName} about life in ${pitch.city}, Texas`
            : `A letter written for you about life in ${pitch.city}, Texas`;
          const preview = pitch.pitch.slice(0, 150).replace(/\s+\S*$/, "");
          description = `${preview}…`;
        }
      } catch {
        // fall back to defaults — never break page delivery over OG tags
      }
    } else if (req.path === "/convince") {
      title = "Convince Your Partner — Moving to Texas, Together";
      description =
        "Want to move to Texas but need help convincing your partner? Take the 60-second quiz and we'll write the case for you.";
    }

    const canonicalUrl = isJoin
      ? `${proto}://${host}/join`
      : isDealsLanding
        ? `${proto}://${host}/deals${sharedKey ? `?k=${sharedKey}` : ""}`
      : fullUrl;

    const robots = (isDealsLanding || isDealsPrivateDocument) ? `<meta name="robots" content="noindex, nofollow" />` : "";
    const tags = `${robots}${isDealsLanding || !isDealsPrivateDocument ? `${robots ? "\n    " : ""}${buildTags({ title, description, url: canonicalUrl, image, imageSize })}` : ""}`;

    // Monkey-patch send to inject tags into the outgoing HTML
    const originalSend = res.send.bind(res);
    res.send = ((body: unknown) => {
      if (typeof body === "string" && body.includes("<!--og-meta-->")) {
        if (isDealsLanding || isDealsPrivateDocument) body = stripDealsTelemetry(body as string);
        body = (body as string).replace("<!--og-meta-->", tags);
      }
      return originalSend(body as never);
    }) as typeof res.send;

    // Dev Vite path delivers HTML via res.end(page) — intercept it too
    const originalEnd = res.end.bind(res);
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string" && chunk.includes("<!--og-meta-->")) {
        if (isDealsLanding || isDealsPrivateDocument) chunk = stripDealsTelemetry(chunk as string);
        chunk = (chunk as string).replace("<!--og-meta-->", tags);
      }
      return (originalEnd as (...args: unknown[]) => Response)(chunk, ...rest);
    }) as typeof res.end;

    // sendFile (production static) bypasses send — read & transform instead
    const originalSendFile = res.sendFile.bind(res) as (path: string, ...rest: unknown[]) => void;
    res.sendFile = ((filePath: string, ...rest: unknown[]) => {
      import("fs").then((fs) => {
        fs.promises
          .readFile(filePath, "utf-8")
          .then((html) => {
            if (html.includes("<!--og-meta-->")) {
              const safeHtml = isDealsLanding || isDealsPrivateDocument ? stripDealsTelemetry(html) : html;
              res.type("html").send(safeHtml.replace("<!--og-meta-->", tags));
            } else {
              originalSendFile(filePath, ...rest);
            }
          })
          .catch(() => originalSendFile(filePath, ...rest));
      });
    }) as typeof res.sendFile;

    next();
  });
}
