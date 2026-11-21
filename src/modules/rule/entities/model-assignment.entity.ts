import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { ModelAssignmentsActiveWhen } from "@/common/constants/check-values";
import { AiModel } from "@/modules/catalog/entities/ai-model.entity";
import { Camera } from "@/modules/camera/entities/camera.entity";

@Entity({ name: "model_assignments" })
export class ModelAssignment {
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
  modelId!: string;

  @ManyToOne(() => AiModel, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "model_id" })
  model!: AiModel;

  @Column({ type: "text", default: "always" })
  activeWhen!: ModelAssignmentsActiveWhen;

  @Column({ type: "integer", default: 1000 })
  frameIntervalMs!: number;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  confOverrides!: any;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
