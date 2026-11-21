import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Iftekhar. Tables: zone_metric_minutes, zone_metric_hours, zone_baselines.
// Follows src/database/schema.reference.sql (section 1790000006000-time-series).
// Value lists are written out here on purpose: a migration never imports app code.
export class TimeSeries1790000006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A partitioned table: TypeORM's Table helper cannot create partitions, so this is raw SQL.
    await queryRunner.query(`
      CREATE TABLE zone_metric_minutes (
        site_id    uuid NOT NULL,
        zone_id    uuid NOT NULL,
        metric_key text NOT NULL,
        bucket     timestamptz NOT NULL,
        n          smallint NOT NULL,
        sum        double precision NOT NULL,
        min        real NOT NULL,
        max        real NOT NULL,
        sumsq      double precision NOT NULL,
        CONSTRAINT pk_zone_metric_minutes PRIMARY KEY (zone_id, metric_key, bucket),
        CONSTRAINT fk_zone_metric_minutes_zone_id FOREIGN KEY (site_id, zone_id)
          REFERENCES zones(site_id, id) ON DELETE CASCADE
      ) PARTITION BY RANGE (bucket)`);
    // One partition per day. The daily job calls this for the next 3 days.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION vg_ensure_minute_partition(day date) RETURNS void
      LANGUAGE plpgsql AS $$
      DECLARE part text := 'zone_metric_minutes_' || to_char(day, 'YYYYMMDD');
      BEGIN
        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS %I PARTITION OF zone_metric_minutes FOR VALUES FROM (%L) TO (%L)',
          part, day::timestamptz, (day + 1)::timestamptz);
      END $$`);
    // Safety net: rows for a day without a partition land here instead of failing.
    await queryRunner.query(`CREATE TABLE zone_metric_minutes_default PARTITION OF zone_metric_minutes DEFAULT`);
    await queryRunner.query(`SELECT vg_ensure_minute_partition(current_date + d) FROM generate_series(0, 2) AS d`);
    await queryRunner.createTable(
      new Table({
        name: "zone_metric_hours",
        columns: [
          { name: "site_id", type: "uuid" },
          { name: "zone_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_zone_metric_hours" },
          { name: "metric_key", type: "text", isPrimary: true, primaryKeyConstraintName: "pk_zone_metric_hours" },
          { name: "bucket", type: "timestamptz", isPrimary: true, primaryKeyConstraintName: "pk_zone_metric_hours" },
          { name: "n", type: "integer" },
          { name: "sum", type: "double precision" },
          { name: "min", type: "real" },
          { name: "max", type: "real" },
          { name: "sumsq", type: "double precision" },
        ],
        foreignKeys: [
          { name: "fk_zone_metric_hours_zone_id", columnNames: ["site_id", "zone_id"], referencedTableName: "zones", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
        ],
        indices: [
          { name: "idx_zone_metric_hours_site", columnNames: ["site_id", "bucket"] },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "zone_baselines",
        columns: [
          { name: "zone_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_zone_baselines" },
          { name: "metric_key", type: "text", isPrimary: true, primaryKeyConstraintName: "pk_zone_baselines" },
          { name: "hour_of_week", type: "smallint", isPrimary: true, primaryKeyConstraintName: "pk_zone_baselines" },
          { name: "n_weeks", type: "smallint" },
          { name: "median", type: "real" },
          { name: "mad", type: "real" },
          { name: "mean", type: "real" },
          { name: "std", type: "real" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_zone_baselines_zone_id", columnNames: ["zone_id"], referencedTableName: "zones", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        checks: [
          { name: "chk_zone_baselines_hour_of_week", expression: "(hour_of_week >= 0) AND (hour_of_week <= 167)" },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("zone_baselines");
    await queryRunner.dropTable("zone_metric_hours");
    await queryRunner.query(`DROP TABLE IF EXISTS zone_metric_minutes CASCADE`); // also drops its partitions
    await queryRunner.query(`DROP FUNCTION IF EXISTS vg_ensure_minute_partition(date)`);
  }
}
