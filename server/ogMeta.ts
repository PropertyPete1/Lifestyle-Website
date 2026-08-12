import type { Express, NextFunction, Request, Response } from "express";
import { getCityMatchBySlug, getPartnerPitchBySlug } from "./db";
import { selectCityImage } from "../shared/cityImagery";

const OG_IMAGE = "/manus-storage/convince-og-card_a3d08b2e.png";

/**
 * Recruiting-specific share card for /join. Shared links must sell the hiring
 * opportunity at a glance rather than the general brokerage homepage.
 */
export const JOIN_OG_IMAGE = "/manus-storage/join-og-card_7218d8c9.png";

export const JOIN_OG_TITLE = "Now Hiring: Licensed Agents — Lifestyle Design Realty";

export const JOIN_OG_DESCRIPTION =
  "Real leads. Real support. Lease commissions up to $6,000 per deal. Veteran-owned brokerage hiring in Austin, San Antonio, Dallas & Houston.";

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

export function buildTags(opts: {
  title: string;
  description: string;
  url: string;
  /** Site-relative image path. Defaults to the Convince letter card. */
  image?: string;
}): string {
  const t = escapeHtml(opts.title);
  const d = escapeHtml(opts.description);
  const u = escapeHtml(opts.url);
  const img = escapeHtml(`${originOf(opts.url)}${opts.image ?? OG_IMAGE}`);
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Lifestyle Design Realty" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
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
    if (!isConvince && !isCityFinder && !isJoin) return next();
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

    // Recruiting card: canonicalised to the non-trailing-slash /join URL so
    // every share of the page collapses onto one preview.
    if (isJoin) {
      title = JOIN_OG_TITLE;
      description = JOIN_OG_DESCRIPTION;
      image = JOIN_OG_IMAGE;
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
      : fullUrl;

    const tags = buildTags({ title, description, url: canonicalUrl, image });

    // Monkey-patch send to inject tags into the outgoing HTML
    const originalSend = res.send.bind(res);
    res.send = ((body: unknown) => {
      if (typeof body === "string" && body.includes("<!--og-meta-->")) {
        body = body.replace("<!--og-meta-->", tags);
      }
      return originalSend(body as never);
    }) as typeof res.send;

    // Dev Vite path delivers HTML via res.end(page) — intercept it too
    const originalEnd = res.end.bind(res);
    res.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string" && chunk.includes("<!--og-meta-->")) {
        chunk = chunk.replace("<!--og-meta-->", tags);
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
              res.type("html").send(html.replace("<!--og-meta-->", tags));
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
