import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Mahir. Tables: plans, subscriptions, subscription_items, invoices, invoice_lines, payments.
// Follows src/database/schema.reference.sql (section 1790000013000-billing).
// Value lists are written out here on purpose: a migration never imports app code.
export class Billing1790000013000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "plans",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_plans", default: "gen_random_uuid()" },
          { name: "code", type: "text" },
          { name: "name", type: "text" },
          { name: "price_minor", type: "integer" },
          { name: "currency", type: "char", length: "3", default: "'BDT'" },
          { name: "max_cameras", type: "smallint" },
          { name: "max_members", type: "smallint", isNullable: true },
          { name: "pack_slots", type: "smallint", default: "0" },
          { name: "recording_days", type: "smallint" },
          { name: "incident_retention_days", type: "smallint", default: "180" },
          { name: "is_public", type: "boolean", default: "true" },
          { name: "active", type: "boolean", default: "true" },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        uniques: [
          { name: "uq_plans_code", columnNames: ["code"] },
        ],
        checks: [
          { name: "chk_plans_price_minor", expression: "price_minor >= 0" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "subscriptions",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_subscriptions", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "plan_id", type: "uuid" },
          { name: "status", type: "text" },
          { name: "trial_ends_at", type: "timestamptz", isNullable: true },
          { name: "current_period_start", type: "timestamptz" },
          { name: "current_period_end", type: "timestamptz" },
          { name: "grace_until", type: "timestamptz", isNullable: true },
          { name: "cancel_at_period_end", type: "boolean", default: "false" },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_subscriptions_plan_id", columnNames: ["plan_id"], referencedTableName: "plans", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
          { name: "fk_subscriptions_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_subscriptions_site_id", columnNames: ["site_id"] },
        ],
        checks: [
          { name: "chk_subscriptions_period_order", expression: "current_period_end > current_period_start" },
          { name: "chk_subscriptions_status", expression: "status IN ('trialing', 'active', 'past_due', 'cancelled')" },
        ],
        indices: [
          { name: "idx_subscriptions_renewal", columnNames: ["current_period_end"], where: "status = ANY (ARRAY['trialing', 'active', 'past_due'])" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "subscription_items",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_subscription_items", default: "gen_random_uuid()" },
          { name: "subscription_id", type: "uuid" },
          { name: "pack_id", type: "uuid" },
          { name: "kind", type: "text" },
          { name: "unit_price_minor", type: "integer", default: "0" },
          { name: "started_at", type: "timestamptz", default: "now()" },
          { name: "ended_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_subscription_items_pack_id", columnNames: ["pack_id"], referencedTableName: "packs", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
          { name: "fk_subscription_items_subscription_id", columnNames: ["subscription_id"], referencedTableName: "subscriptions", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        checks: [
          { name: "chk_subscription_items_included_free", expression: "(kind <> 'included') OR (unit_price_minor = 0)" },
          { name: "chk_subscription_items_kind", expression: "kind IN ('included', 'addon', 'custom')" },
          { name: "chk_subscription_items_unit_price_minor", expression: "unit_price_minor >= 0" },
        ],
        indices: [
          { name: "uq_subscription_items_active", columnNames: ["subscription_id", "pack_id"], isUnique: true, where: "ended_at IS NULL" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "invoices",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_invoices", default: "gen_random_uuid()" },
          { name: "number", type: "text" },
          { name: "site_id", type: "uuid", isNullable: true },
          { name: "subscription_id", type: "uuid", isNullable: true },
          { name: "billing_name", type: "text" },
          { name: "period_start", type: "timestamptz" },
          { name: "period_end", type: "timestamptz" },
          { name: "status", type: "text", default: "'draft'" },
          { name: "total_minor", type: "integer", default: "0" },
          { name: "currency", type: "char", length: "3", default: "'BDT'" },
          { name: "issued_at", type: "timestamptz", isNullable: true },
          { name: "due_at", type: "timestamptz", isNullable: true },
          { name: "paid_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_invoices_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_invoices_subscription_id", columnNames: ["subscription_id"], referencedTableName: "subscriptions", referencedColumnNames: ["id"], onDelete: "SET NULL" },
        ],
        uniques: [
          { name: "uq_invoices_number", columnNames: ["number"] },
          { name: "uq_invoices_subscription_id_period_start", columnNames: ["subscription_id", "period_start"] },
        ],
        checks: [
          { name: "chk_invoices_status", expression: "status IN ('draft', 'open', 'paid', 'void')" },
          { name: "chk_invoices_total_minor", expression: "total_minor >= 0" },
        ],
        indices: [
          { name: "idx_invoices_open", columnNames: ["due_at"], where: "status = 'open'" },
          { name: "idx_invoices_paid", columnNames: ["paid_at"], where: "status = 'paid'" },
        ],
      }),
    );
    await queryRunner.query(`CREATE INDEX idx_invoices_site ON invoices USING btree (site_id, created_at DESC)`);

    await queryRunner.createTable(
      new Table({
        name: "invoice_lines",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_invoice_lines", default: "gen_random_uuid()" },
          { name: "invoice_id", type: "uuid" },
          { name: "description", type: "text" },
          { name: "amount_minor", type: "integer" },
          { name: "subscription_item_id", type: "uuid", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_invoice_lines_invoice_id", columnNames: ["invoice_id"], referencedTableName: "invoices", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_invoice_lines_subscription_item_id", columnNames: ["subscription_item_id"], referencedTableName: "subscription_items", referencedColumnNames: ["id"], onDelete: "SET NULL" },
        ],
        indices: [
          { name: "idx_invoice_lines_invoice", columnNames: ["invoice_id"] },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "payments",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_payments", default: "gen_random_uuid()" },
          { name: "invoice_id", type: "uuid" },
          { name: "provider", type: "text" },
          { name: "provider_txn_id", type: "text" },
          { name: "amount_minor", type: "integer" },
          { name: "status", type: "text", default: "'initiated'" },
          { name: "raw", type: "jsonb", default: "'{}'::jsonb" },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "confirmed_at", type: "timestamptz", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_payments_invoice_id", columnNames: ["invoice_id"], referencedTableName: "invoices", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
        ],
        uniques: [
          { name: "uq_payments_provider_provider_txn_id", columnNames: ["provider", "provider_txn_id"] },
        ],
        checks: [
          { name: "chk_payments_amount_minor", expression: "amount_minor > 0" },
          { name: "chk_payments_provider", expression: "provider IN ('sandbox', 'bkash', 'sslcommerz', 'manual')" },
          { name: "chk_payments_status", expression: "status IN ('initiated', 'succeeded', 'failed', 'refunded')" },
        ],
        indices: [
          { name: "idx_payments_invoice", columnNames: ["invoice_id"] },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("payments");
    await queryRunner.dropTable("invoice_lines");
    await queryRunner.dropTable("invoices");
    await queryRunner.dropTable("subscription_items");
    await queryRunner.dropTable("subscriptions");
    await queryRunner.dropTable("plans");
  }
}
