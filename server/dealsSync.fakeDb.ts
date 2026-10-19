/**
 * Test-only in-memory stand-in for the drizzle MySQL client used by the Builder
 * Deals sync. It renders every predicate through drizzle's own MySQL dialect
 * and evaluates the resulting SQL against plain row objects, so tests exercise
 * the real query shapes (eq/and/or/isNull/inArray/gt/like, order by, limit)
 * without a database. It is deliberately small: only what dealsSync,
 * dealsSyncAdmin, dealsMap and the catalog readers need.
 */
import { getTableColumns, getTableName, is, SQL } from "drizzle-orm";
import { MySqlDialect, MySqlTable } from "drizzle-orm/mysql-core";

type Row = Record<string, unknown>;
type Table = MySqlTable;

const dialect = new MySqlDialect();

type Token = { type: "ident"; table: string; column: string } | { type: "param" } | { type: "number"; value: number } | { type: "string"; value: string } | { type: "word"; value: string } | { type: "op"; value: string } | { type: "lparen" } | { type: "rparen" } | { type: "comma" };

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "`") {
      const match = /^`([^`]+)`\.`([^`]+)`/.exec(sql.slice(index)) ?? /^`([^`]+)`/.exec(sql.slice(index));
      if (!match) throw new Error(`fake db: bad identifier at ${sql.slice(index, index + 20)}`);
      tokens.push(match[2] ? { type: "ident", table: match[1], column: match[2] } : { type: "ident", table: "", column: match[1] });
      index += match[0].length;
      continue;
    }
    if (char === "?") { tokens.push({ type: "param" }); index += 1; continue; }
    if (char === "(") { tokens.push({ type: "lparen" }); index += 1; continue; }
    if (char === ")") { tokens.push({ type: "rparen" }); index += 1; continue; }
    if (char === ",") { tokens.push({ type: "comma" }); index += 1; continue; }
    if (char === "'") {
      const end = sql.indexOf("'", index + 1);
      tokens.push({ type: "string", value: sql.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    const op = /^(<>|!=|>=|<=|=|>|<|\*)/.exec(sql.slice(index));
    if (op) { tokens.push({ type: "op", value: op[1] }); index += op[1].length; continue; }
    const number = /^-?\d+(?:\.\d+)?/.exec(sql.slice(index));
    if (number) { tokens.push({ type: "number", value: Number(number[0]) }); index += number[0].length; continue; }
    const word = /^[A-Za-z_]+/.exec(sql.slice(index));
    if (word) { tokens.push({ type: "word", value: word[0].toLowerCase() }); index += word[0].length; continue; }
    throw new Error(`fake db: unexpected SQL at ${sql.slice(index, index + 20)}`);
  }
  return tokens;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?$/.test(value)) return new Date(`${value.replace(" ", "T")}Z`).getTime();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function compare(left: unknown, right: unknown, op: string): boolean {
  const a = normalizeValue(left);
  const b = normalizeValue(right);
  if (a === null || a === undefined || b === null || b === undefined) return false;
  switch (op) {
    case "=": return a === b;
    case "<>": case "!=": return a !== b;
    case ">": return (a as number) > (b as number);
    case "<": return (a as number) < (b as number);
    case ">=": return (a as number) >= (b as number);
    case "<=": return (a as number) <= (b as number);
    default: throw new Error(`fake db: unsupported operator ${op}`);
  }
}

class Predicate {
  private position = 0;
  private paramIndex = 0;
  constructor(private readonly tokens: Token[], private readonly params: unknown[], private readonly columnKey: (table: string, column: string) => string) {}

  evaluate(row: Row): boolean {
    this.position = 0;
    this.paramIndex = 0;
    const result = this.parseOr(row);
    if (this.position !== this.tokens.length) throw new Error("fake db: trailing SQL tokens");
    return Boolean(result);
  }

  private peek(): Token | undefined { return this.tokens[this.position]; }
  private next(): Token { return this.tokens[this.position++]; }
  private isWord(value: string): boolean { const token = this.peek(); return token?.type === "word" && token.value === value; }

  private parseOr(row: Row): unknown {
    let left = this.parseAnd(row);
    while (this.isWord("or")) { this.next(); const right = this.parseAnd(row); left = Boolean(left) || Boolean(right); }
    return left;
  }

  private parseAnd(row: Row): unknown {
    let left = this.parseNot(row);
    while (this.isWord("and")) { this.next(); const right = this.parseNot(row); left = Boolean(left) && Boolean(right); }
    return left;
  }

  private parseNot(row: Row): unknown {
    if (this.isWord("not")) { this.next(); return !this.parseNot(row); }
    return this.parseComparison(row);
  }

  private parseComparison(row: Row): unknown {
    const left = this.parseValue(row);
    const token = this.peek();
    if (!token) return left;
    if (token.type === "op") {
      this.next();
      const right = this.parseValue(row);
      return compare(left, right, token.value);
    }
    if (token.type === "word" && token.value === "is") {
      this.next();
      let negate = false;
      if (this.isWord("not")) { this.next(); negate = true; }
      if (!this.isWord("null")) throw new Error("fake db: expected null");
      this.next();
      const isNull = left === null || left === undefined;
      return negate ? !isNull : isNull;
    }
    if (token.type === "word" && (token.value === "in" || token.value === "not")) {
      let negate = false;
      if (token.value === "not") { this.next(); negate = true; }
      if (!this.isWord("in")) throw new Error("fake db: expected in");
      this.next();
      if (this.next().type !== "lparen") throw new Error("fake db: expected (");
      const values: unknown[] = [];
      while (this.peek()?.type !== "rparen") {
        values.push(this.parseValue(row));
        if (this.peek()?.type === "comma") this.next();
      }
      this.next();
      const found = values.some((value) => compare(left, value, "="));
      return negate ? !found : found;
    }
    if (token.type === "word" && token.value === "like") {
      this.next();
      const pattern = String(this.parseValue(row) ?? "");
      const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
      return typeof left === "string" && regex.test(left);
    }
    return left;
  }

  private parseValue(row: Row): unknown {
    const token = this.next();
    if (!token) throw new Error("fake db: unexpected end of SQL");
    switch (token.type) {
      case "lparen": {
        const inner = this.parseOr(row);
        if (this.next()?.type !== "rparen") throw new Error("fake db: expected )");
        return inner;
      }
      case "ident": return row[this.columnKey(token.table, token.column)];
      case "param": return this.params[this.paramIndex++];
      case "number": return token.value;
      case "string": return token.value;
      case "word": {
        if (token.value === "true") return true;
        if (token.value === "false") return false;
        if (token.value === "null") return null;
        if (token.value === "trim" && this.peek()?.type === "lparen") {
          this.next();
          const inner = this.parseValue(row);
          if (this.next()?.type !== "rparen") throw new Error("fake db: expected )");
          return typeof inner === "string" ? inner.trim() : inner;
        }
        throw new Error(`fake db: unsupported word ${token.value}`);
      }
      default: throw new Error("fake db: unsupported token");
    }
  }
}

type Order = { key: string; direction: "asc" | "desc" };

class Query implements PromiseLike<Row[]> {
  private table: Table | null = null;
  private predicate: SQL | undefined;
  private orders: Order[] = [];
  private max: number | null = null;
  private skip = 0;
  constructor(private readonly db: FakeDealsDb, private readonly fields: Record<string, unknown> | undefined) {}

  from(table: Table) { this.table = table; return this; }
  where(predicate: SQL | undefined) { this.predicate = predicate; return this; }
  orderBy(...orders: unknown[]) {
    for (const order of orders) {
      if (is(order, SQL)) {
        const rendered = dialect.sqlToQuery(order).sql;
        const match = /^`([^`]+)`\.`([^`]+)`(?:\s+(asc|desc))?$/i.exec(rendered.trim());
        if (!match) throw new Error(`fake db: unsupported order ${rendered}`);
        this.orders.push({ key: this.db.columnKey(match[1], match[2]), direction: (match[3]?.toLowerCase() as "asc" | "desc") ?? "asc" });
      } else {
        const column = order as { name: string; table: Table };
        this.orders.push({ key: this.db.columnKey(getTableName(column.table), column.name), direction: "asc" });
      }
    }
    return this;
  }
  limit(value: number) { this.max = value; return this; }
  offset(value: number) { this.skip = value; return this; }
  for() { return this; }

  private run(): Row[] {
    if (!this.table) throw new Error("fake db: select without from");
    let rows = this.db.rows(this.table).filter((row) => this.db.matches(row, this.predicate));
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const order of this.orders) {
          const left = normalizeValue(a[order.key]) as number | string | null;
          const right = normalizeValue(b[order.key]) as number | string | null;
          if (left === right) continue;
          if (left === null || left === undefined) return order.direction === "asc" ? -1 : 1;
          if (right === null || right === undefined) return order.direction === "asc" ? 1 : -1;
          return (left < right ? -1 : 1) * (order.direction === "asc" ? 1 : -1);
        }
        return 0;
      });
    }
    rows = rows.slice(this.skip, this.max === null ? undefined : this.skip + this.max);
    if (!this.fields) return rows.map((row) => ({ ...row }));
    const aggregate = Object.entries(this.fields).find(([, value]) => is(value, SQL) && /^count\(\*\)$/i.test(dialect.sqlToQuery(value).sql));
    if (aggregate) return [{ [aggregate[0]]: rows.length }];
    return rows.map((row) => Object.fromEntries(Object.entries(this.fields!).map(([key, column]) => [key, row[(column as { name: string }).name === undefined ? key : this.db.columnKey(getTableName((column as { table: Table }).table), (column as { name: string }).name)]])));
  }

  then<TResult1 = Row[], TResult2 = never>(onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
  }
}

export class FakeDealsDb {
  private readonly store = new Map<string, Row[]>();
  private readonly tables = new Map<string, Table>();
  private readonly ids = new Map<string, number>();
  readonly log: Array<{ op: "insert" | "update" | "delete"; table: string; values?: Row }> = [];

  rows(table: Table): Row[] {
    const name = getTableName(table);
    if (!this.tables.has(name)) this.tables.set(name, table);
    if (!this.store.has(name)) this.store.set(name, []);
    return this.store.get(name)!;
  }

  columnKey(tableName: string, columnName: string): string {
    const table = this.tables.get(tableName);
    if (!table) return columnName;
    const entry = Object.entries(getTableColumns(table)).find(([, column]) => column.name === columnName);
    return entry ? entry[0] : columnName;
  }

  matches(row: Row, predicate: SQL | undefined): boolean {
    if (!predicate) return true;
    const query = dialect.sqlToQuery(predicate);
    return new Predicate(tokenize(query.sql), query.params, (table, column) => this.columnKey(table, column)).evaluate(row);
  }

  /** Inserts with column defaults applied (autoincrement ids, defaultNow timestamps, literal defaults). */
  seed<T extends Table>(table: T, values: Partial<T["$inferInsert"]> | Array<Partial<T["$inferInsert"]>>): number {
    const list = Array.isArray(values) ? values : [values];
    const name = getTableName(table);
    const rows = this.rows(table);
    let firstId = 0;
    for (const value of list) {
      const row: Row = { ...(value as Row) };
      for (const [key, column] of Object.entries(getTableColumns(table))) {
        if (row[key] !== undefined) continue;
        if (column.primary && column.dataType === "number") {
          const next = (this.ids.get(name) ?? 0) + 1;
          this.ids.set(name, next);
          row[key] = next;
          continue;
        }
        if (column.hasDefault) {
          const fallback = (column as { default?: unknown }).default;
          row[key] = is(fallback, SQL) ? new Date() : fallback === undefined ? null : fallback;
          continue;
        }
        row[key] = null;
      }
      if (typeof row.id === "number") this.ids.set(name, Math.max(this.ids.get(name) ?? 0, row.id));
      rows.push(row);
      if (!firstId) firstId = Number(row.id ?? 0);
    }
    return firstId;
  }

  select(fields?: Record<string, unknown>) { return new Query(this, fields); }

  insert(table: Table) {
    return {
      values: (values: Row | Row[]) => {
        const execute = async () => {
          for (const value of Array.isArray(values) ? values : [values]) this.log.push({ op: "insert", table: getTableName(table), values: value });
          const insertId = this.seed(table, values as never);
          return [{ insertId, affectedRows: Array.isArray(values) ? values.length : 1 }];
        };
        const promise = execute();
        return Object.assign(promise, { onDuplicateKeyUpdate: () => promise });
      },
    };
  }

  update(table: Table) {
    return {
      set: (values: Row) => ({
        where: async (predicate: SQL | undefined) => {
          let affectedRows = 0;
          for (const row of this.rows(table)) {
            if (!this.matches(row, predicate)) continue;
            Object.assign(row, values);
            affectedRows += 1;
          }
          this.log.push({ op: "update", table: getTableName(table), values });
          return [{ affectedRows }];
        },
      }),
    };
  }

  delete(table: Table) {
    return {
      where: async (predicate: SQL | undefined) => {
        const rows = this.rows(table);
        const kept = rows.filter((row) => !this.matches(row, predicate));
        const affectedRows = rows.length - kept.length;
        rows.splice(0, rows.length, ...kept);
        this.log.push({ op: "delete", table: getTableName(table) });
        return [{ affectedRows }];
      },
    };
  }

  async transaction<T>(work: (tx: FakeDealsDb) => Promise<T>): Promise<T> {
    return work(this);
  }
}
