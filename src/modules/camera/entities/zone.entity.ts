import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { ZonesAnchor, ZonesKind } from "@/common/constants/check-values";
import { Camera } from "@/modules/camera/entities/camera.entity";

@Entity({ name: "zones" })
export class Zone {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @Column({ type: "uuid" })
  cameraId!: string;

  @ManyToOne(() => Camera, { onDelete: "CASCADE" })
  @JoinColumn({ name: "camera_id" })
  camera!: Camera;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", default: "general" })
  kind!: ZonesKind;

  @Column({ type: "jsonb" })
  polygon!: any;

  @Column({ type: "text", default: "foot" })
  anchor!: ZonesAnchor;

  @Column({ type: "real", default: 0.35 })
  minOverlap!: number;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  mutedUntil!: Date | null;

  @Column({ type: "integer", default: 1 })
  version!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ type: "timestamptz" })
  deletedAt!: Date | null;
}
