import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { RecordingSegmentsContainer, RecordingSegmentsStored } from "@/common/constants/check-values";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Media } from "@/modules/media/entities/media.entity";

@Entity({ name: "recording_segments" })
export class RecordingSegment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @Column({ type: "uuid" })
  cameraId!: string;

  @ManyToOne(() => Camera, { onDelete: "CASCADE" })
  @JoinColumn({ name: "camera_id" })
  camera!: Camera;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz" })
  endedAt!: Date;

  @Column({ type: "text" })
  container!: RecordingSegmentsContainer;

  @Column({ type: "text", nullable: true })
  codec!: string | null;

  @Column({ type: "text", default: "cloud" })
  stored!: RecordingSegmentsStored;

  @Column({ type: "uuid", nullable: true })
  mediaId!: string | null;

  @ManyToOne(() => Media, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "media_id" })
  media!: Media | null;

  @Column({ type: "uuid", nullable: true })
  initMediaId!: string | null;

  @ManyToOne(() => Media, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "init_media_id" })
  initMedia!: Media | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
