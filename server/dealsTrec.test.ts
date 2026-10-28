import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: (...args: unknown[]) => mocks.getDb(...args) }));

import { dealTrecFakeRows, dealTrecImports, dealTrecLicenses } from "../drizzle/schema";
import { createFakeDealsDb } from "./dealsFubFakeDb.test-support";
import { addTrecFakeRow, importTrecLicenses, lookupTrecName, trecLicenseValues, trecNameParts } from "./dealsTrec";

const HEADER = "license_type,license_number,full_name,status,county,first_name,last_name\n";
const ROWS = [
  "Sales Agent,100001,PATRICIA LEIGH BABB ERWIN,Active,BEXAR,PATRICIA,BABB ERWIN\n",
  "Broker Individual,100002,\"SMITH, JR., JOHN\",Active,TRAVIS,JOHN,\"SMITH, JR.\"\n",
  "Sales Agent,100003,MARIA LOPEZ,Expired less than 6 months,COMAL,MARIA,LOPEZ\n",
  "Broker Company,100004,ACME REALTY LLC,Active,BEXAR,,\n",
  "Sales Agent,100005,ANN LEE,Inactive,HAYS,ANN,LEE\n",
];
const encoder = new TextEncoder();

/** Mocks the TREC download: the body stream honors the request signal exactly like a real fetch body. */
function mockTrecDownload(options: { chunks: string[]; gapMs: number; stall?: boolean; delayHeadersForever?: boolean }) {
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
    const signal = init?.signal ?? undefined;
    if (options.delayHeadersForever) return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted"))));
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { signal?.addEventListener("abort", () => { try { controller.error(signal.reason ?? new Error("aborted")); } catch { /* already closed */ } }); },
      pull(controller) {
        return new Promise<void>((resolve) => {
          if (index >= options.chunks.length) {
            if (options.stall) return; // never closes: a stalled download
            controller.close();
            return resolve();
          }
          const chunk = options.chunks[index++]!;
          setTimeout(() => { if (!signal?.aborted) controller.enqueue(encoder.encode(chunk)); resolve(); }, options.gapMs);
        });
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, headers: { etag: "etag-1", "content-type": "text/csv" } }));
  });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("TREC name normalization", () => {
  it("ignores punctuation, middle names and suffixes when splitting a name", () => {
    expect(trecNameParts("Smith, Jr.")).toEqual(["SMITH"]);
    expect(trecNameParts("John Q. Public, III")).toEqual(["JOHN", "Q", "PUBLIC"]);
    const parts = trecNameParts("Patricia Leigh Babb Erwin");
    expect(parts[0]).toBe("PATRICIA");
    expect(parts.at(-1)).toBe("ERWIN");
  });

  it("stores the file's first and last names without punctuation so SQL matching sees clean tokens", () => {
    expect(trecLicenseValues(1, { full_name: "SMITH, JR., JOHN", first_name: "JOHN", last_name: "SMITH, JR.", license_type: "Broker Individual", status: "Active", county: "Travis" })).toMatchObject({ firstName: "JOHN", lastName: "SMITH", county: "TRAVIS", fullName: "SMITH, JR., JOHN" });
    expect(trecLicenseValues(1, { full_name: "PATRICIA LEIGH BABB ERWIN", first_name: "PATRICIA", last_name: "BABB ERWIN" })).toMatchObject({ firstName: "PATRICIA", lastName: "BABB ERWIN" });
    expect(trecLicenseValues(1, { full_name: "MARY ANN SMITH" })).toMatchObject({ firstName: "MARY", lastName: "SMITH" });
    expect(trecLicenseValues(1, { full_name: "" })).toBeNull();
  });
});

describe("TREC fake test row", () => {
  it("can be inserted and matched on the deployed production site, and still demands a TEST-prefixed first and last name", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const db = createFakeDealsDb([[dealTrecImports, []], [dealTrecFakeRows, [{ id: 3, fullName: "TEST JANE BUYER", createdAt: new Date() }]]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(addTrecFakeRow("test Jane Buyer")).resolves.toEqual({ ok: true, fullName: "TEST JANE BUYER" });
    expect(db.writes).toEqual([expect.objectContaining({ op: "insert", table: dealTrecFakeRows, values: { fullName: "TEST JANE BUYER" } })]);
    await expect(addTrecFakeRow("Jane Buyer")).rejects.toThrow(/TEST first-and-last-name/);
    await expect(addTrecFakeRow("TEST Jane")).rejects.toThrow(/TEST first-and-last-name/);

    const matches = await lookupTrecName("Test Jane Buyer.", ["Bexar"]);
    expect(matches).toEqual([expect.objectContaining({ isFake: true, licenseType: "Test Sales Agent", status: "Active (test)" })]);
  });
});

describe("TREC CSV import streaming", () => {
  it("applies the timeout to the headers only: a slow but active stream longer than the header window still completes", async () => {
    mockTrecDownload({ chunks: [HEADER, ...ROWS], gapMs: 25 });
    const db = createFakeDealsDb([[dealTrecImports, []]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(importTrecLicenses({ headersTimeoutMs: 40, readInactivityMs: 2_000 })).resolves.toMatchObject({ ok: true, rows: 5 });
    const licenseInserts = db.writes.filter((write) => write.op === "insert" && write.table === dealTrecLicenses);
    expect(licenseInserts).toHaveLength(1);
    const rows = licenseInserts[0]!.values as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ fullName: "PATRICIA LEIGH BABB ERWIN", firstName: "PATRICIA", lastName: "BABB ERWIN", status: "Active", county: "BEXAR" });
    expect(rows[1]).toMatchObject({ firstName: "JOHN", lastName: "SMITH" });
    expect(db.writes.some((write) => write.op === "update" && write.table === dealTrecImports && (write.set as { current?: boolean }).current === true)).toBe(true);
    expect(db.writes.filter((write) => write.op === "delete")).toHaveLength(0);
  });

  it("skips a row the database refuses and keeps the rest of its batch, judging each batch on its own (Oct 28)", async () => {
    mockTrecDownload({ chunks: [HEADER, ...ROWS], gapMs: 1 });
    const db = createFakeDealsDb([[dealTrecImports, []]]);
    const insert = db.insert.bind(db);
    // The database refuses one row: a batch holding it fails, and so does that row alone.
    (db as unknown as { insert: typeof db.insert }).insert = ((table: unknown) => {
      const builder = insert(table as never);
      if (table !== dealTrecLicenses) return builder;
      return { values: (values: unknown) => {
        const list = Array.isArray(values) ? values : [values];
        if (list.some((row) => (row as { fullName?: string }).fullName === "MARIA LOPEZ")) return Promise.reject(Object.assign(new Error("Failed query: insert into deal_trec_licenses"), { cause: new Error("Data too long for column 'county' at row 3") }));
        return builder.values(values as never);
      } };
    }) as typeof db.insert;
    mocks.getDb.mockResolvedValue(db);
    await expect(importTrecLicenses({ headersTimeoutMs: 2_000, readInactivityMs: 2_000 })).resolves.toMatchObject({ ok: true, rows: 4, skipped: 1, firstSkip: "Data too long for column 'county' at row 3" });
  });

  it("aborts a download whose body stops delivering bytes and removes the partial import", async () => {
    mockTrecDownload({ chunks: [HEADER, ROWS[0]!], gapMs: 5, stall: true });
    const db = createFakeDealsDb([[dealTrecImports, []]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(importTrecLicenses({ headersTimeoutMs: 2_000, readInactivityMs: 60 })).rejects.toThrow();
    expect(db.writes.filter((write) => write.op === "delete").map((write) => write.table)).toEqual([dealTrecLicenses, dealTrecImports]);
    expect(db.writes.some((write) => write.op === "update" && write.table === dealTrecImports)).toBe(false);
  });

  it("gives up when the headers never arrive", async () => {
    mockTrecDownload({ chunks: [], gapMs: 0, delayHeadersForever: true });
    const db = createFakeDealsDb([[dealTrecImports, []]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(importTrecLicenses({ headersTimeoutMs: 30, readInactivityMs: 2_000 })).rejects.toThrow(/headers timed out/);
    expect(db.writes).toHaveLength(0);
  });
});
