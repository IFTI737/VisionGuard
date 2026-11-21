import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Abid. Tables: support_tickets, ticket_messages, export_jobs.
// Follows src/database/schema.reference.sql (section 1790000012000-support-exports).
// Value lists are written out here on purpose: a migration never imports app code.
export class SupportExports1790000012000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "support_tickets",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_support_tickets", default: "gen_random_uuid()" },
          { name: "number", type: "bigint", isGenerated: true, generationStrategy: "identity", generatedIdentity: "ALWAYS" },
          { name: "site_id", type: "uuid", isNullable: true },
          { name: "requester_user_id", type: "uuid", isNullable: true },
          { name: "category", type: "text" },
          { name: "subject", type: "text" },
          { name: "priority", type: "text", default: "'normal'" },
          { name: "status", type: "text", default: "'open'" },
          { name: "assigned_to", type: "uuid", isNullable: true },
          { name: "quoted_price_minor", type: "integer", isNullable: true },
          { name: "delivered_pack_id", type: "uuid", isNullable: true },
          { name: "first_response_at", type: "timestamptz", isNullable: true },
          { name: "resolved_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_support_tickets_assigned_to", columnNames: ["assigned_to"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_support_tickets_delivered_pack_id", columnNames: ["delivered_pack_id"], referencedTableName: "packs", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_support_tickets_requester_user_id", columnNames: ["requester_user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_support_tickets_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "SET NULL" },
        ],
        uniques: [
          { name: "uq_support_tickets_number", columnNames: ["number"] },
        ],
        checks: [
          { name: "chk_support_tickets_category", expression: "category IN ('complaint', 'bug', 'billing', 'false_alarm', 'feature_request', 'other')" },
          { name: "chk_support_tickets_priority", expression: "priority IN ('low', 'normal', 'high', 'urgent')" },
          { name: "chk_support_tickets_quoted_price_minor", expression: "quoted_price_minor >= 0" },
          { name: "chk_support_tickets_status", expression: "status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')" },
        ],
        indices: [
          { name: "idx_support_tickets_assignee", columnNames: ["assigned_to"], where: "status = ANY (ARRAY['open', 'in_progress', 'waiting_customer'])" },
          { name: "idx_support_tickets_queue", columnNames: ["status", "priority", "created_at"], where: "status = ANY (ARRAY['open', 'in_progress', 'waiting_customer'])" },
        ],
      }),
    );
    await queryRunner.query(`CREATE INDEX idx_support_tickets_requester ON support_tickets USING btree (requester_user_id, created_at DESC)`);
    await queryRunner.query(`CREATE INDEX idx_support_tickets_subject_trgm ON support_tickets USING gin (subject gin_trgm_ops)`);

    await queryRunner.createTable(
      new Table({
        name: "ticket_messages",
        columns: [
          { name: "id", type: "bigint", isPrimary: true, primaryKeyConstraintName: "pk_ticket_messages", isGenerated: true, generationStrategy: "identity", generatedIdentity: "ALWAYS" },
          { name: "ticket_id", type: "uuid" },
          { name: "sender_user_id", type: "uuid", isNullable: true },
          { name: "body", type: "text" },
          { name: "is_internal", type: "boolean", default: "false" },
          { name: "media_id", type: "uuid", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_ticket_messages_media_id", columnNames: ["media_id"], referencedTableName: "media", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_ticket_messages_sender_user_id", columnNames: ["sender_user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_ticket_messages_ticket_id", columnNames: ["ticket_id"], referencedTableName: "support_tickets", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        checks: [
          { name: "chk_ticket_messages_body", expression: "(char_length(body) >= 1) AND (char_length(body) <= 8000)" },
        ],
        indices: [
          { name: "idx_ticket_messages_ticket", columnNames: ["ticket_id", "id"] },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "export_jobs",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_export_jobs", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "requested_by", type: "uuid", isNullable: true },
          { name: "report_type", type: "text" },
          { name: "format", type: "text" },
          { name: "params", type: "jsonb", default: "'{}'::jsonb" },
          { name: "status", type: "text", default: "'queued'" },
          { name: "media_id", type: "uuid", isNullable: true },
          { name: "error", type: "text", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "finished_at", type: "timestamptz", isNullable: true },
          { name: "expires_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_export_jobs_media_id", columnNames: ["media_id"], referencedTableName: "media", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_export_jobs_requested_by", columnNames: ["requested_by"], referencedTableName: "site_members", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_export_jobs_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        checks: [
          { name: "chk_export_jobs_format", expression: "format IN ('csv', 'pdf')" },
          { name: "chk_export_jobs_report_type", expression: "report_type IN ('incidents', 'counts', 'compliance', 'alerts', 'invoices')" },
          { name: "chk_export_jobs_status", expression: "status IN ('queued', 'running', 'ready', 'failed')" },
        ],
      }),
    );
    await queryRunner.query(`CREATE INDEX idx_export_jobs_site ON export_jobs USING btree (site_id, created_at DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("export_jobs");
    await queryRunner.dropTable("ticket_messages");
    await queryRunner.dropTable("support_tickets");
  }
}
