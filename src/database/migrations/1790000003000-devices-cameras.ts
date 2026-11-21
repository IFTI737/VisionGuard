import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Iftekhar. Tables: devices, device_credentials, cameras, zones.
// Follows src/database/schema.reference.sql (section 1790000003000-devices-cameras).
// Value lists are written out here on purpose: a migration never imports app code.
export class DevicesCameras1790000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "devices",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_devices", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "kind", type: "text" },
          { name: "name", type: "text" },
          { name: "status", type: "text", default: "'pending'" },
          { name: "time_mode", type: "text", default: "'wall'" },
          { name: "sw_version", type: "text", isNullable: true },
          { name: "capabilities", type: "jsonb", default: "'{}'::jsonb" },
          { name: "config_version", type: "integer", default: "1" },
          { name: "last_seen_at", type: "timestamptz", isNullable: true },
          { name: "last_ip", type: "inet", isNullable: true },
          { name: "created_by", type: "uuid", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_devices_created_by", columnNames: ["created_by"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_devices_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_devices_site_id_id", columnNames: ["site_id", "id"] },
        ],
        checks: [
          { name: "chk_devices_event_time_simulator_only", expression: "(time_mode = 'wall') OR (kind = 'simulator')" },
          { name: "chk_devices_kind", expression: "kind IN ('browser', 'simulator', 'gateway', 'cloud_worker')" },
          { name: "chk_devices_status", expression: "status IN ('pending', 'active', 'disabled')" },
          { name: "chk_devices_time_mode", expression: "time_mode IN ('wall', 'event')" },
        ],
        indices: [
          { name: "idx_devices_site", columnNames: ["site_id"] },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "device_credentials",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_device_credentials", default: "gen_random_uuid()" },
          { name: "device_id", type: "uuid" },
          { name: "key_prefix", type: "text" },
          { name: "key_hash", type: "bytea" },
          { name: "label", type: "text", isNullable: true },
          { name: "expires_at", type: "timestamptz", isNullable: true },
          { name: "revoked_at", type: "timestamptz", isNullable: true },
          { name: "last_used_at", type: "timestamptz", isNullable: true },
          { name: "created_by", type: "uuid", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_device_credentials_created_by", columnNames: ["created_by"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_device_credentials_device_id", columnNames: ["device_id"], referencedTableName: "devices", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_device_credentials_key_prefix", columnNames: ["key_prefix"] },
        ],
        indices: [
          { name: "idx_device_credentials_device", columnNames: ["device_id"], where: "revoked_at IS NULL" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "cameras",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_cameras", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "area_id", type: "uuid" },
          { name: "device_id", type: "uuid", isNullable: true },
          { name: "name", type: "text" },
          { name: "source_kind", type: "text" },
          { name: "source_ref", type: "text", isNullable: true },
          { name: "recording_mode", type: "text", default: "'incident_only'" },
          { name: "status", type: "text", default: "'pending'" },
          { name: "last_seen_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
          { name: "deleted_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_cameras_area_id", columnNames: ["site_id", "area_id"], referencedTableName: "areas", referencedColumnNames: ["site_id", "id"], onDelete: "RESTRICT" },
          { name: "fk_cameras_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_cameras_site_id_id", columnNames: ["site_id", "id"] },
        ],
        checks: [
          { name: "chk_cameras_recording_mode", expression: "recording_mode IN ('off', 'continuous', 'incident_only')" },
          { name: "chk_cameras_source_kind", expression: "source_kind IN ('browser', 'rtsp', 'simulator')" },
          { name: "chk_cameras_status", expression: "status IN ('pending', 'online', 'offline', 'no_signal', 'tampered', 'disabled')" },
        ],
        indices: [
          { name: "idx_cameras_area", columnNames: ["area_id"], where: "deleted_at IS NULL" },
          { name: "idx_cameras_device", columnNames: ["device_id"], where: "deleted_at IS NULL" },
          { name: "uq_cameras_name", columnNames: ["site_id", "name"], isUnique: true, where: "deleted_at IS NULL" },
        ],
      }),
    );
    await queryRunner.query(`ALTER TABLE cameras ADD CONSTRAINT fk_cameras_device_id FOREIGN KEY (site_id, device_id) REFERENCES devices(site_id, id) ON DELETE SET NULL (device_id)`);

    await queryRunner.createTable(
      new Table({
        name: "zones",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_zones", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "camera_id", type: "uuid" },
          { name: "name", type: "text" },
          { name: "kind", type: "text", default: "'general'" },
          { name: "polygon", type: "jsonb" },
          { name: "anchor", type: "text", default: "'foot'" },
          { name: "min_overlap", type: "real", default: "0.35" },
          { name: "enabled", type: "boolean", default: "true" },
          { name: "muted_until", type: "timestamptz", isNullable: true },
          { name: "version", type: "integer", default: "1" },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
          { name: "deleted_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_zones_camera_id", columnNames: ["site_id", "camera_id"], referencedTableName: "cameras", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_zones_site_id_id", columnNames: ["site_id", "id"] },
        ],
        checks: [
          { name: "chk_zones_anchor", expression: "anchor IN ('foot', 'center', 'overlap')" },
          { name: "chk_zones_kind", expression: "kind IN ('general', 'restricted', 'shed', 'work', 'shelf', 'stock', 'entrance', 'guard_post')" },
          { name: "chk_zones_min_overlap", expression: "(min_overlap > (0)::double precision) AND (min_overlap <= (1)::double precision)" },
          { name: "chk_zones_polygon_shape", expression: "(jsonb_typeof(polygon) = 'array') AND ((jsonb_array_length(polygon) >= 3) AND (jsonb_array_length(polygon) <= 32))" },
        ],
        indices: [
          { name: "idx_zones_camera", columnNames: ["camera_id"], where: "deleted_at IS NULL" },
          { name: "uq_zones_name", columnNames: ["camera_id", "name"], isUnique: true, where: "deleted_at IS NULL" },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("zones");
    await queryRunner.dropTable("cameras");
    await queryRunner.dropTable("device_credentials");
    await queryRunner.dropTable("devices");
  }
}
