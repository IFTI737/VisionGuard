import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { InvoicesStatus } from "@/common/constants/check-values";
import { Site } from "@/modules/site/entities/site.entity";
import { Subscription } from "@/modules/billing/entities/subscription.entity";

@Entity({ name: "invoices" })
export class Invoice {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  number!: string;

  @Column({ type: "uuid", nullable: true })
  siteId!: string | null;

  @ManyToOne(() => Site, { onDelete: "SET NULL" })
  @JoinColumn({ name: "site_id" })
  site!: Site | null;

  @Column({ type: "uuid", nullable: true })
  subscriptionId!: string | null;

  @ManyToOne(() => Subscription, { onDelete: "SET NULL" })
  @JoinColumn({ name: "subscription_id" })
  subscription!: Subscription | null;

  @Column({ type: "text" })
  billingName!: string;

  @Column({ type: "timestamptz" })
  periodStart!: Date;

  @Column({ type: "timestamptz" })
  periodEnd!: Date;

  @Column({ type: "text", default: "draft" })
  status!: InvoicesStatus;

  @Column({ type: "integer", default: 0 })
  totalMinor!: number;

  @Column({ type: "char", length: 3, default: "BDT" })
  currency!: string;

  @Column({ type: "timestamptz", nullable: true })
  issuedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  dueAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
