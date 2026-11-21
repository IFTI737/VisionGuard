import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { SubscriptionItemsKind } from "@/common/constants/check-values";
import { Pack } from "@/modules/catalog/entities/pack.entity";
import { Subscription } from "@/modules/billing/entities/subscription.entity";

@Entity({ name: "subscription_items" })
export class SubscriptionItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  subscriptionId!: string;

  @ManyToOne(() => Subscription, { onDelete: "CASCADE" })
  @JoinColumn({ name: "subscription_id" })
  subscription!: Subscription;

  @Column({ type: "uuid" })
  packId!: string;

  @ManyToOne(() => Pack, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "pack_id" })
  pack!: Pack;

  @Column({ type: "text" })
  kind!: SubscriptionItemsKind;

  @Column({ type: "integer", default: 0 })
  unitPriceMinor!: number;

  @Column({ type: "timestamptz", default: () => "now()" })
  startedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  endedAt!: Date | null;
}
