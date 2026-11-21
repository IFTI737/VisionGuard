import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { DeliveryAttemptsChannel, DeliveryAttemptsStatus } from "@/common/constants/check-values";
import { AlertRecipient } from "@/modules/alert/entities/alert-recipient.entity";
import { NotificationEndpoint } from "@/modules/user/entities/notification-endpoint.entity";

@Entity({ name: "delivery_attempts" })
export class DeliveryAttempt {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  recipientId!: string;

  @ManyToOne(() => AlertRecipient, { onDelete: "CASCADE" })
  @JoinColumn({ name: "recipient_id" })
  recipient!: AlertRecipient;

  @Column({ type: "text" })
  channel!: DeliveryAttemptsChannel;

  @Column({ type: "uuid", nullable: true })
  endpointId!: string | null;

  @ManyToOne(() => NotificationEndpoint, { onDelete: "SET NULL" })
  @JoinColumn({ name: "endpoint_id" })
  endpoint!: NotificationEndpoint | null;

  @Column({ type: "smallint", default: 1 })
  attemptNo!: number;

  @Column({ type: "text", default: "queued" })
  status!: DeliveryAttemptsStatus;

  @Column({ type: "text", nullable: true })
  provider!: string | null;

  @Column({ type: "text", nullable: true })
  providerRef!: string | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  meta!: any;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  completedAt!: Date | null;
}
