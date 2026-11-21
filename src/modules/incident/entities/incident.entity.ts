import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { IncidentsFalseAlarmReason, IncidentsSeverity, IncidentsStatus } from "@/common/constants/check-values";
import { Alert } from "@/modules/alert/entities/alert.entity";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Rule } from "@/modules/rule/entities/rule.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { Snapshot } from "@/modules/media/entities/snapshot.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";

@Entity({ name: "incidents" })
export class Incident {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "uuid", nullable: true })
  ruleId!: string | null;

  @ManyToOne(() => Rule, { onDelete: "SET NULL" })
  @JoinColumn({ name: "rule_id" })
  rule!: Rule | null;

  @Column({ type: "uuid", nullable: true })
  zoneId!: string | null;

  @ManyToOne(() => Zone, { onDelete: "SET NULL" })
  @JoinColumn({ name: "zone_id" })
  zone!: Zone | null;

  @Column({ type: "uuid", nullable: true })
  cameraId!: string | null;

  @ManyToOne(() => Camera, { onDelete: "SET NULL" })
  @JoinColumn({ name: "camera_id" })
  camera!: Camera | null;

  @Column({ type: "uuid", nullable: true })
  alertId!: string | null;

  @ManyToOne(() => Alert, { onDelete: "SET NULL" })
  @JoinColumn({ name: "alert_id" })
  alert!: Alert | null;

  @Column({ type: "text" })
  kind!: string;

  @Column({ type: "text" })
  title!: string;

  @Column({ type: "text" })
  severity!: IncidentsSeverity;

  @Column({ type: "smallint" })
  riskScore!: number;

  @Column({ type: "text", default: "open" })
  status!: IncidentsStatus;

  @Column({ type: "boolean", default: true })
  conditionActive!: boolean;

  @Column({ type: "text" })
  dedupKey!: string;

  @Column({ type: "integer", default: 1 })
  recurrence!: number;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz" })
  lastSeenAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  endedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  clipFrom!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  clipTo!: Date | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  expected!: any;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  observed!: any;

  @Column({ type: "uuid", nullable: true })
  coverSnapshotId!: string | null;

  @ManyToOne(() => Snapshot, { onDelete: "SET NULL" })
  @JoinColumn({ name: "cover_snapshot_id" })
  coverSnapshot!: Snapshot | null;

  @Column({ type: "uuid", nullable: true })
  acknowledgedBy!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "acknowledged_by" })
  acknowledgedBySiteMember!: SiteMember | null;

  @Column({ type: "timestamptz", nullable: true })
  acknowledgedAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  resolvedBy!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "resolved_by" })
  resolvedBySiteMember!: SiteMember | null;

  @Column({ type: "timestamptz", nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  falseAlarmReason!: IncidentsFalseAlarmReason | null;

  @Column({ type: "text", nullable: true })
  resolutionNote!: string | null;

  // filled by PostgreSQL (generated column); never written by the app
  @Column({ type: "tsvector", select: false, insert: false, update: false, nullable: true })
  searchTsv!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
