import { paged } from "@/common/dto/page-query.dto";
import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { CreateTicketDto, ListTicketsDto, TicketMessageDto, UpdateTicketDto } from "@/modules/support/dto/support.dto";
import { SupportTicket } from "@/modules/support/entities/support-ticket.entity";
import { TicketMessage } from "@/modules/support/entities/ticket-message.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ILike, Repository } from "typeorm";

/** Complaints, bugs, billing questions and requests for custom detection features. */
@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket) private readonly ticketRepository: Repository<SupportTicket>,
    @InjectRepository(TicketMessage) private readonly messageRepository: Repository<TicketMessage>,
    @InjectRepository(SiteMember) private readonly memberRepository: Repository<SiteMember>,
  ) {}

  // ---------------- customer side ----------------

  async create(user: AuthUser, dto: CreateTicketDto) {
    if (dto.siteId) {
      const member = await this.memberRepository.findOne({ where: { siteId: dto.siteId, userId: user.id, status: "active" } });
      if (!member) throw new ForbiddenException("You are not a member of that site");
    }
    const ticket = await this.ticketRepository.save(
      this.ticketRepository.create({ siteId: dto.siteId ?? null, requesterUserId: user.id, category: dto.category, subject: dto.subject }),
    );
    await this.messageRepository.save(this.messageRepository.create({ ticketId: ticket.id, senderUserId: user.id, body: dto.body }));
    return this.ticketRepository.findOneOrFail({ where: { id: ticket.id } }); // reload: the ticket number is given by PostgreSQL
  }

  listMine(userId: string) {
    return this.ticketRepository.find({ where: { requesterUserId: userId }, order: { createdAt: "DESC" } });
  }

  async getMine(userId: string, ticketId: string) {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId, requesterUserId: userId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    // the customer never sees internal staff notes
    const messages = await this.messageRepository.find({ where: { ticketId, isInternal: false }, order: { id: "ASC" } });
    return { ...ticket, messages };
  }

  async replyAsCustomer(userId: string, ticketId: string, dto: TicketMessageDto) {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId, requesterUserId: userId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    if (ticket.status === "closed") throw new BadRequestException("This ticket is closed. Open a new one.");
    const message = await this.messageRepository.save(this.messageRepository.create({ ticketId, senderUserId: userId, body: dto.body }));
    if (ticket.status === "waiting_customer") await this.ticketRepository.update({ id: ticketId }, { status: "in_progress" });
    return message;
  }

  // ---------------- staff side (admin panel) ----------------

  async queue(query: ListTicketsDto) {
    const [items, total] = await this.ticketRepository.findAndCount({
      where: {
        ...(query.status ? { status: query.status } : {}), ...(query.priority ? { priority: query.priority } : {}),
        ...(query.category ? { category: query.category } : {}), ...(query.q ? { subject: ILike(`%${query.q}%`) } : {}), // uses the trigram index
      },
      order: { createdAt: "DESC" }, take: query.limit, skip: query.offset,
    });
    return paged(items, total, query);
  }

  async getForStaff(ticketId: string) {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("Ticket not found");
    return { ...ticket, messages: await this.messageRepository.find({ where: { ticketId }, order: { id: "ASC" } }) };
  }

  async updateByStaff(ticketId: string, dto: UpdateTicketDto) {
    const ticket = await this.getForStaff(ticketId);
    await this.ticketRepository.update({ id: ticketId }, { ...dto, ...(dto.status === "resolved" && !ticket.resolvedAt ? { resolvedAt: new Date() } : {}) });
    return this.getForStaff(ticketId);
  }

  async replyAsStaff(staff: AuthUser, ticketId: string, dto: TicketMessageDto) {
    const ticket = await this.getForStaff(ticketId);
    const message = await this.messageRepository.save(this.messageRepository.create({ ticketId, senderUserId: staff.id, body: dto.body, isInternal: dto.isInternal ?? false }));
    if (!dto.isInternal) {
      await this.ticketRepository.update(
        { id: ticketId },
        { status: "waiting_customer", assignedTo: ticket.assignedTo ?? staff.id, ...(ticket.firstResponseAt ? {} : { firstResponseAt: new Date() }) },
      );
    }
    return message;
  }

  /** A price for a requested custom feature. */
  async quote(ticketId: string, priceMinor: number) {
    const ticket = await this.getForStaff(ticketId);
    if (ticket.category !== "feature_request") throw new BadRequestException("Only feature requests get a price");
    await this.ticketRepository.update({ id: ticketId }, { quotedPriceMinor: priceMinor, status: "waiting_customer" });
    return this.getForStaff(ticketId);
  }
}
