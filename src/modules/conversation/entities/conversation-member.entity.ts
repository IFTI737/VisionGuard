import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Conversation } from "@/modules/conversation/entities/conversation.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";

@Entity({ name: "conversation_members" })
export class ConversationMember {
  @PrimaryColumn({ type: "uuid" })
  conversationId!: string;

  @ManyToOne(() => Conversation, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation!: Conversation;

  @PrimaryColumn({ type: "uuid" })
  memberId!: string;

  @ManyToOne(() => SiteMember, { onDelete: "CASCADE" })
  @JoinColumn({ name: "member_id" })
  member!: SiteMember;

  @Column({ type: "bigint", default: 0 })
  lastReadId!: string;

  @Column({ type: "boolean", default: false })
  muted!: boolean;
}
