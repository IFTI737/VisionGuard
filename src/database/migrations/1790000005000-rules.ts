import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Iftekhar. Tables: model_assignments, rules.
// Follows src/database/schema.reference.sql (section 1790000005000-rules).
// Value lists are written out here on purpose: a migration never imports app code.
export class Rules1790000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "model_assignments",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_model_assignments", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "camera_id", type: "uuid" },
          { name: "model_id", type: "uuid" },
          { name: "active_when", type: "text", default: "'always'" },
          { name: "frame_interval_ms", type: "integer", default: "1000" },
          { name: "conf_overrides", type: "jsonb", default: "'{}'::jsonb" },
          { name: "enabled", type: "boolean", default: "true" },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_model_assignments_camera_id", columnNames: ["site_id", "camera_id"], referencedTableName: "cameras", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
          { name: "fk_model_assignments_model_id", columnNames: ["model_id"], referencedTableName: "ai_models", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
        ],
        uniques: [
          { name: "uq_model_assignments_camera_id_model_id_active_when", columnNames: ["camera_id", "model_id", "active_when"] },
        ],
        checks: [
          { name: "chk_model_assignments_active_when", expression: "active_when IN ('always', 'day', 'night', 'lowlight')" },
          { name: "chk_model_assignments_frame_interval_ms", expression: "frame_interval_ms >= 100" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "rules",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_rules", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "zone_id", type: "uuid", isNullable: true },
          { name: "camera_id", type: "uuid", isNullable: true },
          { name: "template_id", type: "uuid" },
          { name: "name", type: "text" },
          { name: "params", type: "jsonb" },
          { name: "severity", type: "text" },
          { name: "schedule", type: "jsonb", isNullable: true },
          { name: "sustain_s", type: "integer" },
          { name: "clear_s", type: "integer" },
          { name: "cooldown_s", type: "integer" },
          { name: "enabled", type: "boolean", default: "true" },
          { name: "muted_until", type: "timestamptz", isNullable: true },
          { name: "version", type: "integer", default: "1" },
          { name: "created_by", type: "uuid", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
          { name: "deleted_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_rules_camera_id", columnNames: ["site_id", "camera_id"], referencedTableName: "cameras", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
          { name: "fk_rules_created_by", columnNames: ["created_by"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_rules_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_rules_template_id", columnNames: ["template_id"], referencedTableName: "rule_templates", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
          { name: "fk_rules_zone_id", columnNames: ["site_id", "zone_id"], referencedTableName: "zones", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_rules_site_id_id", columnNames: ["site_id", "id"] },
        ],
        checks: [
          { name: "chk_rules_clear_s", expression: "clear_s >= 0" },
          { name: "chk_rules_cooldown_s", expression: "cooldown_s >= 0" },
          { name: "chk_rules_one_target", expression: "num_nonnulls(zone_id, camera_id) = 1" },
          { name: "chk_rules_severity", expression: "severity IN ('low', 'medium', 'high', 'critical')" },
          { name: "chk_rules_sustain_s", expression: "sustain_s >= 0" },
        ],
        indices: [
          { name: "idx_rules_camera", columnNames: ["camera_id"], where: "(deleted_at IS NULL) AND enabled" },
          { name: "idx_rules_site", columnNames: ["site_id"], where: "deleted_at IS NULL" },
          { name: "idx_rules_zone", columnNames: ["zone_id"], where: "(deleted_at IS NULL) AND enabled" },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("rules");
    await queryRunner.dropTable("model_assignments");
  }
}
