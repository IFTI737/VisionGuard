import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import type { SupportTicketsCategory, SupportTicketsPriority, SupportTicketsStatus } from "@/common/constants/check-values";
import { Pack } from "@/modules/catalog/entities/pack.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "support_tickets" })
export class SupportTicket {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // numbered by PostgreSQL (identity column)
  @Column({ type: "bigint", insert: false, update: false })
  number!: string;

  @Column({ type: "uuid", nullable: true })
  siteId!: string | null;

  @ManyToOne(() => Site, { onDelete: "SET NULL" })
  @JoinColumn({ name: "site_id" })
  site!: Site | null;

  @Column({ type: "uuid", nullable: true })
  requesterUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "requester_user_id" })
  requesterUser!: User | null;

  @Column({ type: "text" })
  category!: SupportTicketsCategory;

  @Column({ type: "text" })
  subject!: string;

  @Column({ type: "text", default: "normal" })
  priority!: SupportTicketsPriority;

  @Column({ type: "text", default: "open" })
  status!: SupportTicketsStatus;

  @Column({ type: "uuid", nullable: true })
  assignedTo!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "assigned_to" })
  assignedToUser!: User | null;

  @Column({ type: "integer", nullable: true })
  quotedPriceMinor!: number | null;

  @Column({ type: "uuid", nullable: true })
  deliveredPackId!: string | null;

  @ManyToOne(() => Pack, { onDelete: "SET NULL" })
  @JoinColumn({ name: "delivered_pack_id" })
  deliveredPack!: Pack | null;

  @Column({ type: "timestamptz", nullable: true })
  firstResponseAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
