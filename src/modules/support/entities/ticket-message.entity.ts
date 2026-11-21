import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Media } from "@/modules/media/entities/media.entity";
import { SupportTicket } from "@/modules/support/entities/support-ticket.entity";
import { User } from "@/modules/user/entities/user.entity";

@Entity({ name: "ticket_messages" })
export class TicketMessage {
  @PrimaryGeneratedColumn("identity", { type: "bigint", generatedIdentity: "ALWAYS" })
  id!: string;

  @Column({ type: "uuid" })
  ticketId!: string;

  @ManyToOne(() => SupportTicket, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ticket_id" })
  ticket!: SupportTicket;

  @Column({ type: "uuid", nullable: true })
  senderUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "sender_user_id" })
  senderUser!: User | null;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "boolean", default: false })
  isInternal!: boolean;

  @Column({ type: "uuid", nullable: true })
  mediaId!: string | null;

  @ManyToOne(() => Media, { onDelete: "SET NULL" })
  @JoinColumn({ name: "media_id" })
  media!: Media | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
