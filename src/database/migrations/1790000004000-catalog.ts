import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Mahir. Tables: object_classes, ai_models, model_classes, packs, pack_models, rule_templates.
// Follows src/database/schema.reference.sql (section 1790000004000-catalog).
// Value lists are written out here on purpose: a migration never imports app code.
export class Catalog1790000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "object_classes",
        columns: [
          { name: "code", type: "text", isPrimary: true, primaryKeyConstraintName: "pk_object_classes" },
          { name: "kind", type: "text" },
          { name: "parent_code", type: "text", isNullable: true },
          { name: "name_en", type: "text" },
          { name: "name_bn", type: "text" },
        ],
        foreignKeys: [
          { name: "fk_object_classes_parent_code", columnNames: ["parent_code"], referencedTableName: "object_classes", referencedColumnNames: ["code"], onDelete: "SET NULL" },
        ],
        checks: [
          { name: "chk_object_classes_kind", expression: "kind IN ('object', 'attribute', 'measure')" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "ai_models",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_ai_models", default: "gen_random_uuid()" },
          { name: "code", type: "text" },
          { name: "version", type: "text" },
          { name: "task", type: "text" },
          { name: "runtime", type: "text" },
          { name: "stage", type: "smallint", default: "1" },
          { name: "trigger_class_code", type: "text", isNullable: true },
          { name: "output_kind", type: "text" },
          { name: "artifact_url", type: "text", isNullable: true },
          { name: "artifact_sha256", type: "text", isNullable: true },
          { name: "input_size", type: "integer", default: "640" },
          { name: "default_conf", type: "real", default: "0.35" },
          { name: "default_interval_ms", type: "integer", default: "1000" },
          { name: "status", type: "text", default: "'active'" },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_ai_models_trigger_class_code", columnNames: ["trigger_class_code"], referencedTableName: "object_classes", referencedColumnNames: ["code"], onDelete: "RESTRICT" },
        ],
        uniques: [
          { name: "uq_ai_models_code_version", columnNames: ["code", "version"] },
        ],
        checks: [
          { name: "chk_ai_models_default_conf", expression: "(default_conf > (0)::double precision) AND (default_conf < (1)::double precision)" },
          { name: "chk_ai_models_default_interval_ms", expression: "default_interval_ms >= 100" },
          { name: "chk_ai_models_output_kind", expression: "output_kind IN ('boxes', 'attrs', 'measure')" },
          { name: "chk_ai_models_runtime", expression: "runtime IN ('onnx_web', 'onnx', 'tensorrt', 'openvino', 'remote')" },
          { name: "chk_ai_models_stage", expression: "stage IN (1, 2)" },
          { name: "chk_ai_models_stage_trigger", expression: "((stage = 2) = (trigger_class_code IS NOT NULL)) OR (output_kind = 'measure')" },
          { name: "chk_ai_models_status", expression: "status IN ('planned', 'active', 'retired')" },
          { name: "chk_ai_models_task", expression: "task IN ('detect', 'classify', 'pose', 'segment', 'count')" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "model_classes",
        columns: [
          { name: "model_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_model_classes" },
          { name: "class_code", type: "text", isPrimary: true, primaryKeyConstraintName: "pk_model_classes" },
          { name: "class_index", type: "smallint" },
          { name: "default_conf", type: "real", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_model_classes_class_code", columnNames: ["class_code"], referencedTableName: "object_classes", referencedColumnNames: ["code"], onDelete: "RESTRICT" },
          { name: "fk_model_classes_model_id", columnNames: ["model_id"], referencedTableName: "ai_models", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_model_classes_model_id_class_index", columnNames: ["model_id", "class_index"] },
        ],
        checks: [
          { name: "chk_model_classes_default_conf", expression: "(default_conf > (0)::double precision) AND (default_conf < (1)::double precision)" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "packs",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_packs", default: "gen_random_uuid()" },
          { name: "code", type: "text" },
          { name: "name", type: "text" },
          { name: "description", type: "text", isNullable: true },
          { name: "is_default", type: "boolean", default: "false" },
          { name: "custom_site_id", type: "uuid", isNullable: true },
          { name: "addon_price_minor", type: "integer", default: "0" },
          { name: "manifest", type: "jsonb", default: "'{}'::jsonb" },
          { name: "status", type: "text", default: "'active'" },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_packs_custom_site_id", columnNames: ["custom_site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_packs_code", columnNames: ["code"] },
        ],
        checks: [
          { name: "chk_packs_addon_price_minor", expression: "addon_price_minor >= 0" },
          { name: "chk_packs_status", expression: "status IN ('draft', 'active', 'retired')" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "pack_models",
        columns: [
          { name: "pack_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_pack_models" },
          { name: "model_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_pack_models" },
          { name: "required", type: "boolean", default: "true" },
        ],
        foreignKeys: [
          { name: "fk_pack_models_model_id", columnNames: ["model_id"], referencedTableName: "ai_models", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
          { name: "fk_pack_models_pack_id", columnNames: ["pack_id"], referencedTableName: "packs", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "rule_templates",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_rule_templates", default: "gen_random_uuid()" },
          { name: "pack_id", type: "uuid" },
          { name: "code", type: "text" },
          { name: "name", type: "text" },
          { name: "description", type: "text", isNullable: true },
          { name: "kind", type: "text" },
          { name: "default_params", type: "jsonb" },
          { name: "param_schema", type: "jsonb" },
          { name: "default_severity", type: "text" },
          { name: "default_schedule", type: "jsonb", isNullable: true },
          { name: "default_sustain_s", type: "integer", default: "10" },
          { name: "default_clear_s", type: "integer", default: "30" },
          { name: "default_cooldown_s", type: "integer", default: "300" },
          { name: "zone_kinds", type: "text", isArray: true, default: "'{}'::text[]" },
          { name: "required_classes", type: "text", isArray: true, default: "'{}'::text[]" },
          { name: "auto_provision", type: "boolean", default: "false" },
          { name: "i18n", type: "jsonb", default: "'{}'::jsonb" },
          { name: "status", type: "text", default: "'active'" },
        ],
        foreignKeys: [
          { name: "fk_rule_templates_pack_id", columnNames: ["pack_id"], referencedTableName: "packs", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_rule_templates_pack_id_code", columnNames: ["pack_id", "code"] },
        ],
        checks: [
          { name: "chk_rule_templates_default_clear_s", expression: "default_clear_s >= 0" },
          { name: "chk_rule_templates_default_cooldown_s", expression: "default_cooldown_s >= 0" },
          { name: "chk_rule_templates_default_severity", expression: "default_severity IN ('low', 'medium', 'high', 'critical')" },
          { name: "chk_rule_templates_default_sustain_s", expression: "default_sustain_s >= 0" },
          { name: "chk_rule_templates_kind", expression: "kind IN ('presence', 'count_range', 'attribute_missing', 'proximity', 'measure_threshold', 'delta', 'anomaly', 'device_health')" },
          { name: "chk_rule_templates_status", expression: "status IN ('draft', 'active', 'retired')" },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("rule_templates");
    await queryRunner.dropTable("pack_models");
    await queryRunner.dropTable("packs");
    await queryRunner.dropTable("model_classes");
    await queryRunner.dropTable("ai_models");
    await queryRunner.dropTable("object_classes");
  }
}
