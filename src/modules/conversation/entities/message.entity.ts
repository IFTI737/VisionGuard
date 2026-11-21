import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Conversation } from "@/modules/conversation/entities/conversation.entity";
import { Media } from "@/modules/media/entities/media.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";

@Entity({ name: "messages" })
export class Message {
  @PrimaryGeneratedColumn("identity", { type: "bigint", generatedIdentity: "ALWAYS" })
  id!: string;

  @Column({ type: "uuid" })
  conversationId!: string;

  @ManyToOne(() => Conversation, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation!: Conversation;

  @Column({ type: "uuid", nullable: true })
  senderMemberId!: string | null;

  @ManyToOne(() => SiteMember, { onDelete: "SET NULL" })
  @JoinColumn({ name: "sender_member_id" })
  senderMember!: SiteMember | null;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "uuid", nullable: true })
  mediaId!: string | null;

  @ManyToOne(() => Media, { onDelete: "SET NULL" })
  @JoinColumn({ name: "media_id" })
  media!: Media | null;

  @Column({ type: "text", nullable: true })
  clientMsgId!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  editedAt!: Date | null;

  @DeleteDateColumn({ type: "timestamptz" })
  deletedAt!: Date | null;
}
