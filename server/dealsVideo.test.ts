import { describe, expect, it } from "vitest";
import { youtubeEmbedUrl, youtubeVideoId } from "../client/src/lib/dealsVideo";

describe("community video links", () => {
  it("reads the video id from every common YouTube link shape", () => {
    expect(youtubeVideoId("https://youtube.com/shorts/1P43uC596Wc?si=Xc2k_g7b2y9kaWvU")).toBe("1P43uC596Wc");
    expect(youtubeVideoId("https://www.youtube.com/shorts/1P43uC596Wc")).toBe("1P43uC596Wc");
    expect(youtubeVideoId("https://m.youtube.com/watch?v=1P43uC596Wc&t=3")).toBe("1P43uC596Wc");
    expect(youtubeVideoId("https://youtu.be/1P43uC596Wc?si=abc")).toBe("1P43uC596Wc");
    expect(youtubeVideoId("https://www.youtube-nocookie.com/embed/1P43uC596Wc")).toBe("1P43uC596Wc");
    expect(youtubeVideoId("  https://youtube.com/live/1P43uC596Wc ")).toBe("1P43uC596Wc");
  });

  it("leaves Instagram reels, other hosts, bad ids and non-web links to the Instagram path", () => {
    expect(youtubeVideoId("https://www.instagram.com/reel/DepdmLHMLet/")).toBeNull();
    expect(youtubeVideoId("https://evil.example/shorts/1P43uC596Wc")).toBeNull();
    expect(youtubeVideoId("https://youtube.com.evil.example/shorts/1P43uC596Wc")).toBeNull();
    expect(youtubeVideoId("https://youtube.com/shorts/short")).toBeNull();
    expect(youtubeVideoId("https://youtube.com/shorts/1P43uC596Wc\"><script>")).toBeNull();
    expect(youtubeVideoId("javascript:alert(1)")).toBeNull();
    expect(youtubeVideoId("https://youtube.com/channel/UC123")).toBeNull();
    expect(youtubeVideoId(null)).toBeNull();
  });

  it("embeds through the no-cookie player, inline, without other channels' videos, autoplaying only after a tap", () => {
    expect(youtubeEmbedUrl("1P43uC596Wc", false)).toBe("https://www.youtube-nocookie.com/embed/1P43uC596Wc?rel=0&playsinline=1&modestbranding=1&autoplay=0");
    expect(youtubeEmbedUrl("1P43uC596Wc", true)).toContain("autoplay=1");
  });
});
