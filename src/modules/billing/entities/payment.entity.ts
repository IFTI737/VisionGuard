import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { PaymentsProvider, PaymentsStatus } from "@/common/constants/check-values";
import { Invoice } from "@/modules/billing/entities/invoice.entity";

@Entity({ name: "payments" })
export class Payment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  invoiceId!: string;

  @ManyToOne(() => Invoice, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "invoice_id" })
  invoice!: Invoice;

  @Column({ type: "text" })
  provider!: PaymentsProvider;

  @Column({ type: "text" })
  providerTxnId!: string;

  @Column({ type: "integer" })
  amountMinor!: number;

  @Column({ type: "text", default: "initiated" })
  status!: PaymentsStatus;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  raw!: any;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  confirmedAt!: Date | null;
}
