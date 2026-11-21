import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Abid. Tables: escalation_policies, escalation_steps, alerts, alert_recipients, delivery_attempts.
// Follows src/database/schema.reference.sql (section 1790000007000-alerts).
// Value lists are written out here on purpose: a migration never imports app code.
export class Alerts1790000007000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "escalation_policies",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_escalation_policies", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "name", type: "text" },
          { name: "is_default", type: "boolean", default: "false" },
          { name: "min_severity", type: "text", default: "'low'" },
          { name: "repeat_count", type: "smallint", default: "0" },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_escalation_policies_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_escalation_policies_site_id_id", columnNames: ["site_id", "id"] },
        ],
        checks: [
          { name: "chk_escalation_policies_min_severity", expression: "min_severity IN ('low', 'medium', 'high', 'critical')" },
          { name: "chk_escalation_policies_repeat_count", expression: "(repeat_count >= 0) AND (repeat_count <= 3)" },
        ],
        indices: [
          { name: "uq_escalation_policies_default", columnNames: ["site_id"], isUnique: true, where: "is_default" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "escalation_steps",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_escalation_steps", default: "gen_random_uuid()" },
          { name: "policy_id", type: "uuid" },
          { name: "step_no", type: "smallint" },
          { name: "wait_s", type: "integer" },
          { name: "channels", type: "text", isArray: true },
          { name: "audience", type: "text" },
          { name: "role", type: "text", isNullable: true },
          { name: "call_count", type: "smallint", default: "1" },
          { name: "ring_timeout_s", type: "smallint", default: "30" },
        ],
        foreignKeys: [
          { name: "fk_escalation_steps_policy_id", columnNames: ["policy_id"], referencedTableName: "escalation_policies", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_escalation_steps_policy_id_step_no", columnNames: ["policy_id", "step_no"] },
        ],
        checks: [
          { name: "chk_escalation_steps_audience", expression: "audience IN ('all_members', 'role', 'call_list')" },
          { name: "chk_escalation_steps_call_count", expression: "(call_count >= 1) AND (call_count <= 5)" },
          { name: "chk_escalation_steps_channels", expression: "(channels <@ ARRAY['inapp', 'webpush', 'telegram', 'call']) AND (cardinality(channels) > 0)" },
          { name: "chk_escalation_steps_ring_timeout_s", expression: "(ring_timeout_s >= 10) AND (ring_timeout_s <= 60)" },
          { name: "chk_escalation_steps_role", expression: "role IN ('owner', 'manager', 'guard', 'viewer', 'contact')" },
          { name: "chk_escalation_steps_role_audience", expression: "(audience = 'role') = (role IS NOT NULL)" },
          { name: "chk_escalation_steps_step_no", expression: "step_no >= 1" },
          { name: "chk_escalation_steps_wait_s", expression: "wait_s >= 0" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "alerts",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_alerts", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "source", type: "text" },
          { name: "sender_member_id", type: "uuid", isNullable: true },
          { name: "policy_id", type: "uuid", isNullable: true },
          { name: "title", type: "text" },
          { name: "body", type: "text", isNullable: true },
          { name: "severity", type: "text" },
          { name: "risk_score", type: "smallint", isNullable: true },
          { name: "status", type: "text", default: "'active'" },
          { name: "current_step", type: "smallint", default: "0" },
          { name: "client_request_id", type: "text", isNullable: true },
          { name: "acknowledged_by", type: "uuid", isNullable: true },
          { name: "acknowledged_via", type: "text", isNullable: true },
          { name: "acknowledged_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
          { name: "closed_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_alerts_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_alerts_site_id_id", columnNames: ["site_id", "id"] },
        ],
        checks: [
          { name: "chk_alerts_acknowledged_via", expression: "acknowledged_via IN ('app', 'telegram', 'webpush', 'call')" },
          { name: "chk_alerts_manual_sender", expression: "(source <> 'manual') OR (sender_member_id IS NOT NULL) OR (status <> 'active')" },
          { name: "chk_alerts_risk_score", expression: "(risk_score >= 0) AND (risk_score <= 100)" },
          { name: "chk_alerts_severity", expression: "severity IN ('low', 'medium', 'high', 'critical')" },
          { name: "chk_alerts_source", expression: "source IN ('system', 'manual', 'test')" },
          { name: "chk_alerts_status", expression: "status IN ('active', 'acknowledged', 'exhausted', 'cancelled')" },
        ],
        indices: [
          { name: "idx_alerts_site_active", columnNames: ["site_id"], where: "status = 'active'" },
          { name: "uq_alerts_idempotency", columnNames: ["site_id", "sender_member_id", "client_request_id"], isUnique: true, where: "client_request_id IS NOT NULL" },
        ],
      }),
    );
    await queryRunner.query(`ALTER TABLE alerts ADD CONSTRAINT fk_alerts_acknowledged_by FOREIGN KEY (site_id, acknowledged_by) REFERENCES site_members(site_id, id) ON DELETE SET NULL (acknowledged_by)`);
    await queryRunner.query(`ALTER TABLE alerts ADD CONSTRAINT fk_alerts_policy_id FOREIGN KEY (site_id, policy_id) REFERENCES escalation_policies(site_id, id) ON DELETE SET NULL (policy_id)`);
    await queryRunner.query(`ALTER TABLE alerts ADD CONSTRAINT fk_alerts_sender_member_id FOREIGN KEY (site_id, sender_member_id) REFERENCES site_members(site_id, id) ON DELETE SET NULL (sender_member_id)`);
    await queryRunner.query(`CREATE INDEX idx_alerts_site_time ON alerts USING btree (site_id, created_at DESC)`);

    await queryRunner.createTable(
      new Table({
        name: "alert_recipients",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_alert_recipients", default: "gen_random_uuid()" },
          { name: "alert_id", type: "uuid" },
          { name: "site_id", type: "uuid" },
          { name: "member_id", type: "uuid" },
          { name: "step_no", type: "smallint" },
          { name: "status", type: "text", default: "'pending'" },
          { name: "ack_token_hash", type: "bytea", isNullable: true },
          { name: "notified_at", type: "timestamptz", isNullable: true },
          { name: "seen_at", type: "timestamptz", isNullable: true },
          { name: "acked_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_alert_recipients_alert_id", columnNames: ["alert_id"], referencedTableName: "alerts", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_alert_recipients_member_id", columnNames: ["site_id", "member_id"], referencedTableName: "site_members", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_alert_recipients_alert_id_member_id", columnNames: ["alert_id", "member_id"] },
        ],
        checks: [
          { name: "chk_alert_recipients_status", expression: "status IN ('pending', 'notified', 'seen', 'acknowledged', 'unreachable', 'skipped')" },
        ],
        indices: [
          { name: "idx_alert_recipients_member", columnNames: ["member_id", "status"] },
          { name: "uq_alert_recipients_token", columnNames: ["ack_token_hash"], isUnique: true, where: "ack_token_hash IS NOT NULL" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "delivery_attempts",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_delivery_attempts", default: "gen_random_uuid()" },
          { name: "recipient_id", type: "uuid" },
          { name: "channel", type: "text" },
          { name: "endpoint_id", type: "uuid", isNullable: true },
          { name: "attempt_no", type: "smallint", default: "1" },
          { name: "status", type: "text", default: "'queued'" },
          { name: "provider", type: "text", isNullable: true },
          { name: "provider_ref", type: "text", isNullable: true },
          { name: "error", type: "text", isNullable: true },
          { name: "meta", type: "jsonb", default: "'{}'::jsonb" },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "completed_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_delivery_attempts_endpoint_id", columnNames: ["endpoint_id"], referencedTableName: "notification_endpoints", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_delivery_attempts_recipient_id", columnNames: ["recipient_id"], referencedTableName: "alert_recipients", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_delivery_attempts_recipient_id_channel_attempt_no", columnNames: ["recipient_id", "channel", "attempt_no"] },
        ],
        checks: [
          { name: "chk_delivery_attempts_channel", expression: "channel IN ('inapp', 'webpush', 'telegram', 'call')" },
          { name: "chk_delivery_attempts_status", expression: "status IN ('queued', 'sent', 'delivered', 'failed', 'ringing', 'answered', 'no_answer', 'busy', 'cancelled')" },
        ],
        indices: [
          { name: "uq_delivery_attempts_provider", columnNames: ["provider", "provider_ref"], isUnique: true, where: "provider_ref IS NOT NULL" },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("delivery_attempts");
    await queryRunner.dropTable("alert_recipients");
    await queryRunner.dropTable("alerts");
    await queryRunner.dropTable("escalation_steps");
    await queryRunner.dropTable("escalation_policies");
  }
}
