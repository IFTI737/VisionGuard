import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { DetectionFeedbackExportStatus, DetectionFeedbackLabel } from "@/common/constants/check-values";
import { Incident } from "@/modules/incident/entities/incident.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { Snapshot } from "@/modules/media/entities/snapshot.entity";

@Entity({ name: "detection_feedback" })
export class DetectionFeedback {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "uuid", nullable: true })
  incidentId!: string | null;

  @ManyToOne(() => Incident, { onDelete: "SET NULL" })
  @JoinColumn({ name: "incident_id" })
  incident!: Incident | null;

  @Column({ type: "uuid", nullable: true })
  snapshotId!: string | null;

  @ManyToOne(() => Snapshot, { onDelete: "SET NULL" })
  @JoinColumn({ name: "snapshot_id" })
  snapshot!: Snapshot | null;

  @Column({ type: "text" })
  label!: DetectionFeedbackLabel;

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @Column({ type: "text", nullable: true })
  modelCode!: string | null;

  @Column({ type: "text", nullable: true })
  modelVersion!: string | null;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  detections!: any;

  @Column({ type: "jsonb", nullable: true })
  corrected!: any | null;

  @Column({ type: "uuid", nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdBySiteMember!: SiteMember | null;

  @Column({ type: "text", default: "pending" })
  exportStatus!: DetectionFeedbackExportStatus;

  @Column({ type: "timestamptz", nullable: true })
  exportedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
