import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { ConversationsKind } from "@/common/constants/check-values";
import { Alert } from "@/modules/alert/entities/alert.entity";
import { Site } from "@/modules/site/entities/site.entity";

@Entity({ name: "conversations" })
export class Conversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  siteId!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "text" })
  kind!: ConversationsKind;

  @Column({ type: "uuid", nullable: true })
  alertId!: string | null;

  @ManyToOne(() => Alert, { onDelete: "CASCADE" })
  @JoinColumn({ name: "alert_id" })
  alert!: Alert | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;
}
