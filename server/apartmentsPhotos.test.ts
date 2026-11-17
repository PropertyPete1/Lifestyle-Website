import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aptPhotos, aptProperties } from "../drizzle/schema";
import { FakeDealsDb } from "./dealsSync.fakeDb";

/**
 * Apartment photos: every photo of a community is copied once into our storage, whole, and a renter is only ever
 * handed our copy (a link to the community's site would name it). Fixtures are invented.
 */
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { clientOption, publicResults } from "../shared/apartments";
import { AptPhotoError, cacheApartmentPhotos, downloadAptPhoto, isPrivateAddress, safeAptPhotoUrl, webSizedPhoto } from "./apartmentsPhotos";
import { importApartments, loadApartments, type AptPropertyInput } from "./apartmentsStore";

const TODAY = "2026-11-17";
const SITE = "https://www.fixtureflats.example/photos";
const flats: AptPropertyInput = {
  sourceKey: "manual:fixture-flats", name: "Fixture Flats", address: "100 Fixture Pkwy, San Antonio, TX 78216", city: "San Antonio", areaLabel: "North Central San Antonio",
  floorplans: [{ beds: 1, rentMin: 1_200 }],
  photos: [{ url: `${SITE}/front.jpg`, caption: "Fixture Flats entrance" }, { url: `${SITE}/pool.jpg`, caption: "Pool" }, { url: `${SITE}/kitchen.jpg` }, { url: `${SITE}/pool.jpg` }],
};
const picture = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 120, g: 150, b: 180 } } }).jpeg().toBuffer();

let db: FakeDealsDb;
beforeEach(() => { db = new FakeDealsDb(); mocks.getDb.mockResolvedValue(db); });
type PhotoRow = { id: number; sourceUrl: string; storedUrl: string | null; failedReason: string | null; sortOrder: number };
const rows = () => (db.rows(aptPhotos) as PhotoRow[]).slice().sort((a, b) => a.sortOrder - b.sortOrder);

describe("apartment photos", () => {
  it("keeps every photo in order, copies each once, and a re-import keeps the copies and the new order", async () => {
    await importApartments([flats]);
    expect(rows().map((row) => row.sourceUrl)).toEqual([`${SITE}/front.jpg`, `${SITE}/pool.jpg`, `${SITE}/kitchen.jpg`]);
    const stored: string[] = [];
    const result = await cacheApartmentPhotos({ download: async () => picture(3_000, 2_000), store: async (key) => { stored.push(key); return `https://files.example/${key}`; } });
    expect(result).toEqual({ stored: 3, failed: 0, remaining: 0 });
    // The storage key is the picture's fingerprint: nothing in it names the community.
    expect(stored.every((key) => /^apartments\/[a-f0-9]{32}\.webp$/.test(key))).toBe(true);
    // Nothing left to copy on a second run.
    expect(await cacheApartmentPhotos({ download: async () => { throw new Error("no download expected"); }, store: async () => "x" })).toEqual({ stored: 0, failed: 0, remaining: 0 });
    const before = rows().map((row) => row.storedUrl);
    await importApartments([{ ...flats, photos: [{ url: `${SITE}/kitchen.jpg` }, { url: `${SITE}/front.jpg` }, { url: `${SITE}/gym.jpg` }] }]);
    expect(rows().map((row) => [row.sourceUrl.split("/").pop(), Boolean(row.storedUrl)])).toEqual([["kitchen.jpg", true], ["front.jpg", true], ["gym.jpg", false]]);
    expect(rows()[1]!.storedUrl).toBe(before[0]);
    // An import that says nothing about photos leaves them alone.
    await importApartments([{ sourceKey: flats.sourceKey, name: flats.name, address: flats.address, city: flats.city, areaLabel: flats.areaLabel }]);
    expect(rows()).toHaveLength(3);
  });

  it("a renter gets only our copies with the name scrubbed from captions; the client's list gets every photo", async () => {
    await importApartments([flats]);
    await cacheApartmentPhotos({ limit: 2, download: async () => picture(800, 600), store: async (key) => `https://files.example/${key}` });
    const [property] = await loadApartments();
    expect(property!.photos.map((photo) => photo.stored)).toEqual([true, true, false]);
    const [renter] = publicResults([property!], {}, TODAY);
    expect(renter!.photos).toHaveLength(2);
    expect(renter!.photos[0]).toMatchObject({ caption: "this community entrance" });
    expect(JSON.stringify(renter)).not.toMatch(/fixtureflats|Fixture Flats/);
    expect(clientOption(property!, TODAY).photos).toHaveLength(3);
  });

  it("a photo that cannot be copied is marked and skipped, the others still copy, and it is not shown or retried", async () => {
    await importApartments([flats]);
    const result = await cacheApartmentPhotos({ download: async (url) => { if (url.endsWith("pool.jpg")) throw new AptPhotoError("gone"); if (url.endsWith("kitchen.jpg")) return Buffer.from("<html>not a picture</html>"); return picture(640, 480); }, store: async (key) => `https://files.example/${key}` });
    expect(result).toEqual({ stored: 1, failed: 2, remaining: 0 });
    expect(rows().map((row) => row.failedReason)).toEqual([null, "gone", "not_an_image"]);
    expect((await loadApartments())[0]!.photos).toHaveLength(1);
    expect((db.rows(aptProperties) as unknown[]).length).toBe(1);
  });

  it("the whole photo is kept: resized to fit, never cropped or enlarged", async () => {
    const wide = await sharp(await webSizedPhoto(await picture(3_600, 1_200))).metadata();
    expect([wide.width, wide.height, wide.format]).toEqual([1_800, 600, "webp"]);
    const small = await sharp(await webSizedPhoto(await picture(640, 480))).metadata();
    expect([small.width, small.height]).toEqual([640, 480]);
    await expect(webSizedPhoto(Buffer.from("nope"))).rejects.toMatchObject({ reason: "not_an_image" });
  });

  it("only fetches real https sites: no private addresses, sign-in links, ports or redirects into a private network", async () => {
    for (const bad of ["http://www.fixtureflats.example/a.jpg", "https://user:pw@www.fixtureflats.example/a.jpg", "https://www.fixtureflats.example:8443/a.jpg", "https://127.0.0.1/a.jpg", "https://localhost/a.jpg", "https://intranet/a.jpg", "https://files.internal/a.jpg", "not a link"]) expect(() => safeAptPhotoUrl(bad), bad).toThrow(AptPhotoError);
    expect(["10.0.0.5", "192.168.1.1", "172.20.0.1", "169.254.169.254", "127.0.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"].every(isPrivateAddress)).toBe(true);
    expect(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"].some(isPrivateAddress)).toBe(false);
    const never = vi.fn();
    await expect(downloadAptPhoto("https://www.fixtureflats.example/a.jpg", never as unknown as typeof fetch, async () => ["10.0.0.5"])).rejects.toMatchObject({ reason: "private_address" });
    expect(never).not.toHaveBeenCalled();
    // A public host that redirects to a private one is stopped at the second hop.
    const redirecting = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://metadata.fixtureflats.example/secret" } }));
    await expect(downloadAptPhoto("https://www.fixtureflats.example/a.jpg", redirecting as unknown as typeof fetch, async (host) => host.startsWith("metadata.") ? ["169.254.169.254"] : ["93.184.216.34"])).rejects.toMatchObject({ reason: "private_address" });
    expect(redirecting).toHaveBeenCalledTimes(1);
    const html = async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(downloadAptPhoto("https://www.fixtureflats.example/a.jpg", html as unknown as typeof fetch, async () => ["93.184.216.34"])).rejects.toMatchObject({ reason: "not_an_image" });
    const ok = async () => new Response(await picture(10, 10), { status: 200, headers: { "content-type": "image/jpeg" } });
    expect((await downloadAptPhoto("https://www.fixtureflats.example/a.jpg", ok as unknown as typeof fetch, async () => ["93.184.216.34"])).length).toBeGreaterThan(100);
  });
});
