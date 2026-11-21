import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { ExportJobsFormat, ExportJobsReportType, ExportJobsStatus } from "@/common/constants/check-values";
import { Media } from "@/modules/media/entities/media.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";

@Entity({ name: "export_jobs" })
export class ExportJob {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "uuid", nullable: true })
  requestedBy!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "requested_by" })
  requestedBySiteMember!: SiteMember | null;

  @Column({ type: "text" })
  reportType!: ExportJobsReportType;

  @Column({ type: "text" })
  format!: ExportJobsFormat;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  params!: any;

  @Column({ type: "text", default: "queued" })
  status!: ExportJobsStatus;

  @Column({ type: "uuid", nullable: true })
  mediaId!: string | null;

  @ManyToOne(() => Media, { onDelete: "SET NULL" })
  @JoinColumn({ name: "media_id" })
  media!: Media | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt!: Date | null;
}
