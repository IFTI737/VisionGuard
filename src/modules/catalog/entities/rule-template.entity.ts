import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { RuleTemplatesDefaultSeverity, RuleTemplatesKind, RuleTemplatesStatus } from "@/common/constants/check-values";
import { Pack } from "@/modules/catalog/entities/pack.entity";

@Entity({ name: "rule_templates" })
export class RuleTemplate {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  packId!: string;

  @ManyToOne(() => Pack, { onDelete: "CASCADE" })
  @JoinColumn({ name: "pack_id" })
  pack!: Pack;

  @Column({ type: "text" })
  code!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "text" })
  kind!: RuleTemplatesKind;

  @Column({ type: "jsonb" })
  defaultParams!: any;

  @Column({ type: "jsonb" })
  paramSchema!: any;

  @Column({ type: "text" })
  defaultSeverity!: RuleTemplatesDefaultSeverity;

  @Column({ type: "jsonb", nullable: true })
  defaultSchedule!: any | null;

  @Column({ type: "integer", default: 10 })
  defaultSustainS!: number;

  @Column({ type: "integer", default: 30 })
  defaultClearS!: number;

  @Column({ type: "integer", default: 300 })
  defaultCooldownS!: number;

  @Column({ type: "text", array: true, default: () => "'{}'::text[]" })
  zoneKinds!: string[];

  @Column({ type: "text", array: true, default: () => "'{}'::text[]" })
  requiredClasses!: string[];

  @Column({ type: "boolean", default: false })
  autoProvision!: boolean;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  i18n!: any;

  @Column({ type: "text", default: "active" })
  status!: RuleTemplatesStatus;
}
