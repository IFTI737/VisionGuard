import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Invoice } from "@/modules/billing/entities/invoice.entity";
import { SubscriptionItem } from "@/modules/billing/entities/subscription-item.entity";

@Entity({ name: "invoice_lines" })
export class InvoiceLine {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  invoiceId!: string;

  @ManyToOne(() => Invoice, { onDelete: "CASCADE" })
  @JoinColumn({ name: "invoice_id" })
  invoice!: Invoice;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "integer" })
  amountMinor!: number;

  @Column({ type: "uuid", nullable: true })
  subscriptionItemId!: string | null;

  @ManyToOne(() => SubscriptionItem, { onDelete: "SET NULL" })
  @JoinColumn({ name: "subscription_item_id" })
  subscriptionItem!: SubscriptionItem | null;
}
