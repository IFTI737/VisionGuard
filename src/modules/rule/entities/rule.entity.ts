import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { RulesSeverity } from "@/common/constants/check-values";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { RuleTemplate } from "@/modules/catalog/entities/rule-template.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { User } from "@/modules/user/entities/user.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";

@Entity({ name: "rules" })
export class Rule {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "uuid", nullable: true })
  zoneId!: string | null;

  @ManyToOne(() => Zone, { onDelete: "CASCADE" })
  @JoinColumn({ name: "zone_id" })
  zone!: Zone | null;

  @Column({ type: "uuid", nullable: true })
  cameraId!: string | null;

  @ManyToOne(() => Camera, { onDelete: "CASCADE" })
  @JoinColumn({ name: "camera_id" })
  camera!: Camera | null;

  @Column({ type: "uuid" })
  templateId!: string;

  @ManyToOne(() => RuleTemplate, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "template_id" })
  template!: RuleTemplate;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "jsonb" })
  params!: any;

  @Column({ type: "text" })
  severity!: RulesSeverity;

  @Column({ type: "jsonb", nullable: true })
  schedule!: any | null;

  @Column({ type: "integer" })
  sustainS!: number;

  @Column({ type: "integer" })
  clearS!: number;

  @Column({ type: "integer" })
  cooldownS!: number;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  mutedUntil!: Date | null;

  @Column({ type: "integer", default: 1 })
  version!: number;

  @Column({ type: "uuid", nullable: true })
  createdBy!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdByUser!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ type: "timestamptz" })
  deletedAt!: Date | null;
}
