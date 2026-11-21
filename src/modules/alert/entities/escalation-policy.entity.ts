import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { EscalationPoliciesMinSeverity } from "@/common/constants/check-values";
import { Site } from "@/modules/site/entities/site.entity";

@Entity({ name: "escalation_policies" })
export class EscalationPolicy {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "text", default: "low" })
  minSeverity!: EscalationPoliciesMinSeverity;

  @Column({ type: "smallint", default: 0 })
  repeatCount!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
