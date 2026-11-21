/**
 * Schema check: proves that the hand-written migrations and the TypeORM
 * entities describe the same database.
 *
 *   pnpm schema:check            run all checks (CI)
 *   pnpm schema:check --update   also rewrite src/database/schema.snapshot.txt
 *   pnpm schema:check --reference src/database/schema.reference.sql
 *                                also compare every migrated table with the
 *                                reference design (use until the baseline freeze)
 *
 * Steps
 *   1. Wipe the throw-away database (its name must end in _test or _ci).
 *   2. Run every migration (up).
 *   3. Compare every @Entity with the real tables: tables, columns, types,
 *      nullability, defaults, generated columns, primary keys, relations.
 *   4. Compare every CHECK value list in CHECK_VALUES with the database.
 *   5. Check names: no TypeORM hash names, prefixes pk_/fk_/uq_/chk_/idx_.
 *   6. Compare a text snapshot of the schema with the committed one, so a
 *      pull request shows exactly what changed in the database.
 *   6b. (--reference) Build the reference schema in a second database and
 *      compare each table that the migrations created, line by line.
 *   7. Roll every migration back (down) and check nothing is left behind,
 *      then run them all again (up) to prove they can be replayed.
 *
 * Exit code 1 on any problem, so CI fails.
 */
import "reflect-metadata";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { DataSource, EntityMetadata } from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import { dataSourceOptions } from "@/config/database.config";
import { CHECK_VALUES } from "@/common/constants/check-values";

const SNAPSHOT_FILE = join(__dirname, "../database/schema.snapshot.txt");
const IGNORE_TABLES = new Set(["migrations", "typeorm_metadata"]);
/** "table.column" pairs that exist in the database but are deliberately not mapped. */
const UNMAPPED_COLUMNS = new Set<string>([]);

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

type DbColumn = { tbl: string; col: string; type: string; notnull: boolean; gen: string; ident: string; def: string | null };

async function loadCatalog(ds: DataSource) {
  const tables: { name: string }[] = await ds.query(`
    SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition`);
  const columns: DbColumn[] = await ds.query(`
    SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS notnull, a.attgenerated AS gen, a.attidentity AS ident,
           pg_get_expr(d.adbin, d.adrelid) AS def
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND a.attnum > 0 AND NOT a.attisdropped`);
  const constraints: { tbl: string; name: string; type: string; cols: string[]; ref: string | null; def: string }[] =
    await ds.query(`
    SELECT c.relname AS tbl, k.conname AS name, k.contype AS type, r.relname AS ref,
           pg_get_constraintdef(k.oid) AS def,
           ARRAY(SELECT a.attname::text FROM unnest(k.conkey) AS u(n)
                 JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n) AS cols
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    LEFT JOIN pg_class r ON r.oid = k.confrelid
    WHERE k.connamespace = 'public'::regnamespace AND NOT c.relispartition`);
  const indexes: { tbl: string; name: string; def: string }[] = await ds.query(`
    SELECT i.tablename AS tbl, i.indexname AS name, i.indexdef AS def FROM pg_indexes i
    JOIN pg_class c ON c.relname = i.tablename AND c.relnamespace = 'public'::regnamespace
    WHERE i.schemaname = 'public' AND NOT c.relispartition`);
  return { tables, columns, constraints, indexes };
}

/** What PostgreSQL's format_type() should print for this entity column. */
function expectedType(ds: DataSource, c: ColumnMetadata): string {
  let t = ds.driver.normalizeType(c);
  if (t === "timestamptz") t = "timestamp with time zone";
  if (c.length && ["character varying", "character"].includes(t)) t += `(${c.length})`;
  if (c.precision != null && t === "numeric") t += `(${c.precision},${c.scale ?? 0})`;
  return c.isArray ? `${t}[]` : t;
}

function compareEntity(ds: DataSource, meta: EntityMetadata, cat: Awaited<ReturnType<typeof loadCatalog>>) {
  const t = meta.tableName;
  if (!cat.tables.some((x) => x.name === t)) return fail(`[${t}] entity ${meta.name} has no table (missing migration or wrong @Entity name)`);

  const dbCols = new Map(cat.columns.filter((c) => c.tbl === t).map((c) => [c.col, c]));
  const seen = new Set<string>();
  for (const c of meta.columns) {
    const name = c.databaseName;
    if (seen.has(name)) continue;
    seen.add(name);
    const db = dbCols.get(name);
    if (!db) { fail(`[${t}.${name}] in entity ${meta.name}.${c.propertyName} but not in the table`); continue; }

    const want = expectedType(ds, c);
    const got = (c.length || c.precision != null) ? db.type : db.type.replace(/\([^)]*\)/, "");
    if (want !== got) fail(`[${t}.${name}] type: entity says "${want}", database has "${db.type}"`);

    const entityNullable = c.isNullable && !c.isPrimary;
    if (entityNullable !== !db.notnull)
      fail(`[${t}.${name}] nullable: entity ${entityNullable ? "nullable" : "NOT NULL"}, database ${db.notnull ? "NOT NULL" : "nullable"}`);

    const dbGenerated = db.gen === "s";
    const entityGenerated = !!c.generatedType || (!c.isInsert && !c.isUpdate);
    if (dbGenerated && !entityGenerated)
      fail(`[${t}.${name}] is a generated column in the database; mark it { generatedType: "STORED", asExpression } or { insert: false, update: false }`);

    const needsDbDefault = c.default !== undefined || c.isCreateDate || c.isUpdateDate || (c.isGenerated && c.generationStrategy === "uuid");
    if (needsDbDefault && !db.def && !db.ident)
      fail(`[${t}.${name}] entity expects a database default (default/CreateDate/UpdateDate/generated uuid) but the column has none`);
    if (c.isGenerated && c.generationStrategy !== "uuid" && !db.ident && !(db.def ?? "").startsWith("nextval"))
      fail(`[${t}.${name}] entity says auto-increment but the column is not identity/serial`);
  }
  for (const col of dbCols.keys()) {
    if (!seen.has(col) && !UNMAPPED_COLUMNS.has(`${t}.${col}`))
      fail(`[${t}.${col}] in the table but not in entity ${meta.name} (typo, or add it to UNMAPPED_COLUMNS)`);
  }

  const pk = cat.constraints.find((k) => k.tbl === t && k.type === "p");
  const wantPk = meta.primaryColumns.map((c) => c.databaseName).sort().join(",");
  if (!pk) fail(`[${t}] has no primary key`);
  else if ([...pk.cols].sort().join(",") !== wantPk) fail(`[${t}] primary key: entity (${wantPk}), database (${pk.cols.join(",")})`);

  for (const rel of meta.relations) {
    if (!rel.isOwning || rel.joinColumns.length === 0) continue;
    const cols = rel.joinColumns.map((j) => j.databaseName);
    const target = rel.inverseEntityMetadata.tableName;
    const fk = cat.constraints.find((k) => k.tbl === t && k.type === "f" && k.ref === target && cols.every((c) => k.cols.includes(c)));
    if (!fk) fail(`[${t}] relation ${meta.name}.${rel.propertyName} -> ${target} (${cols.join(",")}) has no foreign key in the database`);
  }

  for (const idx of meta.indices) {
    if (idx.givenName && !cat.indexes.some((i) => i.name === idx.givenName))
      fail(`[${t}] entity declares index "${idx.givenName}" that the migrations never create`);
  }
}

function checkValueLists(cat: Awaited<ReturnType<typeof loadCatalog>>) {
  const tables = cat.tables.map((t) => t.name);
  let pending = 0;
  for (const [name, values] of Object.entries(CHECK_VALUES)) {
    const k = cat.constraints.find((c) => c.name === name && c.type === "c");
    if (!k) {
      // chk_<table>_<column>: if that table has no migration yet, the list is only pending.
      const owner = tables.some((t) => name.startsWith(`chk_${t}_`));
      if (owner) fail(`[check] ${name} is in CHECK_VALUES but its table has no such constraint`);
      else pending++;
      continue;
    }
    const inDb = new Set([...k.def.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]));
    const inCode = new Set(values);
    const missing = [...inCode].filter((v) => !inDb.has(v));
    const extra = [...inDb].filter((v) => !inCode.has(v));
    if (missing.length) fail(`[check] ${name}: code allows ${missing.join(", ")} but the database rejects it (write a migration)`);
    if (extra.length) fail(`[check] ${name}: database allows ${extra.join(", ")} but the code list does not`);
  }
  if (pending) console.log(`check lists: ${pending} wait for tables that have no migration yet`);
}

function checkNames(cat: Awaited<ReturnType<typeof loadCatalog>>) {
  const prefix: Record<string, string> = { p: "pk_", f: "fk_", u: "uq_", c: "chk_" };
  for (const k of cat.constraints) {
    if (IGNORE_TABLES.has(k.tbl) || !(k.type in prefix)) continue;
    if (!k.name.startsWith(prefix[k.type])) fail(`[name] ${k.tbl}: constraint "${k.name}" should start with ${prefix[k.type]} (give it a name in the migration)`);
  }
  const constraintNames = new Set(cat.constraints.map((k) => k.name));
  for (const i of cat.indexes) {
    if (IGNORE_TABLES.has(i.tbl) || constraintNames.has(i.name)) continue;
    if (!/^(idx|uq)_/.test(i.name)) fail(`[name] ${i.tbl}: index "${i.name}" should start with idx_ or uq_`);
  }
}

function snapshot(cat: Awaited<ReturnType<typeof loadCatalog>>, only?: Set<string>): string {
  const lines: string[] = [];
  for (const t of cat.tables.map((x) => x.name).filter((x) => !IGNORE_TABLES.has(x) && (!only || only.has(x))).sort()) {
    lines.push(`TABLE ${t}`);
    for (const c of cat.columns.filter((c) => c.tbl === t).sort((a, b) => a.col.localeCompare(b.col)))
      lines.push(`  col ${t}.${c.col} ${c.type}${c.notnull ? " not null" : ""}${c.def ? ` default ${c.def}` : ""}${c.gen === "s" ? " generated" : ""}${c.ident ? " identity" : ""}`);
    for (const k of cat.constraints.filter((k) => k.tbl === t).sort((a, b) => a.name.localeCompare(b.name)))
      lines.push(`  con ${t}.${k.name} ${k.def}`);
    for (const i of cat.indexes.filter((i) => i.tbl === t).sort((a, b) => a.name.localeCompare(b.name)))
      lines.push(`  idx ${t}.${i.name} ${i.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON public\.\S+ /, "$1")}`);
  }
  return lines.join("\n") + "\n";
}

async function compareWithReference(ds: DataSource, cat: Awaited<ReturnType<typeof loadCatalog>>, file: string, dbName: string) {
  const refDb = `${dbName}_ref`;
  await ds.query(`DROP DATABASE IF EXISTS "${refDb}"`);
  await ds.query(`CREATE DATABASE "${refDb}"`);
  const ref = new DataSource({ ...dataSourceOptions, database: refDb, entities: [], migrations: [] } as any);
  await ref.initialize();
  try {
    await ref.query(readFileSync(file, "utf8"));
    const refCat = await loadCatalog(ref);
    const migrated = new Set(cat.tables.map((t) => t.name).filter((t) => !IGNORE_TABLES.has(t)));
    const refTables = new Set(refCat.tables.map((t) => t.name));
    for (const t of migrated) if (!refTables.has(t)) fail(`[reference] table ${t} is not in the reference schema`);
    const mine = snapshot(cat, migrated).split("\n"), theirs = snapshot(refCat, migrated).split("\n");
    const missing = theirs.filter((l) => !mine.includes(l)), extra = mine.filter((l) => !theirs.includes(l));
    if (missing.length || extra.length)
      fail(`[reference] migrated tables differ from the reference ( - only in reference, + only in migrations):\n` +
        missing.map((l) => `      - ${l.trim()}`).concat(extra.map((l) => `      + ${l.trim()}`)).join("\n"));
    const todo = [...refTables].filter((t) => !migrated.has(t));
    console.log(`reference: ${migrated.size} tables compared, ${todo.length} not migrated yet`);
  } finally {
    await ref.destroy();
    await ds.query(`DROP DATABASE IF EXISTS "${refDb}"`);
  }
}

async function leftovers(ds: DataSource): Promise<string[]> {
  const rows: { what: string }[] = await ds.query(`
    SELECT 'relation ' || c.relname AS what FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname NOT LIKE 'migrations%'
      AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = c.oid AND i.indrelid = 'migrations'::regclass)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'function ' || p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'type ' || t.typname FROM pg_type t
    WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e','d','c') AND t.typrelid = 0
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'extension ' || e.extname FROM pg_extension e WHERE e.extname <> 'plpgsql'`);
  return rows.map((r) => r.what);
}

async function main() {
  const update = process.argv.includes("--update");
  // Works the same on Windows and Linux: with DB_DATABASE=visionguard it uses
  // visionguard_test; in CI DB_DATABASE already ends in _ci.
  const base = String(dataSourceOptions.database ?? "");
  const dbName = process.env.SCHEMA_CHECK_DB ?? (/_(test|ci)$/.test(base) ? base : `${base}_test`);
  if (!/_(test|ci)$/.test(dbName)) throw new Error(`Refusing to run: database "${dbName}" must end in _test or _ci (this script wipes it).`);
  console.log(`schema check on database ${dbName}`);

  const ds = new DataSource({ ...dataSourceOptions, database: dbName, migrationsTransactionMode: "each" } as any);
  await ds.initialize();
  try {
    await ds.query(`DROP SCHEMA public CASCADE`);
    await ds.query(`CREATE SCHEMA public`);

    // TypeORM runs migrations by timestamp; duplicates would make the order unclear.
    const stamps = ds.migrations.map((m) => (m.name ?? m.constructor.name).match(/(\d{13})$/)?.[1]);
    if (stamps.some((s) => !s)) fail(`[migrations] every migration class name must end with a 13-digit timestamp`);
    const dup = stamps.filter((s, i) => s && stamps.indexOf(s) !== i);
    if (dup.length) fail(`[migrations] duplicate timestamps: ${dup.join(", ")}`);

    const ran = await ds.runMigrations({ transaction: "each" });
    console.log(`up: ${ran.length} migrations`);

    const cat = await loadCatalog(ds);
    for (const meta of ds.entityMetadatas) compareEntity(ds, meta, cat);
    const mapped = new Set(ds.entityMetadatas.map((m) => m.tableName));
    for (const { name } of cat.tables)
      if (!IGNORE_TABLES.has(name) && !mapped.has(name)) fail(`[${name}] table has no entity (add one, or a migration created a table by mistake)`);
    checkValueLists(cat);
    checkNames(cat);

    const snap = snapshot(cat);
    if (update) { writeFileSync(SNAPSHOT_FILE, snap); console.log(`snapshot written: ${SNAPSHOT_FILE}`); }
    else if (!existsSync(SNAPSHOT_FILE)) fail(`[snapshot] ${SNAPSHOT_FILE} missing: run with --update and commit it`);
    else {
      const old = readFileSync(SNAPSHOT_FILE, "utf8").split("\n"), now = snap.split("\n");
      const removed = old.filter((l) => !now.includes(l)), added = now.filter((l) => !old.includes(l));
      if (removed.length || added.length)
        fail(`[snapshot] schema differs from the committed snapshot (run with --update and commit):\n` +
          removed.map((l) => `      - ${l.trim()}`).concat(added.map((l) => `      + ${l.trim()}`)).join("\n"));
    }

    const refIdx = process.argv.indexOf("--reference");
    if (refIdx > 0) await compareWithReference(ds, cat, process.argv[refIdx + 1], dbName);

    // down all, then up again
    let undone = 0;
    // TypeORM's undo ignores a migration's own `transaction = false`, so pick the mode per migration.
    for (;;) {
      const [last] = await ds.query(`SELECT name FROM migrations ORDER BY id DESC LIMIT 1`);
      if (!last) break;
      const inst = ds.migrations.find((m) => (m.name ?? m.constructor.name) === last.name);
      await ds.undoLastMigration({ transaction: inst?.transaction === false ? "none" : "each" });
      undone++;
    }
    const left = await leftovers(ds);
    if (left.length) fail(`[down] after rolling back ${undone} migrations these are still there (a down() is incomplete): ${left.join(", ")}`);
    await ds.runMigrations({ transaction: "each" });
    console.log(`down: ${undone} migrations, up again: ok`);
  } catch (e: any) {
    fail(`[run] ${e.message}`);
  } finally {
    await ds.destroy();
  }

  if (errors.length) {
    console.error(`\nschema check FAILED (${errors.length}):\n` + errors.map((e) => `  - ${e}`).join("\n"));
    process.exitCode = 1;
  } else console.log("schema check passed");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
