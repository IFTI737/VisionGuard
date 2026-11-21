import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { AlertsAcknowledgedVia, AlertsSeverity, AlertsSource, AlertsStatus } from "@/common/constants/check-values";
import { EscalationPolicy } from "@/modules/alert/entities/escalation-policy.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";

@Entity({ name: "alerts" })
export class Alert {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "text" })
  source!: AlertsSource;

  @Column({ type: "uuid", nullable: true })
  senderMemberId!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "sender_member_id" })
  senderMember!: SiteMember | null;

  @Column({ type: "uuid", nullable: true })
  policyId!: string | null;

  @ManyToOne(() => EscalationPolicy, { onDelete: "SET NULL" })
  @JoinColumn({ name: "policy_id" })
  policy!: EscalationPolicy | null;

  @Column({ type: "text" })
  title!: string;

  @Column({ type: "text", nullable: true })
  body!: string | null;

  @Column({ type: "text" })
  severity!: AlertsSeverity;

  @Column({ type: "smallint", nullable: true })
  riskScore!: number | null;

  @Column({ type: "text", default: "active" })
  status!: AlertsStatus;

  @Column({ type: "smallint", default: 0 })
  currentStep!: number;

  @Column({ type: "text", nullable: true })
  clientRequestId!: string | null;

  @Column({ type: "uuid", nullable: true })
  acknowledgedBy!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "acknowledged_by" })
  acknowledgedBySiteMember!: SiteMember | null;

  @Column({ type: "text", nullable: true })
  acknowledgedVia!: AlertsAcknowledgedVia | null;

  @Column({ type: "timestamptz", nullable: true })
  acknowledgedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  closedAt!: Date | null;
}
