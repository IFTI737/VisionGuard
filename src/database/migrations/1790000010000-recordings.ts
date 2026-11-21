import { MigrationInterface, QueryRunner, Table } from "typeorm";

// Module owner: Musa. Tables: snapshots, recording_segments, incident_segments, live_view_sessions, detection_feedback.
// Follows src/database/schema.reference.sql (section 1790000010000-recordings).
// Value lists are written out here on purpose: a migration never imports app code.
export class Recordings1790000010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "snapshots",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_snapshots", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "camera_id", type: "uuid" },
          { name: "incident_id", type: "uuid", isNullable: true },
          { name: "media_id", type: "uuid" },
          { name: "captured_at", type: "timestamptz" },
          { name: "trigger", type: "text" },
          { name: "detections", type: "jsonb", default: "'[]'::jsonb" },
          { name: "model_code", type: "text", isNullable: true },
          { name: "frame_w", type: "integer", isNullable: true },
          { name: "frame_h", type: "integer", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_snapshots_camera_id", columnNames: ["site_id", "camera_id"], referencedTableName: "cameras", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
          { name: "fk_snapshots_incident_id", columnNames: ["incident_id"], referencedTableName: "incidents", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_snapshots_media_id", columnNames: ["media_id"], referencedTableName: "media", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
        ],
        uniques: [
          { name: "uq_snapshots_media_id", columnNames: ["media_id"] },
        ],
        checks: [
          { name: "chk_snapshots_trigger", expression: "trigger IN ('periodic', 'incident', 'manual', 'tamper')" },
        ],
        indices: [
          { name: "idx_snapshots_incident", columnNames: ["incident_id"], where: "incident_id IS NOT NULL" },
        ],
      }),
    );
    await queryRunner.query(`CREATE INDEX idx_snapshots_camera_time ON snapshots USING btree (camera_id, captured_at DESC)`);

    await queryRunner.createTable(
      new Table({
        name: "recording_segments",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_recording_segments", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "camera_id", type: "uuid" },
          { name: "started_at", type: "timestamptz" },
          { name: "ended_at", type: "timestamptz" },
          { name: "container", type: "text" },
          { name: "codec", type: "text", isNullable: true },
          { name: "stored", type: "text", default: "'cloud'" },
          { name: "media_id", type: "uuid", isNullable: true },
          { name: "init_media_id", type: "uuid", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_recording_segments_camera_id", columnNames: ["site_id", "camera_id"], referencedTableName: "cameras", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
          { name: "fk_recording_segments_init_media_id", columnNames: ["init_media_id"], referencedTableName: "media", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
          { name: "fk_recording_segments_media_id", columnNames: ["media_id"], referencedTableName: "media", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
        ],
        uniques: [
          { name: "uq_recording_segments_camera_id_started_at", columnNames: ["camera_id", "started_at"] },
          { name: "uq_recording_segments_media_id", columnNames: ["media_id"] },
        ],
        checks: [
          { name: "chk_recording_segments_cloud_media", expression: "(stored = 'cloud') = (media_id IS NOT NULL)" },
          { name: "chk_recording_segments_container", expression: "container IN ('webm', 'mp4', 'fmp4')" },
          { name: "chk_recording_segments_stored", expression: "stored IN ('cloud', 'edge')" },
          { name: "chk_recording_segments_time_order", expression: "ended_at > started_at" },
        ],
        indices: [
          { name: "idx_recording_segments_purge", columnNames: ["ended_at"], where: "stored = 'cloud'" },
          { name: "idx_recording_segments_range", columnNames: ["camera_id", "ended_at"] },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "incident_segments",
        columns: [
          { name: "incident_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_incident_segments" },
          { name: "segment_id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_incident_segments" },
        ],
        foreignKeys: [
          { name: "fk_incident_segments_incident_id", columnNames: ["incident_id"], referencedTableName: "incidents", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_incident_segments_segment_id", columnNames: ["segment_id"], referencedTableName: "recording_segments", referencedColumnNames: ["id"], onDelete: "RESTRICT" },
        ],
        indices: [
          { name: "idx_incident_segments_segment", columnNames: ["segment_id"] },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "live_view_sessions",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_live_view_sessions", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "camera_id", type: "uuid" },
          { name: "viewer_user_id", type: "uuid" },
          { name: "transport", type: "text", isNullable: true },
          { name: "started_at", type: "timestamptz", default: "now()" },
          { name: "connected_at", type: "timestamptz", isNullable: true },
          { name: "ended_at", type: "timestamptz", isNullable: true },
          { name: "end_reason", type: "text", isNullable: true },
        ],
        foreignKeys: [
          { name: "fk_live_view_sessions_camera_id", columnNames: ["site_id", "camera_id"], referencedTableName: "cameras", referencedColumnNames: ["site_id", "id"], onDelete: "CASCADE" },
          { name: "fk_live_view_sessions_viewer_user_id", columnNames: ["viewer_user_id"], referencedTableName: "users", referencedColumnNames: ["id"], onDelete: "CASCADE" },
        ],
        checks: [
          { name: "chk_live_view_sessions_end_reason", expression: "end_reason IN ('viewer_left', 'timeout', 'device_offline', 'limit', 'error')" },
          { name: "chk_live_view_sessions_transport", expression: "transport IN ('p2p', 'relay', 'sfu')" },
        ],
        indices: [
          { name: "idx_live_view_sessions_active", columnNames: ["camera_id"], where: "ended_at IS NULL" },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "detection_feedback",
        columns: [
          { name: "id", type: "uuid", isPrimary: true, primaryKeyConstraintName: "pk_detection_feedback", default: "gen_random_uuid()" },
          { name: "site_id", type: "uuid" },
          { name: "incident_id", type: "uuid", isNullable: true },
          { name: "snapshot_id", type: "uuid", isNullable: true },
          { name: "label", type: "text" },
          { name: "reason", type: "text", isNullable: true },
          { name: "model_code", type: "text", isNullable: true },
          { name: "model_version", type: "text", isNullable: true },
          { name: "detections", type: "jsonb", default: "'[]'::jsonb" },
          { name: "corrected", type: "jsonb", isNullable: true },
          { name: "created_by", type: "uuid", isNullable: true },
          { name: "export_status", type: "text", default: "'pending'" },
          { name: "exported_at", type: "timestamptz", isNullable: true },
          { name: "created_at", type: "timestamptz", default: "now()" },
        ],
        foreignKeys: [
          { name: "fk_detection_feedback_created_by", columnNames: ["created_by"], referencedTableName: "site_members", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_detection_feedback_incident_id", columnNames: ["incident_id"], referencedTableName: "incidents", referencedColumnNames: ["id"], onDelete: "SET NULL" },
          { name: "fk_detection_feedback_site_id", columnNames: ["site_id"], referencedTableName: "sites", referencedColumnNames: ["id"], onDelete: "CASCADE" },
          { name: "fk_detection_feedback_snapshot_id", columnNames: ["snapshot_id"], referencedTableName: "snapshots", referencedColumnNames: ["id"], onDelete: "SET NULL" },
        ],
        checks: [
          { name: "chk_detection_feedback_export_status", expression: "export_status IN ('pending', 'exported', 'excluded')" },
          { name: "chk_detection_feedback_label", expression: "label IN ('false_positive', 'true_positive', 'wrong_class', 'missed')" },
        ],
        indices: [
          { name: "idx_detection_feedback_export", columnNames: ["export_status", "created_at"] },
        ],
      }),
    );
    // incidents was created in an earlier file; it can point at snapshots only now
    await queryRunner.query(`ALTER TABLE incidents ADD CONSTRAINT fk_incidents_cover_snapshot_id FOREIGN KEY (cover_snapshot_id) REFERENCES snapshots(id) ON DELETE SET NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE incidents DROP CONSTRAINT fk_incidents_cover_snapshot_id`);
    await queryRunner.dropTable("detection_feedback");
    await queryRunner.dropTable("live_view_sessions");
    await queryRunner.dropTable("incident_segments");
    await queryRunner.dropTable("recording_segments");
    await queryRunner.dropTable("snapshots");
  }
}
