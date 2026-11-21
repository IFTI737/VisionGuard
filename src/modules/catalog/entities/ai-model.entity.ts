import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { AiModelsOutputKind, AiModelsRuntime, AiModelsStatus, AiModelsTask } from "@/common/constants/check-values";
import { ObjectClass } from "@/modules/catalog/entities/object-class.entity";

@Entity({ name: "ai_models" })
export class AiModel {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  code!: string;

  @Column({ type: "text" })
  version!: string;

  @Column({ type: "text" })
  task!: AiModelsTask;

  @Column({ type: "text" })
  runtime!: AiModelsRuntime;

  @Column({ type: "smallint", default: 1 })
  stage!: number;

  @Column({ type: "text", nullable: true })
  triggerClassCode!: string | null;

  @ManyToOne(() => ObjectClass, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "trigger_class_code", referencedColumnName: "code" })
  triggerClassCodeObjectClass!: ObjectClass | null;

  @Column({ type: "text" })
  outputKind!: AiModelsOutputKind;

  @Column({ type: "text", nullable: true })
  artifactUrl!: string | null;

  @Column({ type: "text", nullable: true })
  artifactSha256!: string | null;

  @Column({ type: "integer", default: 640 })
  inputSize!: number;

  @Column({ type: "real", default: 0.35 })
  defaultConf!: number;

  @Column({ type: "integer", default: 1000 })
  defaultIntervalMs!: number;

  @Column({ type: "text", default: "active" })
  status!: AiModelsStatus;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
