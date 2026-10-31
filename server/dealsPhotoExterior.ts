import sharp from "sharp";
import { and, asc, eq, inArray } from "drizzle-orm";
import { dealPhotos } from "../drizzle/schema";
import { getDb } from "./db";
import { storageReadPrivate } from "./storage";

/**
 * Oct 30, 2026 (Peter: "the featured homes are just the inside of the home"): a Best Deals cover is the home's
 * outside. Builders' galleries often lead with the kitchen; the outside is the photo with sky across the top and
 * grass along the bottom, which a kitchen, bedroom or bath never has. Measured on the live featured homes: every
 * outside shot scored 0.73 or more (sky 0.44 to 0.76, grass 0.29 to 0.47), every inside shot 0.03 or less.
 */
export const EXTERIOR_MIN_SCORE = 0.25;
/** Photos looked at per home, in gallery order; the outside is almost always among the first few. */
export const EXTERIOR_PHOTOS_PER_HOME = 12;

const SAMPLE_WIDTH = 48;
const SAMPLE_HEIGHT = 32;

/** Hue (0-360), saturation and value (0-1) of one pixel. */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255, green = g / 255, blue = b / 255;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return [hue, max === 0 ? 0 : delta / max, max];
}

/**
 * How much the picture looks like the outside of a house, from a small RGB sample: the share of sky-blue pixels in the
 * top third plus the share of green pixels in the bottom two-fifths.
 */
export function exteriorScoreFromPixels(data: Uint8Array, width: number, height: number, channels: number): number {
  let sky = 0, skyCount = 0, grass = 0, grassCount = 0;
  for (let y = 0; y < height; y++) {
    const top = y < height * 0.35;
    const bottom = y >= height * 0.6;
    if (!top && !bottom) continue;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * channels;
      const [hue, saturation, value] = hsv(data[at]!, data[at + 1]!, data[at + 2]!);
      if (top) {
        skyCount++;
        if (hue >= 185 && hue <= 255 && saturation >= 0.12 && value >= 0.4) sky++;
      } else {
        grassCount++;
        if (hue >= 65 && hue <= 160 && saturation >= 0.18 && value >= 0.15) grass++;
      }
    }
  }
  return (skyCount ? sky / skyCount : 0) + (grassCount ? grass / grassCount : 0);
}

export async function exteriorScore(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image, { animated: false, limitInputPixels: 80_000_000 })
    .resize(SAMPLE_WIDTH, SAMPLE_HEIGHT, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return exteriorScoreFromPixels(data, info.width, info.height, info.channels);
}

/** Scores by the master's version, so a photo is measured once per process (a few bytes each). */
const scores = new Map<string, number>();
const SCORE_CACHE_MAX = 20_000;

export function resetExteriorScores() { scores.clear(); }

type PhotoRow = { id: number; homeId: number | null; processedStorageKey: string | null; processedVersion: string | null };
type Reader = (key: string) => Promise<Buffer>;

async function scoreOf(row: PhotoRow, read: Reader): Promise<number | null> {
  if (!row.processedStorageKey || !row.processedVersion) return null;
  const known = scores.get(row.processedVersion);
  if (known !== undefined) return known;
  try {
    const score = await exteriorScore(await read(row.processedStorageKey));
    if (scores.size >= SCORE_CACHE_MAX) scores.delete(scores.keys().next().value as string);
    scores.set(row.processedVersion, score);
    return score;
  } catch {
    // Unreadable now (storage hiccup, broken master): not counted as an outside shot, and not remembered.
    return null;
  }
}

/**
 * The first outside shot in a home's gallery order (its photo id); null when the home has no outside shot (its photos
 * are all inside, or it has no shown photo at all: Peter, Oct 30, "need a front home photo or don't feature them");
 * undefined only when its photos could not be read just now, so a storage hiccup never empties the row.
 */
export async function firstExteriorPhoto(rows: readonly PhotoRow[], read: Reader): Promise<number | null | undefined> {
  if (!rows.length) return null;
  let judged = 0;
  for (const row of rows.slice(0, EXTERIOR_PHOTOS_PER_HOME)) {
    const score = await scoreOf(row, read);
    if (score === null) continue;
    judged++;
    if (score >= EXTERIOR_MIN_SCORE) return row.id;
  }
  return judged ? null : undefined;
}

const defaultReader: Reader = async (key) => (await storageReadPrivate(key)).data;

/**
 * Oct 30, 2026 (ChatGPT: a featured home's sheet opened on a bathroom sink, 1 of 15): a home's photos with its outside
 * shot first, the same one firstExteriorPhoto picks. Only scores already measured count; nothing is read here, so a
 * page of homes costs nothing extra. Homes never measured keep their gallery order.
 */
export function exteriorFirst<T extends { processedVersion: string | null }>(rows: readonly T[]): T[] {
  const index = rows.slice(0, EXTERIOR_PHOTOS_PER_HOME).findIndex((row) => {
    const score = row.processedVersion ? scores.get(row.processedVersion) : undefined;
    return score !== undefined && score >= EXTERIOR_MIN_SCORE;
  });
  if (index <= 0) return rows.slice();
  return [rows[index]!, ...rows.slice(0, index), ...rows.slice(index + 1)];
}

/**
 * Each home's outside cover (see firstExteriorPhoto: a photo id, null for none, undefined for unknown). Only shown,
 * processed photos count, in the gallery's own order. Homes are looked at four at a time.
 */
export async function exteriorCovers(homeIds: readonly number[], read: Reader = defaultReader): Promise<Map<number, number | null | undefined>> {
  const out = new Map<number, number | null | undefined>();
  const ids = Array.from(new Set(homeIds));
  if (!ids.length) return out;
  const db = await getDb();
  if (!db) return out;
  const rows = await db.select({ id: dealPhotos.id, homeId: dealPhotos.homeId, processedStorageKey: dealPhotos.processedStorageKey, processedVersion: dealPhotos.processedVersion })
    .from(dealPhotos)
    .where(and(inArray(dealPhotos.homeId, ids), eq(dealPhotos.processingState, "processed"), eq(dealPhotos.automaticHidden, false), eq(dealPhotos.adminHidden, false)))
    .orderBy(asc(dealPhotos.sortOrder), asc(dealPhotos.id));
  const byHome = new Map<number, PhotoRow[]>();
  for (const row of rows) {
    if (row.homeId === null) continue;
    const list = byHome.get(row.homeId);
    if (list) list.push(row); else byHome.set(row.homeId, [row]);
  }
  for (let index = 0; index < ids.length; index += 4) {
    await Promise.all(ids.slice(index, index + 4).map(async (homeId) => { out.set(homeId, await firstExteriorPhoto(byHome.get(homeId) ?? [], read)); }));
  }
  return out;
}
