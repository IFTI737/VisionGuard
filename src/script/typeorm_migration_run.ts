import { dataSourceOptions } from "@/config/database.config";
import { DataSource } from "typeorm";
import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";

// Same job as sir's script, plus: one transaction per migration (so a migration
// may set `transaction = false` for CREATE INDEX CONCURRENTLY), the connection
// is closed, and a failure exits with code 1 so CI and deploys stop.
const migrateRun = async () => {
  console.log(`Migrating.....`);
  const ds = new DataSource({ ...dataSourceOptions } as PostgresConnectionOptions);
  try {
    await ds.initialize();
    const done = await ds.runMigrations({ transaction: "each" });
    console.log(done.length ? `migration completed: ${done.map((m) => m.name).join(", ")}` : "nothing to migrate");
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (ds.isInitialized) await ds.destroy();
  }
};

migrateRun();
