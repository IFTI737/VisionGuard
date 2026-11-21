import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { AiModel } from "@/modules/catalog/entities/ai-model.entity";
import { ObjectClass } from "@/modules/catalog/entities/object-class.entity";

@Entity({ name: "model_classes" })
export class ModelClass {
  @PrimaryColumn({ type: "uuid" })
  modelId!: string;

  @ManyToOne(() => AiModel, { onDelete: "CASCADE" })
  @JoinColumn({ name: "model_id" })
  model!: AiModel;

  @PrimaryColumn({ type: "text" })
  classCode!: string;

  @ManyToOne(() => ObjectClass, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "class_code", referencedColumnName: "code" })
  classCodeObjectClass!: ObjectClass;

  @Column({ type: "smallint" })
  classIndex!: number;

  @Column({ type: "real", nullable: true })
  defaultConf!: number | null;
}
