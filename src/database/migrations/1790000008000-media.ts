import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Musa. Tables: media.
// Follows src/database/schema.reference.sql (section 1790000008000-media).
// Value lists are written out here on purpose: a migration never imports app code.
export class Media1790000008000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "media",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_media", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid", isNullable: true },
          { name: "kind", type: "text" },
          { name: "storage", type: "text" },
          { name: "object_key", type: "text" },
          { name: "mime", type: "text" },
          { name: "bytes", type: "bigint" },
          { name: "status", type: "text", default: "'ready'" },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "expires_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_media_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_media_object_key", columnNames: ["object_key"] },
        ],
        checks: [
          { name: "chk_media_bytes", expression: "bytes >= 0" },
          { name: "chk_media_kind", expression: "kind IN ('image', 'video', 'file')" },
          { name: "chk_media_status", expression: "status IN ('pending', 'ready', 'purging')" },
          { name: "chk_media_storage", expression: "storage IN ('local', 'r2')" },
        ],
        indices: [
          { name: "idx_media_expiry", columnNames: ["expires_at"], where: "expires_at IS NOT NULL" },
          { name: "idx_media_pending", columnNames: ["created_at"], where: "status <> 'ready'" },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("media");
  }
}
