import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { LiveViewSessionsEndReason, LiveViewSessionsTransport } from "@/common/constants/check-values";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "live_view_sessions" })
export class LiveViewSession {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @Column({ type: "uuid" })
  cameraId!: string;

  @ManyToOne(() => Camera, { onDelete: "CASCADE" })
  @JoinColumn({ name: "camera_id" })
  camera!: Camera;

  @Column({ type: "uuid" })
  viewerUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "viewer_user_id" })
  viewerUser!: User;

  @Column({ type: "text", nullable: true })
  transport!: LiveViewSessionsTransport | null;

  @Column({ type: "timestamptz", default: () => "now()" })
  startedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  connectedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  endedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  endReason!: LiveViewSessionsEndReason | null;
}
