/**
 * Minimal scripted stand-in for the Drizzle MySQL client used by the Builder
 * Deals FUB/maintenance tests. Selects are answered per table from queued
 * result sets (FIFO, the last set is sticky); every write is recorded so a
 * test can assert exactly which rows changed. Not a test file itself.
 */
export type FakeDbWrite = { op: "insert" | "update" | "delete"; table: unknown; values?: unknown; set?: unknown; where?: unknown; onDuplicate?: unknown };
export type FakeDbSelect = { table: unknown; fields?: unknown; where?: unknown; limit?: number };

export type FakeDealsDb = {
  select: (fields?: unknown) => unknown;
  selectDistinct: (fields?: unknown) => unknown;
  insert: (table: unknown) => unknown;
  update: (table: unknown) => unknown;
  delete: (table: unknown) => unknown;
  transaction: <T>(work: (tx: FakeDealsDb) => Promise<T>) => Promise<T>;
  writes: FakeDbWrite[];
  selects: FakeDbSelect[];
  /** Queue another result set for a table after construction. */
  queue: (table: unknown, rows: unknown[]) => void;
};

type Thenable<T> = { then: Promise<T>["then"]; catch: Promise<T>["catch"]; finally: Promise<T>["finally"] };
function thenable<T>(resolve: () => T): Thenable<T> {
  const promise = new Promise<T>((done, fail) => { try { done(resolve()); } catch (error) { fail(error); } });
  return { then: promise.then.bind(promise), catch: promise.catch.bind(promise), finally: promise.finally.bind(promise) };
}

export function createFakeDealsDb(seed: Array<[table: unknown, rows: unknown[]]> = [], options: { insertId?: number; affectedRows?: number } = {}): FakeDealsDb {
  const queues = new Map<unknown, unknown[][]>();
  for (const [table, rows] of seed) queues.set(table, [...(queues.get(table) ?? []), rows]);
  const writes: FakeDbWrite[] = [];
  const selects: FakeDbSelect[] = [];
  let insertId = options.insertId ?? 1000;
  const affectedRows = options.affectedRows ?? 1;

  const rowsFor = (table: unknown) => {
    const queue = queues.get(table);
    if (!queue || !queue.length) return [] as unknown[];
    return queue.length > 1 ? queue.shift()! : queue[0]!;
  };

  const selectChain = (fields?: unknown) => {
    const record: FakeDbSelect = { table: undefined, fields };
    let rows: unknown[] = [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.from = (table: unknown) => { record.table = table; rows = rowsFor(table); selects.push(record); return chain; };
    chain.where = (where: unknown) => { record.where = where; return chain; };
    chain.limit = (limit: number) => { record.limit = limit; rows = rows.slice(0, limit); return chain; };
    for (const name of ["orderBy", "offset", "groupBy", "leftJoin", "innerJoin", "for"]) chain[name] = self;
    const resolved = () => rows;
    chain.then = (onFulfilled?: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve().then(resolved).then(onFulfilled, onRejected);
    chain.catch = (onRejected?: (reason: unknown) => unknown) => Promise.resolve().then(resolved).catch(onRejected);
    chain.finally = (onFinally?: () => void) => Promise.resolve().then(resolved).finally(onFinally);
    return chain;
  };

  const db: FakeDealsDb = {
    writes,
    selects,
    queue: (table, rows) => queues.set(table, [...(queues.get(table) ?? []), rows]),
    select: selectChain,
    selectDistinct: selectChain,
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const write: FakeDbWrite = { op: "insert", table, values };
        writes.push(write);
        insertId += 1;
        const result = () => [{ insertId, affectedRows }];
        return { ...thenable(result), onDuplicateKeyUpdate: (onDuplicate: unknown) => { write.onDuplicate = onDuplicate; return thenable(result); } };
      },
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => {
        const write: FakeDbWrite = { op: "update", table, set };
        writes.push(write);
        const result = () => [{ affectedRows }];
        return { ...thenable(result), where: (where: unknown) => { write.where = where; return thenable(result); } };
      },
    }),
    delete: (table: unknown) => {
      const write: FakeDbWrite = { op: "delete", table };
      writes.push(write);
      const result = () => [{ affectedRows }];
      return { ...thenable(result), where: (where: unknown) => { write.where = where; return thenable(result); } };
    },
    transaction: async (work) => work(db),
  };
  return db;
}

/** Response helper for mocked FUB/Resend/Twilio fetches. */
export function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
