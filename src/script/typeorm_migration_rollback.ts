import { dataSourceOptions } from "@/config/database.config";
import { DataSource } from "typeorm";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";

// Rolls back the last migration, or all of them with --all (replaces both of
// sir's rollback scripts; his "rollbackAll" loop did not await, so it fired
// every undo at once). TypeORM's undo ignores a migration's own
// `transaction = false`, so the mode is chosen per migration here.
const rollback = async () => {
  const all = process.argv.includes("--all");
  const ds = new DataSource({ ...dataSourceOptions } as PostgresConnectionOptions);
  try {
    await ds.initialize();
    for (;;) {
      const [last] = await ds.query(`SELECT name FROM migrations ORDER BY id DESC LIMIT 1`);
      if (!last) { console.log("nothing to roll back"); break; }
      const inst = ds.migrations.find((m) => (m.name ?? m.constructor.name) === last.name);
      await ds.undoLastMigration({ transaction: inst?.transaction === false ? "none" : "each" });
      console.log(`rolled back ${last.name}`);
      if (!all) break;
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
};

rollback();
