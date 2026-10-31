/**
 * A community's video can be an Instagram reel or a YouTube Short (or any
 * YouTube video). YouTube links play in a privacy-enhanced (youtube-nocookie)
 * player; everything else goes through the Instagram embed.
 */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The video id of a YouTube Shorts, watch, youtu.be, embed or live link; null for any other link. */
export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const [, first = "", second = ""] = parsed.pathname.split("/");
  let id: string | null = null;
  if (host === "youtu.be") id = first;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (first === "shorts" || first === "embed" || first === "live") id = second;
    else if (first === "watch") id = parsed.searchParams.get("v");
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** The embed address: no related videos from other channels, inline on phones, autoplay only after a tap. */
export function youtubeEmbedUrl(id: string, autoplay: boolean): string {
  const params = new URLSearchParams({ rel: "0", playsinline: "1", modestbranding: "1", autoplay: autoplay ? "1" : "0" });
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,40}$/;

/**
 * The embed page of an Instagram reel or post link ("/reel/CODE", "/reels/CODE", "/p/CODE", "/tv/CODE", with or
 * without the account name in front); null for any other link.
 */
export function instagramEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!/^((www|m)\.)?instagram\.com$/i.test(parsed.hostname)) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const at = parts.findIndex((part) => ["reel", "reels", "p", "tv"].includes(part.toLowerCase()));
  const code = at >= 0 ? parts[at + 1] : undefined;
  if (!code || !INSTAGRAM_CODE.test(code)) return null;
  const kind = parts[at]!.toLowerCase() === "reels" ? "reel" : parts[at]!.toLowerCase();
  return `https://www.instagram.com/${kind}/${code}/embed/`;
}

/**
 * Oct 30, 2026 (Peter: "remove the black stuff so the video looks clean"): Instagram's embed page shows a reel inside a
 * 4:5 box under a 54px header, so a 9:16 reel gets black bars at both sides. The embed is drawn wider than its frame
 * (100 / 70.3125 = 142.22% of it, the reel's share of the 4:5 box) and shifted so only the reel shows, edge to edge:
 * left by the left bar (14.84% of the box), up by the header. A couple of pixels of overscan hide the seams. Sizes are
 * in container units, so it holds at any frame width.
 */
export const REEL_CROP_STYLE = {
  top: "calc(-54px - 2px)",
  left: "calc(-21.1111cqw - 2px)",
  width: "calc(142.2222cqw + 4px)",
  height: "calc(177.7778cqw + 5px + 54px + 160px)",
} as const;
