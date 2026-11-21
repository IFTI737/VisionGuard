import { EVENTS } from "@/common/constants/events";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { ListMessagesDto, SendMessageDto } from "@/modules/conversation/dto/conversation.dto";
import { ConversationMember } from "@/modules/conversation/entities/conversation-member.entity";
import { Conversation } from "@/modules/conversation/entities/conversation.entity";
import { Message } from "@/modules/conversation/entities/message.entity";
import { Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";

/**
 * Chat inside a site: one "team" room per site, plus one thread per alert
 * ("I am going to the shed", "false alarm, it was the vet").
 */
@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation) private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(ConversationMember) private readonly conversationMemberRepository: Repository<ConversationMember>,
    @InjectRepository(Message) private readonly messageRepository: Repository<Message>,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent(EVENTS.SITE_CREATED)
  async onSiteCreated(payload: { siteId: string; manager: EntityManager }) {
    await payload.manager.save(payload.manager.create(Conversation, { siteId: payload.siteId, kind: "team" }));
  }

  /** Every alert gets its own thread the moment it starts (currentStep 0). */
  @OnEvent(EVENTS.ALERT_UPDATED)
  async onAlert(payload: { siteId: string; id: string; currentStep: number; status: string }) {
    if (payload.currentStep !== 0 || payload.status !== "active") return;
    await this.conversationRepository.createQueryBuilder().insert().values({ siteId: payload.siteId, kind: "alert", alertId: payload.id }).orIgnore().execute();
  }

  /** The team room and the alert threads, newest first, each with my unread count. */
  async list(ctx: SiteContext) {
    return this.dataSource.query(
      `SELECT c.id, c.kind, c.alert_id AS "alertId", c.last_message_at AS "lastMessageAt", a.title AS "alertTitle",
              (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                 AND m.id > coalesce(cm.last_read_id, 0) AND m.sender_member_id IS DISTINCT FROM $2) AS unread
       FROM conversations c
       LEFT JOIN alerts a ON a.id = c.alert_id
       LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.member_id = $2
       WHERE c.site_id = $1 ORDER BY (c.kind = 'team') DESC, c.last_message_at DESC NULLS LAST, c.created_at DESC LIMIT 50`,
      [ctx.site.id, ctx.member.id],
    );
  }

  async messages(ctx: SiteContext, conversationId: string, query: ListMessagesDto) {
    await this.findOrFail(ctx.site.id, conversationId);
    const qb = this.messageRepository.createQueryBuilder("m").where("m.conversationId = :conversationId AND m.deletedAt IS NULL", { conversationId });
    if (query.before) qb.andWhere("m.id < :before", { before: query.before });
    const items = await qb.orderBy("m.id", "DESC").take(query.limit).getMany();
    return items.reverse(); // oldest first, ready to show
  }

  /**
   * clientMsgId makes sending safe to retry: the unique index
   * (conversation, sender, client_msg_id) keeps one copy, and the retry gets it back.
   */
  async send(ctx: SiteContext, conversationId: string, dto: SendMessageDto) {
    const conversation = await this.findOrFail(ctx.site.id, conversationId);
    let message: Message;
    try {
      message = await this.messageRepository.save(
        this.messageRepository.create({ conversationId, senderMemberId: ctx.member.id, body: dto.body, mediaId: dto.mediaId ?? null, clientMsgId: dto.clientMsgId ?? null }),
      );
    } catch (error: any) {
      if (error?.code === "23505" && dto.clientMsgId)
        return this.messageRepository.findOneOrFail({ where: { conversationId, senderMemberId: ctx.member.id, clientMsgId: dto.clientMsgId } });
      throw error;
    }
    await this.conversationRepository.update({ id: conversationId }, { lastMessageAt: new Date() });
    this.events.emit(EVENTS.MESSAGE_CREATED, { siteId: conversation.siteId, conversationId, id: Number(message.id), senderMemberId: ctx.member.id, body: message.body, createdAt: message.createdAt });
    return message;
  }

  async markRead(ctx: SiteContext, conversationId: string, lastReadId: number) {
    await this.findOrFail(ctx.site.id, conversationId);
    await this.conversationMemberRepository.upsert({ conversationId, memberId: ctx.member.id, lastReadId: String(lastReadId) }, ["conversationId", "memberId"]);
  }

  private async findOrFail(siteId: string, conversationId: string) {
    const conversation = await this.conversationRepository.findOne({ where: { id: conversationId, siteId } });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }
}
