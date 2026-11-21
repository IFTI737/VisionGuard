import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Abid. Tables: conversations, conversation_members, messages.
// Follows src/database/schema.reference.sql (section 1790000011000-conversations).
// Value lists are written out here on purpose: a migration never imports app code.
export class Conversations1790000011000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "conversations",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_conversations", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "kind", type: "text" },
          { name: "alert_id", type: "uuid", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "last_message_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_conversations_alert_id", columnNames: ["alert_id"], referencedTableName: "alerts", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_conversations_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_conversations_alert_id", columnNames: ["alert_id"] },
        ],
        checks: [
          { name: "chk_conversations_alert_link", expression: "(kind = 'alert') = (alert_id IS NOT NULL)" },
          { name: "chk_conversations_kind", expression: "kind IN ('team', 'alert')" },
        ],
        indices: [
          { name: "uq_conversations_team", columnNames: ["site_id"], isUnique: true, where: "kind = 'team'" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "conversation_members",
        columns: [
          { name: "conversation_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_conversation_members" },
          { name: "member_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_conversation_members" },
          { name: "last_read_id", type: "bigint", default: "0" },
          { name: "muted", type: "boolean", default: "false" },
        ],
        foreignKeys: [
          { name: "fk_conversation_members_conversation_id", columnNames: ["conversation_id"], referencedTableName: "conversations", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_conversation_members_member_id", columnNames: ["member_id"], referencedTableName: "site_members", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "messages",
        columns: [
          { name: "id", type: "bigint", isPrimary: true, primaryKeyConstraintName: "pk_messages", isGenerated: true, generationStrategy: "identity", generatedIdentity: "ALWAYS" },
          { name: "conversation_id", type: "uuid" },
          { name: "sender_member_id", type: "uuid", isNullable: true },
          { name: "body", type: "text" },
          { name: "media_id", type: "uuid", isNullable: true },
          { name: "client_msg_id", type: "text", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "edited_at", type: "timestamptz", isNullable: true },
          { name: "deleted_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_messages_conversation_id", columnNames: ["conversation_id"], referencedTableName: "conversations", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_messages_media_id", columnNames: ["media_id"], referencedTableName: "media", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_messages_sender_member_id", columnNames: ["sender_member_id"], referencedTableName: "site_members", referencedColumnNames: ["id"], onDelete: "SET NULL" },
        ],
        checks: [
          { name: "chk_messages_body", expression: "(char_length(body) >= 1) AND (char_length(body) <= 4000)" },
        ],
        indices: [
          { name: "uq_messages_idempotency", columnNames: ["conversation_id", "sender_member_id", "client_msg_id"], isUnique: true, where: "client_msg_id IS NOT NULL" },
        ],
      }),
    );
    await queryRunner.query(`CREATE INDEX idx_messages_conversation ON messages USING btree (conversation_id, id DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("messages");
    await queryRunner.dropTable("conversation_members");
    await queryRunner.dropTable("conversations");
  }
}
