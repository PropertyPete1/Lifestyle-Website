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
