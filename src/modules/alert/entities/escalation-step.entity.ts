import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { EscalationStepsAudience, EscalationStepsChannels, EscalationStepsRole } from "@/common/constants/check-values";
import { EscalationPolicy } from "@/modules/alert/entities/escalation-policy.entity";

@Entity({ name: "escalation_steps" })
export class EscalationStep {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  policyId!: string;

  @ManyToOne(() => EscalationPolicy, { onDelete: "CASCADE" })
  @JoinColumn({ name: "policy_id" })
  policy!: EscalationPolicy;

  @Column({ type: "smallint" })
  stepNo!: number;

  @Column({ type: "integer" })
  waitS!: number;

  @Column({ type: "text", array: true })
  channels!: EscalationStepsChannels[];

  @Column({ type: "text" })
  audience!: EscalationStepsAudience;

  @Column({ type: "text", nullable: true })
  role!: EscalationStepsRole | null;

  @Column({ type: "smallint", default: 1 })
  callCount!: number;

  @Column({ type: "smallint", default: 30 })
  ringTimeoutS!: number;
}
