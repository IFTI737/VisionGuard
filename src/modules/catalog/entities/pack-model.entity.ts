import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { AiModel } from "@/modules/catalog/entities/ai-model.entity";
import { Pack } from "@/modules/catalog/entities/pack.entity";

@Entity({ name: "pack_models" })
export class PackModel {
  @PrimaryColumn({ type: "uuid" })
  packId!: string;

  @ManyToOne(() => Pack, { onDelete: "CASCADE" })
  @JoinColumn({ name: "pack_id" })
  pack!: Pack;

  @PrimaryColumn({ type: "uuid" })
  modelId!: string;

  @ManyToOne(() => AiModel, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "model_id" })
  model!: AiModel;

  @Column({ type: "boolean", default: true })
  required!: boolean;
}
