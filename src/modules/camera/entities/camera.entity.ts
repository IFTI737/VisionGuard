import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { CamerasRecordingMode, CamerasSourceKind, CamerasStatus } from "@/common/constants/check-values";
import { Area } from "@/modules/site/entities/area.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { Site } from "@/modules/site/entities/site.entity";

@Entity({ name: "cameras" })
export class Camera {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "uuid" })
  areaId!: string;

  @ManyToOne(() => Area, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "area_id" })
  area!: Area;

  @Column({ type: "uuid", nullable: true })
  deviceId!: string | null;

  @ManyToOne(() => Device, { onDelete: "SET NULL" })
  @JoinColumn({ name: "device_id" })
  device!: Device | null;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text" })
  sourceKind!: CamerasSourceKind;

  @Column({ type: "text", nullable: true })
  sourceRef!: string | null;

  @Column({ type: "text", default: "incident_only" })
  recordingMode!: CamerasRecordingMode;

  @Column({ type: "text", default: "pending" })
  status!: CamerasStatus;

  @Column({ type: "timestamptz", nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ type: "timestamptz" })
  deletedAt!: Date | null;
}
