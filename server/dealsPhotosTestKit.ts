/**
 * Test-only fake of the drizzle query chain used by the Builder Deals photo
 * modules. It records every operation (table, set/values payload, where SQL)
 * and answers selects from per-table handlers, so pipeline tests can assert
 * behaviour at the database boundary without a MySQL instance.
 */
import { sql, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

export type FakeOpKind = "select" | "selectDistinct" | "update" | "insert" | "delete";
export type FakeOp = {
  kind: FakeOpKind;
  table?: unknown;
  fields?: unknown;
  set?: Record<string, unknown>;
  values?: Record<string, unknown>;
  where?: unknown;
  joins: Array<{ table: unknown; on: unknown }>;
  limit?: number;
  orderBy?: unknown[];
};
export type SelectHandler = (op: FakeOp) => unknown[];

const dialect = new MySqlDialect();

/** Renders a captured order-by list (one SQL fragment per key). */
export function renderOrderBy(orderBy: unknown[] | undefined): string[] {
  return (orderBy ?? []).map((part) => dialect.sqlToQuery(sql`${part}`).sql);
}

/** Renders a captured where clause so tests can check which predicates and params were sent. */
export function renderWhere(where: unknown): { sql: string; params: unknown[] } {
  if (!where) return { sql: "", params: [] };
  const query = dialect.sqlToQuery(where as SQL);
  return { sql: query.sql, params: query.params };
}

export function createFakeDb() {
  const ops: FakeOp[] = [];
  const selectHandlers = new Map<unknown, SelectHandler[]>();
  let updateResult: (op: FakeOp) => unknown = () => [{ affectedRows: 1 }];
  let insertResult: (op: FakeOp) => unknown = () => [{ insertId: 1, affectedRows: 1 }];
  let deleteResult: (op: FakeOp) => unknown = () => [{ affectedRows: 1 }];

  function resolve(op: FakeOp): unknown {
    if (op.kind === "select" || op.kind === "selectDistinct") {
      const queue = selectHandlers.get(op.table);
      if (!queue?.length) return [];
      const handler = queue.length > 1 ? (queue.shift() as SelectHandler) : queue[0];
      return handler(op);
    }
    if (op.kind === "update") return updateResult(op);
    if (op.kind === "insert") return insertResult(op);
    return deleteResult(op);
  }

  function chain(op: FakeOp) {
    const self: Record<string, unknown> = {};
    const run = () => Promise.resolve().then(() => resolve(op));
    Object.assign(self, {
      from: (table: unknown) => { op.table = table; return self; },
      innerJoin: (table: unknown, on: unknown) => { op.joins.push({ table, on }); return self; },
      leftJoin: (table: unknown, on: unknown) => { op.joins.push({ table, on }); return self; },
      where: (where: unknown) => { op.where = where; return self; },
      limit: (limit: number) => { op.limit = limit; return self; },
      orderBy: (...args: unknown[]) => { op.orderBy = args; return self; },
      groupBy: () => self,
      set: (set: Record<string, unknown>) => { op.set = set; return self; },
      values: (values: Record<string, unknown>) => { op.values = values; return self; },
      onDuplicateKeyUpdate: () => self,
      getSQL: () => sql`(subquery)`,
      // A select turned into a derived table (`.as(alias)`) is never run on its own: drop it from the
      // recorded ops and hand back its selected fields as `alias`.`field` references.
      as: (alias: string) => {
        const index = ops.indexOf(op);
        if (index >= 0) ops.splice(index, 1);
        const fields = (op.fields ?? {}) as Record<string, unknown>;
        return Object.fromEntries(Object.keys(fields).map((key) => {
          const field = fields[key] as { fieldAlias?: string } | undefined;
          return [key, sql.raw(`\`${alias}\`.\`${field?.fieldAlias ?? key}\``)];
        }));
      },
      then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => run().then(onFulfilled, onRejected),
      catch: (onRejected?: (reason: unknown) => unknown) => run().catch(onRejected),
      finally: (onFinally?: () => void) => run().finally(onFinally),
    });
    return self;
  }

  const start = (kind: FakeOpKind, extra: Partial<FakeOp>) => {
    const op: FakeOp = { kind, joins: [], ...extra };
    ops.push(op);
    return chain(op);
  };

  const db = {
    select: (fields?: unknown) => start("select", { fields }),
    selectDistinct: (fields?: unknown) => start("selectDistinct", { fields }),
    update: (table: unknown) => start("update", { table }),
    insert: (table: unknown) => start("insert", { table }),
    delete: (table: unknown) => start("delete", { table }),
  };

  return {
    db,
    ops,
    /** Queue select handlers for a table; the last one stays in place for later selects. */
    onSelect(table: unknown, ...handlers: Array<SelectHandler | unknown[]>) {
      const list = selectHandlers.get(table) ?? [];
      for (const handler of handlers) list.push(typeof handler === "function" ? handler as SelectHandler : () => handler as unknown[]);
      selectHandlers.set(table, list);
    },
    setUpdateResult(handler: (op: FakeOp) => unknown) { updateResult = handler; },
    setInsertResult(handler: (op: FakeOp) => unknown) { insertResult = handler; },
    setDeleteResult(handler: (op: FakeOp) => unknown) { deleteResult = handler; },
    opsFor(kind: FakeOpKind, table?: unknown) { return ops.filter((op) => op.kind === kind && (table === undefined || op.table === table)); },
    updatesFor(table: unknown) { return ops.filter((op) => op.kind === "update" && op.table === table).map((op) => op.set ?? {}); },
    reset() { ops.length = 0; selectHandlers.clear(); },
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
