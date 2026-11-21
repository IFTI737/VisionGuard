import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Mahir. Tables: users, refresh_tokens, auth_codes, notification_endpoints.
// Follows src/database/schema.reference.sql (section 1790000001000-identity).
// Value lists are written out here on purpose: a migration never imports app code.
export class Identity1790000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "users",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_users", default: "gen_random_uuid()" },
          { name: "name", type: "text" },
          { name: "email", type: "text" },
          { name: "email_verified_at", type: "timestamptz", isNullable: true },
          { name: "phone_number", type: "text", isNullable: true },
          { name: "phone_verified_at", type: "timestamptz", isNullable: true },
          { name: "password_hash", type: "text" },
          { name: "two_factor_enabled", type: "boolean", default: "false" },
          { name: "token_version", type: "integer", default: "0" },
          { name: "platform_role", type: "text", default: "'customer'" },
          { name: "status", type: "text", default: "'active'" },
          { name: "locale", type: "text", default: "'bn'" },
          { name: "last_login_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
        ],
        checks: [
          { name: "chk_users_email_lower", expression: "email = lower(email)" },
          { name: "chk_users_locale", expression: "locale IN ('bn', 'en')" },
          { name: "chk_users_platform_role", expression: "platform_role IN ('customer', 'support', 'admin')" },
          { name: "chk_users_status", expression: "status IN ('active', 'disabled')" },
        ],
        indices: [
          { name: "idx_users_staff", columnNames: ["platform_role"], where: "platform_role <> 'customer'" },
          { name: "uq_users_email", columnNames: ["email"], isUnique: true },
          { name: "uq_users_phone_number", columnNames: ["phone_number"], isUnique: true, where: "phone_number IS NOT NULL" },
        ],
      }),
    );
    await queryRunner.query(`CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops)`);

    await queryRunner.createTable(
      new Table({
        name: "refresh_tokens",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_refresh_tokens" },
          { name: "user_id", type: "uuid" },
          { name: "family_id", type: "uuid" },
          { name: "token_hash", type: "bytea" },
          { name: "replaced_by", type: "uuid", isNullable: true },
          { name: "user_agent", type: "text", isNullable: true },
          { name: "ip", type: "inet", isNullable: true },
          { name: "expires_at", type: "timestamptz" },
          { name: "revoked_at", type: "timestamptz", isNullable: true },
          { name: "revoke_reason", type: "text", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "last_used_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_refresh_tokens_replaced_by", columnNames: ["replaced_by"], referencedTableName: "refresh_tokens", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_refresh_tokens_user_id", columnNames: ["user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        checks: [
          { name: "chk_refresh_tokens_revoke_reason", expression: "revoke_reason IN ('logout', 'rotated', 'reuse_detected', 'password_changed', 'admin', 'logout_all')" },
          { name: "chk_refresh_tokens_revoked", expression: "(revoked_at IS NULL) = (revoke_reason IS NULL)" },
        ],
        indices: [
          { name: "idx_refresh_tokens_expiry", columnNames: ["expires_at"] },
          { name: "idx_refresh_tokens_family", columnNames: ["family_id"] },
          { name: "idx_refresh_tokens_user_active", columnNames: ["user_id"], where: "revoked_at IS NULL" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "auth_codes",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_auth_codes", default: "gen_random_uuid()" },
          { name: "user_id", type: "uuid" },
          { name: "purpose", type: "text" },
          { name: "channel", type: "text" },
          { name: "target", type: "text" },
          { name: "code_hash", type: "bytea" },
          { name: "attempts", type: "smallint", default: "0" },
          { name: "max_attempts", type: "smallint", default: "5" },
          { name: "expires_at", type: "timestamptz" },
          { name: "consumed_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_auth_codes_user_id", columnNames: ["user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        checks: [
          { name: "chk_auth_codes_channel", expression: "channel IN ('email', 'sms')" },
          { name: "chk_auth_codes_purpose", expression: "purpose IN ('email_verify', 'phone_verify', 'password_reset', 'login_2fa')" },
        ],
        indices: [
          { name: "uq_auth_codes_active", columnNames: ["user_id", "purpose"], isUnique: true, where: "consumed_at IS NULL" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "notification_endpoints",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_notification_endpoints", default: "gen_random_uuid()" },
          { name: "user_id", type: "uuid" },
          { name: "kind", type: "text" },
          { name: "address", type: "text" },
          { name: "keys", type: "jsonb", isNullable: true },
          { name: "label", type: "text", isNullable: true },
          { name: "verified_at", type: "timestamptz", isNullable: true },
          { name: "last_success_at", type: "timestamptz", isNullable: true },
          { name: "fail_count", type: "smallint", default: "0" },
          { name: "revoked_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_notification_endpoints_user_id", columnNames: ["user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_notification_endpoints_kind_address", columnNames: ["kind", "address"] },
        ],
        checks: [
          { name: "chk_notification_endpoints_kind", expression: "kind IN ('telegram', 'webpush')" },
          { name: "chk_notification_endpoints_webpush_keys", expression: "(kind <> 'webpush') OR (keys IS NOT NULL)" },
        ],
        indices: [
          { name: "idx_notification_endpoints_user", columnNames: ["user_id"], where: "revoked_at IS NULL" },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("notification_endpoints");
    await queryRunner.dropTable("auth_codes");
    await queryRunner.dropTable("refresh_tokens");
    await queryRunner.dropTable("users");
  }
}
