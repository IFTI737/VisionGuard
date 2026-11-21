import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { AlertRecipientsStatus } from "@/common/constants/check-values";
import { Alert } from "@/modules/alert/entities/alert.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";

@Entity({ name: "alert_recipients" })
export class AlertRecipient {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  alertId!: string;

  @ManyToOne(() => Alert, { onDelete: "CASCADE" })
  @JoinColumn({ name: "alert_id" })
  alert!: Alert;

  @Column({ type: "uuid" })
  siteId!: string;

  @Column({ type: "uuid" })
  memberId!: string;

  @ManyToOne(() => SiteMember, { onDelete: "CASCADE" })
  @JoinColumn({ name: "member_id" })
  member!: SiteMember;

  @Column({ type: "smallint" })
  stepNo!: number;

  @Column({ type: "text", default: "pending" })
  status!: AlertRecipientsStatus;

  @Column({ type: "bytea", nullable: true, select: false })
  ackTokenHash!: Buffer | null;

  @Column({ type: "timestamptz", nullable: true })
  notifiedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  seenAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  ackedAt!: Date | null;
}
