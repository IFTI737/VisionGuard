import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Mahir. Tables: sites, site_members, areas, member_area_scopes, audit_logs.
// Follows src/database/schema.reference.sql (section 1790000002000-tenancy).
// Value lists are written out here on purpose: a migration never imports app code.
export class Tenancy1790000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "sites",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_sites", default: "gen_random_uuid()" },
          { name: "name", type: "text" },
          { name: "kind", type: "text" },
          { name: "timezone", type: "text", default: "'Asia/Dhaka'" },
          { name: "address", type: "text", isNullable: true },
          { name: "sensitivity", type: "smallint", default: "2" },
          { name: "mode", type: "text", default: "'armed'" },
          { name: "paused_until", type: "timestamptz", isNullable: true },
          { name: "digest_time", type: "time", default: "'07:00:00'" },
          { name: "share_training_data", type: "boolean", default: "false" },
          { name: "status", type: "text", default: "'active'" },
          { name: "created_by", type: "uuid", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
          { name: "deleted_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_sites_created_by", columnNames: ["created_by"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "SET NULL" },
        ],
        checks: [
          { name: "chk_sites_kind", expression: "kind IN ('home', 'farm', 'construction', 'shop', 'workplace', 'other')" },
          { name: "chk_sites_mode", expression: "mode IN ('armed', 'paused')" },
          { name: "chk_sites_paused_until", expression: "(mode = 'paused') = (paused_until IS NOT NULL)" },
          { name: "chk_sites_sensitivity", expression: "(sensitivity >= 1) AND (sensitivity <= 3)" },
          { name: "chk_sites_status", expression: "status IN ('active', 'suspended', 'deleted')" },
        ],
        indices: [
          { name: "idx_sites_status", columnNames: ["status"], where: "status <> 'active'" },
        ],
      }),
    );
    await queryRunner.query(`CREATE INDEX idx_sites_name_trgm ON sites USING gin (name gin_trgm_ops)`);

    await queryRunner.createTable(
      new Table({
        name: "site_members",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_site_members", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "user_id", type: "uuid", isNullable: true },
          { name: "role", type: "text" },
          { name: "status", type: "text", default: "'active'" },
          { name: "display_name", type: "text" },
          { name: "phone", type: "text", isNullable: true },
          { name: "permissions", type: "text", isArray: true, default: "'{}'::text[]" },
          { name: "all_areas", type: "boolean", default: "true" },
          { name: "call_priority", type: "smallint", isNullable: true },
          { name: "notify_prefs", type: "jsonb", default: "'{}'::jsonb" },
          { name: "invited_by", type: "uuid", isNullable: true },
          { name: "invite_token_hash", type: "bytea", isNullable: true },
          { name: "invited_at", type: "timestamptz", isNullable: true },
          { name: "joined_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_site_members_invited_by", columnNames: ["invited_by"], referencedTableName: "site_members", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_site_members_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_site_members_user_id", columnNames: ["user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_site_members_site_id_id", columnNames: ["site_id", "id"] },
        ],
        checks: [
          { name: "chk_site_members_call_priority", expression: "call_priority > 0" },
          { name: "chk_site_members_contact_no_user", expression: "(role <> 'contact') OR (user_id IS NULL)" },
          { name: "chk_site_members_owner_has_user", expression: "(role <> 'owner') OR (user_id IS NOT NULL)" },
          { name: "chk_site_members_role", expression: "role IN ('owner', 'manager', 'guard', 'viewer', 'contact')" },
          { name: "chk_site_members_status", expression: "status IN ('invited', 'active', 'removed')" },
          { name: "chk_site_members_user_or_phone", expression: "(user_id IS NOT NULL) OR (phone IS NOT NULL)" },
        ],
        indices: [
          { name: "idx_site_members_by_user", columnNames: ["user_id"], where: "status = 'active'" },
          { name: "uq_site_members_call", columnNames: ["site_id", "call_priority"], isUnique: true, where: "(call_priority IS NOT NULL) AND (status = 'active')" },
          { name: "uq_site_members_one_owner", columnNames: ["site_id"], isUnique: true, where: "(role = 'owner') AND (status = 'active')" },
          { name: "uq_site_members_phone", columnNames: ["site_id", "phone"], isUnique: true, where: "(phone IS NOT NULL) AND (status <> 'removed')" },
          { name: "uq_site_members_user", columnNames: ["site_id", "user_id"], isUnique: true, where: "(user_id IS NOT NULL) AND (status <> 'removed')" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "areas",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_areas", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "name", type: "text" },
          { name: "sort_order", type: "smallint", default: "0" },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_areas_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_areas_site_id_id", columnNames: ["site_id", "id"] },
          { name: "uq_areas_site_id_name", columnNames: ["site_id", "name"] },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "member_area_scopes",
        columns: [
          { name: "site_id", type: "uuid" },
          { name: "member_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_member_area_scopes" },
          { name: "area_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_member_area_scopes" },
        ],
        foreignKeys: [
          { name: "fk_member_area_scopes_area_id", columnNames: ["site_id", "area_id"], referencedTableName: "areas", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
          { name: "fk_member_area_scopes_member_id", columnNames: ["site_id", "member_id"], referencedTableName: "site_members", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
        ],
        indices: [
          { name: "idx_member_area_scopes_area", columnNames: ["area_id"] },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "audit_logs",
        columns: [
          { name: "id", type: "bigint", isPrimary: true, primaryKeyConstraintName: "pk_audit_logs", isGenerated: true, generationStrategy: "identity", generatedIdentity: "ALWAYS" },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "site_id", type: "uuid", isNullable: true },
          { name: "actor_kind", type: "text" },
          { name: "actor_id", type: "uuid", isNullable: true },
          { name: "action", type: "text" },
          { name: "entity_type", type: "text", isNullable: true },
          { name: "entity_id", type: "uuid", isNullable: true },
          { name: "ip", type: "inet", isNullable: true },
          { name: "data", type: "jsonb", default: "'{}'::jsonb" },
        ],
        checks: [
          { name: "chk_audit_logs_actor_kind", expression: "actor_kind IN ('user', 'staff', 'device', 'system')" },
        ],
        indices: [
          { name: "idx_audit_logs_created", columnNames: ["created_at"] },
          { name: "idx_audit_logs_entity", columnNames: ["entity_type", "entity_id"] },
        ],
      }),
    );
    await queryRunner.query(`CREATE INDEX idx_audit_logs_site ON audit_logs USING btree (site_id, created_at DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("audit_logs");
    await queryRunner.dropTable("member_area_scopes");
    await queryRunner.dropTable("areas");
    await queryRunner.dropTable("site_members");
    await queryRunner.dropTable("sites");
  }
}
