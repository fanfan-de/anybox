import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import path from "node:path";
import { record, z, ZodType } from "zod";
import { toCreateTableSQL, zodObjectToColumnDefs, } from "./parser"
import type { SQLiteColumnDef } from "./parser"
import { getProcessEnvValue } from "#env/compat.ts"
//import * as Error from "#util/error.ts"



// #region Constants ──────────────────────────────────────
const DEFAULT_DATABASE_FILE = "agent_local_data.db";
const DATABASE_FILE_ENV = "ANYBOX_DATABASE_FILE";
const AGENT_DATA_DIR_ENV = "ANYBOX_AGENT_DATA_DIR";
// #endregion

// #region Types & Interfaces ─────────────────────────────
type SQLiteValue = string | number | bigint | boolean | null | Uint8Array;

type Operator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "LIKE" | "IS" | "IS NOT";

interface WhereClause {
  column: string;
  operator?: Operator; // 默认 "="
  value: SQLiteValue;
}

interface OrderBy {
  column: string;
  direction?: "ASC" | "DESC"; // 默认 "ASC"
}

/** 查询选项（聚合了筛选、排序、分页、列选择） */
interface QueryOptions {
  where?: WhereClause[];
  orderBy?: OrderBy[];
  limit?: number;
  offset?: number;
  columns?: string[]; // SELECT 指定列，默认 "*"
}
// #endregion




// #region Core Logic ─────────────────────────────────────
let activeDatabase: Database | undefined
let activeDatabaseFile: string | undefined
let activeDatabaseGeneration = 0
let lifecycleHooksRegistered = false

function resolveDatabaseFile() {
  const configured = getProcessEnvValue(DATABASE_FILE_ENV)?.trim()
  if (configured && configured.length > 0) return configured

  const managedDataDir = getProcessEnvValue(AGENT_DATA_DIR_ENV)?.trim()
  if (managedDataDir) {
    return path.join(managedDataDir, "database", DEFAULT_DATABASE_FILE)
  }

  return DEFAULT_DATABASE_FILE
}

function configureDatabase(database: Database) {
  // Keep write performance while still enforcing foreign keys per connection.
  database.run("PRAGMA journal_mode = WAL;")
  database.run("PRAGMA synchronous = NORMAL;")
  database.run("PRAGMA foreign_keys = ON;")
}

function registerLifecycleHooks() {
  if (lifecycleHooksRegistered) return
  lifecycleHooksRegistered = true

  process.on("beforeExit", () => {
    closeDatabase()
  })
  process.on("exit", () => {
    closeDatabase()
  })
}

function openDatabase(databaseFile: string) {
  const databaseDirectory = path.dirname(databaseFile)
  if (databaseDirectory && databaseDirectory !== ".") {
    fs.mkdirSync(databaseDirectory, { recursive: true })
  }

  const database = new Database(databaseFile, { create: true })
  configureDatabase(database)
  activeDatabase = database
  activeDatabaseFile = databaseFile
  activeDatabaseGeneration += 1
  registerLifecycleHooks()
  return database
}

export function getDatabase() {
  const databaseFile = resolveDatabaseFile()
  if (activeDatabase && activeDatabaseFile === databaseFile) {
    return activeDatabase
  }

  if (activeDatabase) {
    closeDatabase()
  }

  return openDatabase(databaseFile)
}

export function closeDatabase() {
  if (!activeDatabase) return

  const database = activeDatabase
  activeDatabase = undefined
  activeDatabaseFile = undefined
  activeDatabaseGeneration += 1

  try {
    database.run("PRAGMA wal_checkpoint(TRUNCATE);")
  } catch {
    // Ignore checkpoint failures during teardown.
  }

  try {
    database.close()
  } catch {
    // Ignore close failures so teardown stays idempotent.
  }
}

export function setDatabaseFile(databaseFile?: string) {
  const next = databaseFile?.trim()
  if (next) {
    process.env[DATABASE_FILE_ENV] = next
  } else {
    delete process.env[DATABASE_FILE_ENV]
  }

  if (activeDatabase && activeDatabaseFile !== resolveDatabaseFile()) {
    closeDatabase()
  }
}

export function getDatabaseGeneration() {
  return activeDatabaseGeneration
}

export function getDatabaseFile() {
  return path.resolve(resolveDatabaseFile())
}

export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const database = getDatabase()
    const value = Reflect.get(database as object, prop, database)
    return typeof value === "function" ? value.bind(database) : value
  },
  set(_target, prop, value) {
    const database = getDatabase()
    return Reflect.set(database as object, prop, value, database)
  },
}) as Database
// 性能优化 PRAGMA
db.run("PRAGMA journal_mode = WAL;"); // WAL 模式：并发读写性能大幅提升
db.run("PRAGMA synchronous = NORMAL;"); // 降低同步级别，在 WAL 模式下依然安全
db.run("PRAGMA foreign_keys = ON;"); // 启用外键约束，防止脏数据

/**通用建表函数
 * @param tableName  表名
 * @param schema  zod 对象
 */
function createTableByZodObject<T extends z.ZodObject>(
  tableName: string,
  schema: T
): void {
  const columedefs = zodObjectToColumnDefs(schema)
  db.run(toCreateTableSQL(tableName, columedefs))
}

function commonSchemaFromZodDiscriminatedUnion<
  Options extends z.ZodObject<any, any>[],
  Discriminator extends string
>(
  schema: z.ZodDiscriminatedUnion<Options, Discriminator>
): z.ZodObject<any, any> {
  const options = schema.options as z.ZodObject<any, any>[]
  if (!options || options.length === 0) {
    throw new Error("Invalid discriminated union schema")
  }

  const allKeySets = options.map((opt) => new Set(Object.keys(opt.shape)))
  const commonKeys = allKeySets.reduce(
    (acc, set) => new Set([...acc].filter((key) => set.has(key)))
  )
  const commonShape = Object.fromEntries(
    [...commonKeys].map((key) => [key, options[0]!.shape[key]])
  ) as z.ZodRawShape

  return z.object(commonShape)
}

function zodDiscriminatedUnionToColumnDefs<
  Options extends z.ZodObject<any, any>[],
  Discriminator extends string
>(
  schema: z.ZodDiscriminatedUnion<Options, Discriminator>
): Record<string, SQLiteColumnDef> {
  return {
    ...zodObjectToColumnDefs(commonSchemaFromZodDiscriminatedUnion(schema)),
    data: {
      name: "data",
      type: "TEXT",
      nullable: true,
      primaryKey: false,
      defaultValue: undefined,
      unique: false,
    },
  }
}

/**联合类型建表函数
 * @param tableName  表名
 * @param schema  ZodDiscriminatedUnion 联合对象
 */
function createTableByZodDiscriminatedUnion<
  Options extends z.ZodObject<any, any>[],
  Discriminator extends string
>(
  tableName: string,
  schema: z.ZodDiscriminatedUnion<Options, Discriminator>
): void {
  db.run(toCreateTableSQL(tableName, zodDiscriminatedUnionToColumnDefs(schema)))
  return
  /*
  const options = schema.options as z.ZodObject<any, any>[]
  if (!options)
    return
  // 1. 收集每个 variant 的 key 集合
  const allKeySets = options.map((opt) => new Set(Object.keys(opt.shape)))
  // 2. 求所有 variant 的 key 交集 → 共有 key
  const commonKeys = allKeySets.reduce(
    (acc, set) => new Set([...acc].filter((key) => set.has(key)))
  )
  const commonShape = Object.fromEntries(
  // 3. 用 Object.fromEntries 构建共有 shape（避免写入 Readonly 对象）
  const commonShape = Object.fromEntries(
    [...commonKeys].map((key) => [key, options[0]!.shape[key]])
  ) as z.ZodRawShape

  const commonSchema = z.object(commonShape)
  const columnDefs: Record<string, SQLiteColumnDef> = {
    ...zodObjectToColumnDefs(commonSchema),
    data: {
      name: "data",
      type: "TEXT",
      nullable: true,
      primaryKey: false,
      defaultValue: undefined,
      unique: false,
    }
  }

  // 6. 建表
  db.run(toCreateTableSQL(tableName, columnDefs))
  */
}

/** 检测某张表是否已存在
 *
 * @example
 * if (!tableExists("users")) createTable("users", { ... });
 */
function tableExists(tableName: string): boolean {
  const result = db
    .query("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { count: number };

  return result.count > 0;
}

function tableColumns(tableName: string): string[] {
  if (!tableExists(tableName)) return []

  const rows = db
    .prepare(`PRAGMA table_info("${tableName}");`)
    .all() as Array<{ name?: string }>

  return rows
    .map((row) => (typeof row.name === "string" ? row.name : ""))
    .filter((name) => name.length > 0)
}

function toAddColumnSQL(tableName: string, column: SQLiteColumnDef): string {
  const parts: string[] = [`ALTER TABLE "${tableName}" ADD COLUMN "${column.name}"`, column.type]

  if (column.unique) {
    throw new Error(`ALTER TABLE does not support adding UNIQUE column "${column.name}" safely.`)
  }

  if (column.primaryKey) {
    throw new Error(`ALTER TABLE does not support adding PRIMARY KEY column "${column.name}".`)
  }

  if (!column.nullable) {
    if (column.defaultValue === undefined) {
      throw new Error(`Cannot add NOT NULL column "${column.name}" without a default value.`)
    }

    parts.push("NOT NULL")
  }

  if (column.defaultValue !== undefined) {
    const value =
      typeof column.defaultValue === "string"
        ? `'${column.defaultValue.replaceAll("'", "''")}'`
        : String(column.defaultValue)
    parts.push(`DEFAULT ${value}`)
  }

  return `${parts.join(" ")};`
}

function syncTableColumnsWithZodObject<T extends z.ZodRawShape>(
  tableName: string,
  schema: z.ZodObject<T>,
): void {
  if (!tableExists(tableName)) {
    createTableByZodObject(tableName, schema)
    return
  }

  const existing = new Set(tableColumns(tableName).map((column) => column.toLowerCase()))
  const definitions = zodObjectToColumnDefs(schema)

  for (const column of Object.values(definitions)) {
    if (existing.has(column.name.toLowerCase())) continue
    db.run(toAddColumnSQL(tableName, column))
  }
}

function syncTableColumnsWithZodDiscriminatedUnion<
  Options extends z.ZodObject<any, any>[],
  Discriminator extends string
>(
  tableName: string,
  schema: z.ZodDiscriminatedUnion<Options, Discriminator>,
): void {
  if (!tableExists(tableName)) {
    createTableByZodDiscriminatedUnion(tableName, schema)
    return
  }

  const existing = new Set(tableColumns(tableName).map((column) => column.toLowerCase()))
  const definitions = zodDiscriminatedUnionToColumnDefs(schema)

  for (const column of Object.values(definitions)) {
    if (existing.has(column.name.toLowerCase())) continue
    db.run(toAddColumnSQL(tableName, column))
  }
}


/**将业务层对象转换为 SQLite 可存储的扁平记录
 *
 * 转换规则：
 *   - null / undefined  → null
 *   - string / number / bigint / boolean / Uint8Array → 原样保留
 *   - Date             → number（毫秒时间戳）
 *   - 其他复合类型       → JSON 字符串
 *
 * @example
 * toSQLiteValue({ name: "Alice", tags: ["a", "b"], born: new Date() });
 * // → { name: "Alice", tags: '["a","b"]', born: 1718000000000 }
 */
function toSQLiteValue<T extends Record<string, unknown>>(
  obj: T,
): Record<string, SQLiteValue> {
  const result: Record<string, SQLiteValue> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      result[key] = null;
    } else if (
      typeof val === "string" ||
      typeof val === "number" ||
      typeof val === "bigint" ||
      typeof val === "boolean" ||
      val instanceof Uint8Array
    ) {
      result[key] = val;
    } else if (val instanceof Date) {
      result[key] = val.getTime();
    } else {
      // 对象、数组等复合类型 → JSON 序列化
      result[key] = JSON.stringify(val);
    }
  }
  return result;
}

function normalizeRecordKeys<T extends Record<string, unknown>>(
  record: T,
  shape: Record<string, z.ZodTypeAny>,
): Record<string, SQLiteValue> {
  const keyMap = new Map<string, string>()
  for (const key of Object.keys(shape)) {
    keyMap.set(key.toLowerCase(), key)
  }

  const normalized: Record<string, SQLiteValue> = {}
  for (const [key, value] of Object.entries(record) as [string, SQLiteValue][]) {
    const mapped = keyMap.get(key.toLowerCase()) ?? key
    normalized[mapped] = value
  }

  return normalized
}



function isZodDiscriminatedUnion(schema: z.ZodType): schema is z.ZodDiscriminatedUnion<any, any> {
  return schema instanceof z.ZodDiscriminatedUnion;
}
/** 提取联合类型数据的公共部分和变体特有部分
 * @param schema ZodDiscriminatedUnion 联合类型 schema
 * @param data 完整的联合类型数据
 * @returns 分割后的公共部分和变体特有部分（JSON字符串）
 */
function splitUnionData(
  schema: z.ZodDiscriminatedUnion<any, any>,
  data: any
): { common: Record<string, unknown>, variantData: string } {
  const options = schema.options as z.ZodObject<any, any>[];
  if (!options || options.length === 0) {
    throw new Error('Invalid discriminated union schema');
  }
  
  // 1. 收集所有变体的 key 集合
  const allKeySets = options.map((opt) => new Set(Object.keys(opt.shape)));
  
  // 2. 求所有变体的 key 交集 → 共有 key
  const commonKeys = allKeySets.reduce(
    (acc, set) => new Set([...acc].filter((key) => set.has(key)))
  );
  
  // 3. 分割数据
  const common: Record<string, unknown> = {};
  const variant: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (commonKeys.has(key)) {
      common[key] = value;
    } else {
      variant[key] = value;
    }
  }
  
  return {
    common,
    variantData: JSON.stringify(variant)
  };
}

/** 合并公共字段和变体数据重建完整对象
 * @param schema ZodDiscriminatedUnion 联合类型 schema
 * @param common 公共字段数据
 * @param variantData 变体特有数据的 JSON 字符串
 * @returns 完整的联合类型对象
 */
function mergeUnionData(
  schema: z.ZodDiscriminatedUnion<any, any>,
  common: Record<string, unknown>,
  variantData: string
): any {
  let variant: Record<string, unknown> = {};
  try {
    variant = JSON.parse(variantData);
  } catch {
    // 如果解析失败，保持空对象
  }
  
  return { ...common, ...variant };
}

/**将 SQLite 记录还原为 Zod Schema 描述的业务对象
 *
 * 还原规则（与 toSQLiteValue 对称）：
 *   - number + ZodDate  → new Date(value)
 *   - string + 复合类型  → JSON.parse(value)
 *   - 其他              → 直通
 *
 * @example
 * const UserSchema = z.object({ name: z.string(), born: z.date() });
 * fromSQLiteRecord(UserSchema, { name: "Alice", born: 1718000000000 });
 * // → { name: "Alice", born: Date(...) }
 */
function fromSQLiteRecord<T extends z.ZodType>(
  schema: T,
  record: Record<string, SQLiteValue>,
): z.output<T> {
  if (isZodDiscriminatedUnion(schema)) {
    const { data: rawData, ...rawCommonFields } = record
    const rawVariantData = typeof rawData === "string" ? rawData : ""
    const rawCommonSchema = commonSchemaFromZodDiscriminatedUnion(schema)
    const normalizedRawCommonFields = normalizeRecordKeys(rawCommonFields as Record<string, unknown>, rawCommonSchema.shape)
    const restoredRawCommonFields: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(normalizedRawCommonFields)) {
      const fieldSchema = rawCommonSchema.shape[key] as z.ZodTypeAny | undefined
      restoredRawCommonFields[key] = fieldSchema ? restoreValue(fieldSchema, value) : value
    }

    return schema.parse(mergeUnionData(schema, restoredRawCommonFields, rawVariantData))
  }
  // 支持 ZodDiscriminatedUnion 类型
  if (isZodDiscriminatedUnion(schema)) {
    // 从记录中提取 data 字段
    const { data, ...commonFields } = record;
    const variantData = typeof data === 'string' ? data : '';
    
    // 合并数据
    const merged = mergeUnionData(schema, normalizeRecordKeys(commonFields as Record<string, unknown>, (schema.options as z.ZodObject<any, any>[])[0]!.shape), variantData);
    
    // 使用 Zod 校验并返回
    return schema.parse(merged);
  }
  
  // 运行时检查：如果不是 ZodObject，抛出错误
  if (!(schema instanceof z.ZodObject)) {
    //抛出错误
    throw new Error()
  }
  const shape = schema.shape;
  const normalizedRecord = normalizeRecordKeys(record, shape);
  const obj: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(normalizedRecord)) {
    const fieldSchema = shape[key] as z.ZodTypeAny | undefined;
    if (!fieldSchema) {
      obj[key] = value; // schema 中未定义的字段，原样保留
      continue;
    }
    obj[key] = restoreValue(fieldSchema, value);
  }

  return schema.parse(obj); // 最终交给 Zod 做校验 + 类型推断
}



/** 根据字段的 Zod Schema 将单个 SQLiteValue 还原为业务层值 */
function restoreValue(fieldSchema: z.ZodType, value: SQLiteValue): z.output<z.ZodType> {
  if (value === null) {
    if (isNullable(fieldSchema)) return null;
    if (isOptional(fieldSchema)) return undefined;
    return null;
  }

  const base = unwrap(fieldSchema);

  // 时间戳 → Date
  if (base instanceof z.ZodDate && typeof value === "number") {
    return new Date(value);
  }

  // JSON 字符串 → 复合对象
  if (isJsonType(base) && typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  if (base instanceof z.ZodBoolean && typeof value === "number") {
    return value !== 0; // 0 → false, 非0 → true
  }

  return value; // 原始标量直通
}

/**递归剥开 optional / nullable / default 等包装层，拿到最内层的实际类型
 *
 * 例如 z.string().optional().nullable()
 *   → ZodNullable → ZodOptional → ZodString
 *   → 返回 ZodString
 */
function unwrap(schema: z.ZodType): z.ZodType {
  const t = defType(schema);
  const wrapperTypes = [
    "optional",
    "nullable",
    "default",
    "nonoptional",
    "prefault",    // zod v4 的 default
    "ZodOptional", // zod v3 fallback
    "ZodNullable",
    "ZodDefault",
    "ZodEffects",
  ];

  if (wrapperTypes.includes(t)) {
    const inner = innerType(schema);
    return inner ? unwrap(inner) : schema;
  }

  return schema;
}

// --- Schema 定义信息的底层读取 ---

/** 读取 schema 的内部定义对象（兼容 zod v3 / v4） */
function defOf(schema: z.ZodType): any {
  return (schema as any)._zod?.def ?? (schema as any)._def;
}

/** 读取 schema 的类型名称 */
function defType(schema: z.ZodType): string {
  const d = defOf(schema);
  return d?.type ?? d?.typeName ?? "";
}

/** 读取包装类型的内层 schema */
function innerType(schema: z.ZodType): z.ZodType | undefined {
  const d = defOf(schema);
  return d?.innerType ?? d?.schema;
}

// --- 特征判断 ---

/** 判断 schema 链路中是否包含 optional 包装 */
function isOptional(schema: z.ZodType): boolean {
  return hasWrapper(schema, "optional", "ZodOptional");
}

/** 判断 schema 链路中是否包含 nullable 包装 */
function isNullable(schema: z.ZodType): boolean {
  return hasWrapper(schema, "nullable", "ZodNullable");
}

/** 递归检查 schema 链路中是否存在指定的包装类型 */
function hasWrapper(schema: z.ZodType, ...targets: string[]): boolean {
  const t = defType(schema);

  if (targets.includes(t)) return true;

  const inner = innerType(schema);
  const traversableTypes = [
    "optional",
    "nullable",
    "default",
    "nonoptional",
    "prefault",
    "ZodOptional",
    "ZodNullable",
    "ZodDefault",
  ];

  if (inner && traversableTypes.includes(t)) {
    return hasWrapper(inner, ...targets);
  }

  return false;
}

/** 判断最内层类型是否是复合类型（存储时需要 JSON 序列化） */
function isJsonType(base: z.ZodType): boolean {
  return (
    base instanceof z.ZodObject ||
    base instanceof z.ZodArray ||
    base instanceof z.ZodRecord ||
    base instanceof z.ZodTuple ||
    base instanceof z.ZodMap ||
    base instanceof z.ZodSet
  );
}


//#region 第六部分：SQL 子句构建器


/**构建 WHERE 子句及对应的参数数组
 * @returns { sql: " WHERE col1 = ? AND col2 > ?", params: [val1, val2] }
 */
function buildWhereClause(conditions?: WhereClause[]): {
  sql: string;
  params: SQLiteValue[];
} {
  if (!conditions || conditions.length === 0) {
    return { sql: "", params: [] };
  }

  const parts: string[] = [];
  const params: SQLiteValue[] = [];

  for (const { column, operator = "=", value } of conditions) {
    if (operator === "IS" || operator === "IS NOT") {
      parts.push(`${column} ${operator} NULL`);
    } else {
      parts.push(`${column} ${operator} ?`);
      params.push(value);
    }
  }

  return { sql: ` WHERE ${parts.join(" AND ")}`, params };
}

/** 构建 ORDER BY 子句 */
function buildOrderByClause(orderBy?: OrderBy[]): string {
  if (!orderBy || orderBy.length === 0) return "";

  const parts = orderBy.map((o) => `${o.column} ${o.direction ?? "ASC"}`);
  return ` ORDER BY ${parts.join(", ")}`;
}

/** 构建 LIMIT / OFFSET 子句及对应的参数 */
function buildLimitClause(
  limit?: number,
  offset?: number,
): { sql: string; params: SQLiteValue[] } {
  let sql = "";
  const params: SQLiteValue[] = [];

  if (limit !== undefined) {
    sql += " LIMIT ?";
    params.push(limit);
  }
  if (offset !== undefined) {
    sql += " OFFSET ?";
    params.push(offset);
  }

  return { sql, params };
}

//#endregion



//#region  第七部分：CRUD 操作


// ---------- CREATE（新增） ----------

/**
 * 插入单条记录
 *
 * @returns 新行的 lastInsertRowid
 *
 * @example
 * insertOne("users", { name: "Alice", age: 30 });
 */
function insertOne(
  tableName: string,
  data: Record<string, unknown>,
): number | bigint {

  const record = toSQLiteValue(data)


  const keys = Object.keys(record);
  const placeholders = keys.map(() => "?").join(", ");
  const values = Object.values(record);

  const sql = `INSERT INTO ${tableName} (${keys.join(", ")}) VALUES (${placeholders});`;
  return db.prepare(sql).run(...values).lastInsertRowid;
}

/**
 * 插入单条记录（带 Zod 校验）
 *
 * @example
 * const UserSchema = z.object({ name: z.string(), age: z.number() });
 * insertOneWithSchema("users", { name: "Alice", age: 30 }, UserSchema);
 */
function insertOneWithSchema<T extends z.ZodType>(
  tableName: string,
  data: z.infer<T>,
  schema: T,
): number | bigint {
  const parsed = schema.parse(data); // 校验失败抛出 ZodError
  // 自动检测联合类型
  if (isZodDiscriminatedUnion(schema)) {
    // 调用联合类型专用插入函数
    return insertOneUnion(tableName, parsed, schema as z.ZodDiscriminatedUnion<any, any>);
  }
  
  return insertOne(tableName, parsed as Record<string, unknown>);
}

/**
 * 插入单条联合类型记录
 * 
 * @example
 * const UnionSchema = z.discriminatedUnion("type", [
 *   z.object({ type: z.literal("text"), content: z.string() }),
 *   z.object({ type: z.literal("image"), url: z.string() }),
 * ]);
 * insertOneUnion("union_table", { type: "text", content: "Hello" }, UnionSchema);
 */
function insertOneUnion<T extends z.ZodDiscriminatedUnion<any, any>>(
  tableName: string,
  data: z.infer<T>,
  schema: T,
): number | bigint {
  const parsed = schema.parse(data); // 校验失败抛出 ZodError
  
  // 分割数据为公共部分和变体特有部分
  const { common, variantData } = splitUnionData(schema, parsed);
  
  // 准备插入数据：公共字段 + data 字段
  const record = {
    ...toSQLiteValue(common),
    data: variantData
  };
  
  return insertOne(tableName, record);
}

/**
 * 批量插入联合类型记录
 * 
 * @example
 * insertManyUnion("union_table", [
 *   { type: "text", content: "Hello" },
 *   { type: "image", url: "test.jpg" },
 * ], UnionSchema);
 */
function insertManyUnion<T extends z.ZodDiscriminatedUnion<any, any>>(
  tableName: string,
  dataList: z.infer<T>[],
  schema: T,
): number {
  if (dataList.length === 0) return 0;
  
  const convertedDataList = dataList.map((data) => {
    const parsed = schema.parse(data);
    const { common, variantData } = splitUnionData(schema, parsed);
    return {
      ...toSQLiteValue(common),
      data: variantData
    };
  });
  
  const keys = Object.keys(convertedDataList[0]!);
  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO ${tableName} (${keys.join(", ")}) VALUES (${placeholders});`;
  const stmt = db.prepare(sql);
  
  const runInTransaction = db.transaction((items: Record<string, SQLiteValue>[]) => {
    let count = 0;
    for (const item of items) {
      stmt.run(...keys.map((k) => item[k] as SQLiteValue));
      count++;
    }
    return count;
  });
  
  return runInTransaction(convertedDataList);
}

/**批量插入（使用事务包裹，性能极高）
 * 
 *
 * @returns 成功插入的条数
 *
 * @example
 * insertMany("users", [
 *   { name: "Alice", age: 30 },
 *   { name: "Bob",   age: 25 },
 * ]);
 */
function insertMany(
  tableName: string,
  dataList: Record<string, unknown>[],
): number {
  if (dataList.length === 0) return 0;

  const convertedDataList = dataList.map((item: Record<string, unknown>) => { return toSQLiteValue(item) })

  const keys = Object.keys(convertedDataList[0]!);
  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO ${tableName} (${keys.join(", ")}) VALUES (${placeholders});`;
  const stmt = db.prepare(sql);

  const runInTransaction = db.transaction((items: Record<string, SQLiteValue>[]) => {
    let count = 0;
    for (const item of items) {
      stmt.run(...keys.map((k) => item[k] as SQLiteValue));
      count++;
    }
    return count;
  });

  return runInTransaction(convertedDataList);
}

/**UPSERT：存在则更新，不存在则插入
 * 
 *
 * @param conflictColumns 冲突判断列（通常是主键或唯一索引列）
 * @returns lastInsertRowid
 *
 * @example
 * upsert("users", { id: "u1", name: "Alice", age: 31 }, ["id"]);
 */
function upsert(
  tableName: string,
  data: Record<string, unknown>,
  conflictColumns: string[],
): number | bigint {

  const record = toSQLiteValue(data);
  const keys = Object.keys(record);
  const placeholders = keys.map(() => "?").join(", ");
  const values = Object.values(record);

  // 冲突时只更新非冲突列
  const updateColumns = keys.filter((k) => !conflictColumns.includes(k));
  const updateClause =
    updateColumns.length > 0
      ? `UPDATE SET ${updateColumns.map((col) => `${col} = excluded.${col}`).join(", ")}`
      : "NOTHING";

  const sql = `
    INSERT INTO ${tableName} (${keys.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(${conflictColumns.join(", ")})
    DO ${updateClause};
  `;

  return db.prepare(sql).run(...values).lastInsertRowid;
}

// ---------- READ（查询） ----------

/**查询多条记录
 * 
 *
 * @example
 * // 查询全部
 * findMany("users");
 *
 * // 条件查询 + 排序 + 分页
 * findMany("users", {
 *   where:   [{ column: "age", operator: ">", value: 18 }],
 *   orderBy: [{ column: "created_at", direction: "DESC" }],
 *   limit:   10,
 *   offset:  0,
 * });
 */
function findMany<T extends z.ZodType>(
  tableName: string,
  schema: T,
  options: QueryOptions = {},
): z.output<T>[] {
  const selectCols = options.columns?.join(", ") ?? "*";
  const { sql: whereSql, params: whereParams } = buildWhereClause(options.where);
  const orderSql = buildOrderByClause(options.orderBy);
  const { sql: limitSql, params: limitParams } = buildLimitClause(options.limit, options.offset);

  const sql = `SELECT ${selectCols} FROM ${tableName}${whereSql}${orderSql}${limitSql};`;
  const records = db.prepare(sql).all(...whereParams, ...limitParams) as Record<string, SQLiteValue>[];

  const results = records.map((item) => {
    return fromSQLiteRecord(schema, item)
  })
  return results;
}

/**
 * 查询单条记录（内部调用 findMany + LIMIT 1）
 *
 * @example
 * findOne("users", UserSchema, { where: [{ column: "id", value: "u1" }] });
 */
function findOne<T extends z.ZodType>(
  tableName: string,
  schema: T,
  options: QueryOptions = {},
): z.output<T> | null {
  const results = findMany<T>(tableName, schema, { ...options, limit: 1 });
  return results[0] ?? null;
}

/**
 * 带 Zod Schema 校验的查询单条记录
 *
 * @example
 * findOneWithSchema("users", UserSchema, { where: [{ column: "id", value: "u1" }] });
 */
function findOneWithSchema<T extends z.ZodType>(
  tableName: string,
  schema: T,
  options: QueryOptions = {},
): z.output<T> | null {
  const result = findOne(tableName, schema, options);
  if (result) {
    return schema.parse(result);
  }
  return null;
}

/**
 * 根据主键 ID 查询（快捷方法）
 *
 * @param idColumn 主键列名，默认 "id"
 *
 * @example
 * findById("users", "u1");
 * findById("users", 42, "user_id");
 */
function findById<T extends z.ZodType>(
  tableName: string,
  schema: T,
  id: string,
  idColumn: string = "id",
): z.output<T> | null {
  return findOne(tableName, schema, {
    where: [{ column: idColumn, value: id }],
  });
}

/**
 * 查询记录总数
 *
 * @example
 * count("users");
 * count("users", [{ column: "age", operator: ">", value: 18 }]);
 */
function count(tableName: string, where?: WhereClause[]): number {
  const { sql: whereSql, params } = buildWhereClause(where);
  const sql = `SELECT COUNT(*) as count FROM ${tableName}${whereSql};`;
  const result = db.prepare(sql).get(...params) as { count: number };
  return result.count;
}

/**
 * 检查是否存在符合条件的记录
 *
 * @example
 * exists("users", [{ column: "email", value: "alice@example.com" }]);
 */
function exists(tableName: string, where: WhereClause[]): boolean {
  return count(tableName, where) > 0;
}

/**
 * 带 Zod Schema 校验的查询（确保返回数据符合类型定义）
 *
 * @example
 * const UserSchema = z.object({ name: z.string(), age: z.number() });
 * findManyWithSchema("users", UserSchema, { limit: 10 });
 */
function findManyWithSchema<T extends z.ZodType>(
  tableName: string,
  schema: T,
  options: QueryOptions = {},
): z.output<T>[] {
  const rows = findMany(tableName, schema, options);
  return rows.map((row) => schema.parse(row));
}

// ---------- UPDATE（更新） ----------

/**
 * 按条件更新多条记录
 *
 * @returns 受影响的行数
 * @throws  未提供 WHERE 条件时抛错（防止误更新全表）
 *
 * @example
 * updateMany("users", { name: "Alice V2", age: 31 }, [{ column: "id", value: "u1" }]);
 */
function updateMany(
  tableName: string,
  data: Record<string, unknown>,
  where: WhereClause[],
): number {
  if (where.length === 0) {
    throw new Error(
      "UPDATE 必须提供 WHERE 条件，防止误更新全表。如需更新全表请使用 updateAll。",
    );
  }

  const _data = toSQLiteValue(data)

  const keys = Object.keys(_data);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const setValues = Object.values(_data);
  const { sql: whereSql, params: whereParams } = buildWhereClause(where);

  const sql = `UPDATE ${tableName} SET ${setClause}${whereSql};`;
  return db.prepare(sql).run(...setValues, ...whereParams).changes;
}

/**
 * 按条件更新多条联合类型记录
 *
 * @returns 受影响的行数
 * @throws  未提供 WHERE 条件时抛错（防止误更新全表）
 *
 * @example
 * const UnionSchema = z.discriminatedUnion("type", [...]);
 * updateManyUnion("union_table", { type: "text", content: "Updated" }, [{ column: "id", value: "u1" }], UnionSchema);
 */
function updateManyUnion<T extends z.ZodDiscriminatedUnion<any, any>>(
  tableName: string,
  data: z.infer<T>,
  where: WhereClause[],
  schema: T,
): number {
  if (where.length === 0) {
    throw new Error(
      "UPDATE 必须提供 WHERE 条件，防止误更新全表。如需更新全表请使用 updateAll。",
    );
  }

  const parsed = schema.parse(data); // 校验失败抛出 ZodError
  
  // 分割数据为公共部分和变体特有部分
  const { common, variantData } = splitUnionData(schema, parsed);
  
  // 准备更新数据：公共字段 + data 字段
  const _data = {
    ...toSQLiteValue(common),
    data: variantData
  };

  const keys = Object.keys(_data);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const setValues = Object.values(_data);
  const { sql: whereSql, params: whereParams } = buildWhereClause(where);

  const sql = `UPDATE ${tableName} SET ${setClause}${whereSql};`;
  return db.prepare(sql).run(...setValues, ...whereParams).changes;
}

/**
 * 按条件更新多条记录（带 Zod 校验，自动检测联合类型）
 *
 * @returns 受影响的行数
 * @throws  未提供 WHERE 条件时抛错（防止误更新全表）
 *
 * @example
 * updateManyWithSchema("users", { name: "Alice V2", age: 31 }, [{ column: "id", value: "u1" }], UserSchema);
 */
function updateManyWithSchema<T extends z.ZodType>(
  tableName: string,
  data: z.infer<T>,
  where: WhereClause[],
  schema: T,
): number {
  const parsed = schema.parse(data); // 校验失败抛出 ZodError
  
  // 自动检测联合类型
  if (isZodDiscriminatedUnion(schema)) {
    // 调用联合类型专用更新函数
    return updateManyUnion(tableName, parsed, where, schema as z.ZodDiscriminatedUnion<any, any>);
  }
  
  // 普通对象更新
  return updateMany(tableName, parsed as Record<string, unknown>, where);
}

/**
 * 根据主键 ID 更新（快捷方法）
 *
 * @returns 受影响的行数
 *
 * @example
 * updateById("users", "u1", { name: "New Name" });
 */
function updateById(
  tableName: string,
  id: string,
  data: Record<string, unknown>,
  idColumn: string = "id",
): number {
  return updateMany(tableName, data, [{ column: idColumn, value: id }]);
}

/**
 * 带 Zod Schema 校验的根据主键 ID 更新（快捷方法）
 *
 * @returns 受影响的行数
 *
 * @example
 * updateByIdWithSchema("users", "u1", { name: "New Name" }, UserSchema);
 */
function updateByIdWithSchema<T extends z.ZodType>(
  tableName: string,
  id: string,
  data: z.infer<T>,
  schema: T,
  idColumn: string = "id",
): number {
  return updateManyWithSchema(tableName, data, [{ column: idColumn, value: id }], schema);
}

/**
 * 更新全表所有记录（⚠️ 危险操作，需显式调用）
 *
 * @returns 受影响的行数
 */
function updateAll(
  tableName: string,
  data: Record<string, unknown>,
): number {
  const _data = toSQLiteValue(data)
  const keys = Object.keys(_data);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = Object.values(_data);

  const sql = `UPDATE ${tableName} SET ${setClause};`;
  return db.prepare(sql).run(...values).changes;
}

// ---------- DELETE（删除） ----------

/**
 * 按条件删除记录
 *
 * @returns 受影响的行数
 * @throws  未提供 WHERE 条件时抛错（防止误删全表）
 *
 * @example
 * deleteMany("users", [{ column: "age", operator: "<", value: 18 }]);
 */
function deleteMany(tableName: string, where: WhereClause[]): number {
  if (where.length === 0) {
    throw new Error(
      "DELETE 必须提供 WHERE 条件，防止误删全表。如需清空请使用 deleteAll。",
    );
  }

  const { sql: whereSql, params } = buildWhereClause(where);
  const sql = `DELETE FROM ${tableName}${whereSql};`;
  return db.prepare(sql).run(...params).changes;
}

/**
 * 带 Zod Schema 校验的删除（虽然删除操作不需要 schema，但提供 API 一致性）
 *
 * @returns 受影响的行数
 * @throws  未提供 WHERE 条件时抛错（防止误删全表）
 *
 * @example
 * deleteManyWithSchema("users", [{ column: "age", operator: "<", value: 18 }], UserSchema);
 */
function deleteManyWithSchema<T extends z.ZodType>(
  tableName: string,
  where: WhereClause[],
  schema: T,
): number {
  // Schema 参数仅用于类型检查和 API 一致性，实际删除操作不需要
  return deleteMany(tableName, where);
}

/**
 * 根据主键 ID 删除（快捷方法）
 *
 * @returns 受影响的行数
 *
 * @example
 * deleteById("users", "u1");
 */
function deleteById(
  tableName: string,
  id: string,
  idColumn: string = "id",
): number {
  return deleteMany(tableName, [{ column: idColumn, value: id }]);
}

/**
 * 带 Zod Schema 校验的根据主键 ID 删除（快捷方法）
 *
 * @returns 受影响的行数
 *
 * @example
 * deleteByIdWithSchema("users", "u1", UserSchema);
 */
function deleteByIdWithSchema<T extends z.ZodType>(
  tableName: string,
  id: string,
  schema: T,
  idColumn: string = "id",
): number {
  // Schema 参数仅用于类型检查和 API 一致性，实际删除操作不需要
  return deleteById(tableName, id, idColumn);
}

/**
 * 清空整张表（⚠️ 危险操作）
 *
 * @returns 被删除的行数
 */
function deleteAll(tableName: string): number {
  return db.prepare(`DELETE FROM ${tableName};`).run().changes;
}


//#endregion










// #region Exports
export {
  createTableByZodObject,
  createTableByZodDiscriminatedUnion,
  syncTableColumnsWithZodObject,
  syncTableColumnsWithZodDiscriminatedUnion,
  tableExists,

  insertOne,
  insertMany,
  insertOneWithSchema,
  insertOneUnion,
  insertManyUnion,
  upsert,

  findById,
  findMany,
  findOne,
  findOneWithSchema,
  findManyWithSchema,
  count,
  exists,

  updateMany,
  updateManyWithSchema,
  updateManyUnion,
  updateAll,
  updateById,
  updateByIdWithSchema,

  deleteAll,
  deleteById,
  deleteByIdWithSchema,
  deleteMany,
  deleteManyWithSchema,

  toSQLiteValue,
  fromSQLiteRecord,
  isZodDiscriminatedUnion,
  splitUnionData,
  mergeUnionData,
}

// #endregion
