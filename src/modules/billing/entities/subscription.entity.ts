import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { SubscriptionsStatus } from "@/common/constants/check-values";
import { Plan } from "@/modules/billing/entities/plan.entity";
import { Site } from "@/modules/site/entities/site.entity";

@Entity({ name: "subscriptions" })
export class Subscription {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "uuid" })
  planId!: string;

  @ManyToOne(() => Plan, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "plan_id" })
  plan!: Plan;

  @Column({ type: "text" })
  status!: SubscriptionsStatus;

  @Column({ type: "timestamptz", nullable: true })
  trialEndsAt!: Date | null;

  @Column({ type: "timestamptz" })
  currentPeriodStart!: Date;

  @Column({ type: "timestamptz" })
  currentPeriodEnd!: Date;

  @Column({ type: "timestamptz", nullable: true })
  graceUntil!: Date | null;

  @Column({ type: "boolean", default: false })
  cancelAtPeriodEnd!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
