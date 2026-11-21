import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Iftekhar. Tables: incidents, incident_events.
// Follows src/database/schema.reference.sql (section 1790000009000-incidents).
// Value lists are written out here on purpose: a migration never imports app code.
export class Incidents1790000009000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "incidents",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_incidents", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "rule_id", type: "uuid", isNullable: true },
          { name: "zone_id", type: "uuid", isNullable: true },
          { name: "camera_id", type: "uuid", isNullable: true },
          { name: "alert_id", type: "uuid", isNullable: true },
          { name: "kind", type: "text" },
          { name: "title", type: "text" },
          { name: "severity", type: "text" },
          { name: "risk_score", type: "smallint" },
          { name: "status", type: "text", default: "'open'" },
          { name: "condition_active", type: "boolean", default: "true" },
          { name: "dedup_key", type: "text" },
          { name: "recurrence", type: "integer", default: "1" },
          { name: "started_at", type: "timestamptz" },
          { name: "last_seen_at", type: "timestamptz" },
          { name: "ended_at", type: "timestamptz", isNullable: true },
          { name: "clip_from", type: "timestamptz", isNullable: true },
          { name: "clip_to", type: "timestamptz", isNullable: true },
          { name: "expected", type: "jsonb", default: "'{}'::jsonb" },
          { name: "observed", type: "jsonb", default: "'{}'::jsonb" },
          { name: "cover_snapshot_id", type: "uuid", isNullable: true },
          { name: "acknowledged_by", type: "uuid", isNullable: true },
          { name: "acknowledged_at", type: "timestamptz", isNullable: true },
          { name: "resolved_by", type: "uuid", isNullable: true },
          { name: "resolved_at", type: "timestamptz", isNullable: true },
          { name: "false_alarm_reason", type: "text", isNullable: true },
          { name: "resolution_note", type: "text", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
          { name: "updated_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_incidents_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        uniques: [
          { name: "uq_incidents_site_id_id", columnNames: ["site_id", "id"] },
        ],
        checks: [
          { name: "chk_incidents_clip_window", expression: "(clip_to IS NULL) OR (clip_to > clip_from)" },
          { name: "chk_incidents_false_alarm_reason", expression: "false_alarm_reason IN ('wrong_object', 'authorized_person', 'animal', 'light_or_shadow', 'rule_too_sensitive', 'other')" },
          { name: "chk_incidents_false_alarm_status", expression: "(status = 'false_alarm') = (false_alarm_reason IS NOT NULL)" },
          { name: "chk_incidents_risk_score", expression: "(risk_score >= 0) AND (risk_score <= 100)" },
          { name: "chk_incidents_severity", expression: "severity IN ('low', 'medium', 'high', 'critical')" },
          { name: "chk_incidents_status", expression: "status IN ('open', 'acknowledged', 'resolved', 'false_alarm')" },
        ],
        indices: [
          { name: "idx_incidents_alert", columnNames: ["alert_id"], where: "alert_id IS NOT NULL" },
          { name: "idx_incidents_camera_clip", columnNames: ["camera_id", "clip_from", "clip_to"], where: "clip_from IS NOT NULL" },
          { name: "uq_incidents_open_dedup", columnNames: ["dedup_key"], isUnique: true, where: "status = ANY (ARRAY['open', 'acknowledged'])" },
        ],
      }),
    );
    await queryRunner.query(`ALTER TABLE incidents ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, ((title || ' '::text) || COALESCE(resolution_note, ''::text)))) STORED`);
    await queryRunner.query(`ALTER TABLE incidents ADD CONSTRAINT fk_incidents_acknowledged_by FOREIGN KEY (site_id, acknowledged_by) REFERENCES site_members(site_id, id) ON DELETE SET NULL (acknowledged_by)`);
    await queryRunner.query(`ALTER TABLE incidents ADD CONSTRAINT fk_incidents_alert_id FOREIGN KEY (site_id, alert_id) REFERENCES alerts(site_id, id) ON DELETE SET NULL (alert_id)`);
    await queryRunner.query(`ALTER TABLE incidents ADD CONSTRAINT fk_incidents_camera_id FOREIGN KEY (site_id, camera_id) REFERENCES cameras(site_id, id) ON DELETE SET NULL (camera_id)`);
    await queryRunner.query(`ALTER TABLE incidents ADD CONSTRAINT fk_incidents_resolved_by FOREIGN KEY (site_id, resolved_by) REFERENCES site_members(site_id, id) ON DELETE SET NULL (resolved_by)`);
    await queryRunner.query(`ALTER TABLE incidents ADD CONSTRAINT fk_incidents_rule_id FOREIGN KEY (site_id, rule_id) REFERENCES rules(site_id, id) ON DELETE SET NULL (rule_id)`);
    await queryRunner.query(`ALTER TABLE incidents ADD CONSTRAINT fk_incidents_zone_id FOREIGN KEY (site_id, zone_id) REFERENCES zones(site_id, id) ON DELETE SET NULL (zone_id)`);
    await queryRunner.query(`CREATE INDEX idx_incidents_search ON incidents USING gin (search_tsv)`);
    await queryRunner.query(`CREATE INDEX idx_incidents_site_status ON incidents USING btree (site_id, status, started_at DESC)`);
    await queryRunner.query(`CREATE INDEX idx_incidents_site_time ON incidents USING btree (site_id, started_at DESC)`);
    await queryRunner.query(`CREATE INDEX idx_incidents_zone_time ON incidents USING btree (zone_id, started_at DESC)`);

    await queryRunner.createTable(
      new Table({
        name: "incident_events",
        columns: [
          { name: "id", type: "bigint", isPrimary: true, primaryKeyConstraintName: "pk_incident_events", isGenerated: true, generationStrategy: "identity", generatedIdentity: "ALWAYS" },
          { name: "incident_id", type: "uuid" },
          { name: "type", type: "text" },
          { name: "actor_member_id", type: "uuid", isNullable: true },
          { name: "data", type: "jsonb", default: "'{}'::jsonb" },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_incident_events_actor_member_id", columnNames: ["actor_member_id"], referencedTableName: "site_members", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_incident_events_incident_id", columnNames: ["incident_id"], referencedTableName: "incidents", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        checks: [
          { name: "chk_incident_events_type", expression: "type IN ('created', 'recurred', 'severity_changed', 'alert_sent', 'acknowledged', 'resolved', 'false_alarm', 'reopened', 'condition_cleared', 'note', 'clip_ready')" },
        ],
        indices: [
          { name: "idx_incident_events_incident", columnNames: ["incident_id", "created_at"] },
        ],
      }),
    );

  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("incident_events");
    // raw DROP: TypeORM's dropTable looks for its own metadata table when a column is generated
    await queryRunner.query(`DROP TABLE incidents`);
  }
}
