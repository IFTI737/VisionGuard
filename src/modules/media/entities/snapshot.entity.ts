import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { SnapshotsTrigger } from "@/common/constants/check-values";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Incident } from "@/modules/incident/entities/incident.entity";
import { Media } from "@/modules/media/entities/media.entity";

@Entity({ name: "snapshots" })
export class Snapshot {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @Column({ type: "uuid" })
  cameraId!: string;

  @ManyToOne(() => Camera, { onDelete: "CASCADE" })
  @JoinColumn({ name: "camera_id" })
  camera!: Camera;

  @Column({ type: "uuid", nullable: true })
  incidentId!: string | null;

  @ManyToOne(() => Incident, { onDelete: "SET NULL" })
  @JoinColumn({ name: "incident_id" })
  incident!: Incident | null;

  @Column({ type: "uuid" })
  mediaId!: string;

  @ManyToOne(() => Media, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "media_id" })
  media!: Media;

  @Column({ type: "timestamptz" })
  capturedAt!: Date;

  @Column({ type: "text" })
  trigger!: SnapshotsTrigger;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  detections!: any;

  @Column({ type: "text", nullable: true })
  modelCode!: string | null;

  @Column({ type: "integer", nullable: true })
  frameW!: number | null;

  @Column({ type: "integer", nullable: true })
  frameH!: number | null;
}
