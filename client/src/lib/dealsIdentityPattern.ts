import type { CSSProperties } from "react";

/**
 * The gated page background repeats the lead's own identity as a faint CSS
 * pattern, the same text the server burns into every photo. It is built in the
 * browser from the display identity the session already returned, as an inline
 * SVG data URI, so no request carries the identity anywhere.
 */
export const IDENTITY_PATTERN_OPACITY = 0.04;
const MAX_DISPLAY_LENGTH = 60;
const FONT_SIZE = 15;

export function identityPatternText(display: string): string {
  const trimmed = display.trim().replace(/\s+/g, " ").slice(0, MAX_DISPLAY_LENGTH);
  return `Prepared for ${trimmed || "you"} | Lifestyle Design Realty`;
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

/** One repeatable tile: two staggered rows so no blank diagonal survives the repeat. */
export function identityPatternSvg(display: string): string {
  const text = escapeXml(identityPatternText(display));
  const width = Math.max(360, Math.round(identityPatternText(display).length * FONT_SIZE * 0.58) + 48);
  const height = 150;
  const half = Math.round(width / 2);
  const rows = [
    `<text x="0" y="48">${text}</text>`,
    `<text x="${half}" y="118">${text}</text>`,
    `<text x="${half - width}" y="118">${text}</text>`,
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="#f3e5c4" fill-opacity="${IDENTITY_PATTERN_OPACITY}" font-family="Georgia, 'Times New Roman', serif" font-size="${FONT_SIZE}" font-style="italic">${rows}</g></svg>`;
}

export function identityPatternDataUri(display: string): string {
  return `data:image/svg+xml,${encodeURIComponent(identityPatternSvg(display))}`;
}

export function identityPatternStyle(display: string): CSSProperties {
  return { backgroundImage: `url("${identityPatternDataUri(display)}")`, backgroundRepeat: "repeat", backgroundAttachment: "scroll" };
}
