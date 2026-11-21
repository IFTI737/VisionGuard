import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { NotificationEndpointsKind } from "@/common/constants/check-values";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "notification_endpoints" })
export class NotificationEndpoint {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "text" })
  kind!: NotificationEndpointsKind;

  @Column({ type: "text" })
  address!: string;

  @Column({ type: "jsonb", nullable: true })
  keys!: any | null;

  @Column({ type: "text", nullable: true })
  label!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ type: "smallint", default: 0 })
  failCount!: number;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
