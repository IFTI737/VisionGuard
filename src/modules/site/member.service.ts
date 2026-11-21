import { randomToken, sha256 } from "@/common/helpers/crypto.helper";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { appConfig } from "@/config/app.config";
import { AuditService } from "@/modules/audit/audit.service";
import { CreateContactDto, InviteMemberDto, NotifyPrefsDto, UpdateMemberDto } from "@/modules/site/dto/site.dto";
import { Area } from "@/modules/site/entities/area.entity";
import { MemberAreaScope } from "@/modules/site/entities/member-area-scope.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { User } from "@/modules/user/entities/user.entity";
import { MailService } from "@/providers/mail/mail.service";
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, Not, Repository } from "typeorm";

@Injectable()
export class MemberService {
  constructor(
    @InjectRepository(SiteMember) private readonly memberRepository: Repository<SiteMember>,
    @InjectRepository(MemberAreaScope) private readonly scopeRepository: Repository<MemberAreaScope>,
    @InjectRepository(Area) private readonly areaRepository: Repository<Area>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async list(siteId: string) {
    const members = await this.memberRepository.find({
      where: { siteId, status: Not("removed") },
      order: { createdAt: "ASC" },
    });
    const scopes = await this.scopeRepository.find({ where: { siteId } });
    return members.map((m) => ({
      ...m,
      areaIds: m.allAreas ? null : scopes.filter((s) => s.memberId === m.id).map((s) => s.areaId),
    }));
  }

  /**
   * Invite a person who already has an account (by email), or a person by phone.
   * The row is created with status "invited"; it becomes "active" when the
   * person accepts with the token (POST /v1/invites/accept).
   */
  async invite(ctx: SiteContext, dto: InviteMemberDto) {
    if (!dto.email && !dto.phone) throw new BadRequestException("Give an email or a phone number");
    let userId: string | null = null;
    let email: string | null = null;
    if (dto.email) {
      const user = await this.userRepository.findOne({ where: { email: dto.email.toLowerCase() } });
      if (!user) throw new NotFoundException("No account with this email. Ask the person to register first, or invite by phone.");
      userId = user.id;
      email = user.email;
    }
    const token = randomToken();
    try {
      const member = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(
          manager.create(SiteMember, {
            siteId: ctx.site.id, userId, phone: dto.phone ?? null, role: dto.role, status: "invited",
            displayName: dto.displayName, permissions: dto.permissions ?? [],
            allAreas: !dto.areaIds, invitedBy: ctx.member.id, invitedAt: new Date(), inviteTokenHash: sha256(token),
          }),
        );
        if (dto.areaIds) await this.replaceScopes(manager, ctx.site.id, saved.id, dto.areaIds);
        return saved;
      });
      if (email) await this.mail.send(email, `You were invited to ${ctx.site.name}`, `Open VisionGuard and accept the invitation with this code: ${token}`);
      await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "member.invite", entityType: "site_member", entityId: member.id, data: { role: dto.role } });
      return { member, inviteToken: appConfig.env.EXPOSE_DEV_CODES ? token : undefined };
    } catch (error: any) {
      if (error?.code === "23505") throw new ConflictException("This person is already a member of the site");
      throw error;
    }
  }

  async acceptInvite(userId: string, token: string) {
    const member = await this.memberRepository
      .createQueryBuilder("m")
      .where("m.inviteTokenHash = :hash AND m.status = 'invited'", { hash: sha256(token) })
      .getOne();
    if (!member) throw new NotFoundException("Invitation not found or already used");
    if (member.userId && member.userId !== userId)
      throw new ForbiddenException("This invitation is for another account");
    await this.memberRepository.update(
      { id: member.id },
      { userId, status: "active", joinedAt: new Date(), inviteTokenHash: null },
    );
    return { siteId: member.siteId, memberId: member.id, role: member.role };
  }

  /** A contact has no login. They only receive voice calls from the call list. */
  async addContact(ctx: SiteContext, dto: CreateContactDto) {
    try {
      return await this.memberRepository.save(
        this.memberRepository.create({ siteId: ctx.site.id, role: "contact", status: "active", displayName: dto.displayName, phone: dto.phone, invitedBy: ctx.member.id }),
      );
    } catch (error: any) {
      if (error?.code === "23505") throw new ConflictException("This phone number is already on the site");
      throw error;
    }
  }

  async update(ctx: SiteContext, memberId: string, dto: UpdateMemberDto) {
    const member = await this.findOrFail(ctx.site.id, memberId);
    if (member.role === "owner") throw new ForbiddenException("The owner cannot be changed here. Use transfer-ownership.");
    if (member.role === "contact" && dto.role) throw new BadRequestException("A contact has no login, so it cannot get a role");
    await this.dataSource.transaction(async (manager) => {
      const { areaIds, ...fields } = dto;
      if (areaIds) {
        await this.replaceScopes(manager, ctx.site.id, memberId, areaIds);
        fields.allAreas = false;
      }
      if (fields.allAreas === true) await manager.delete(MemberAreaScope, { memberId });
      if (Object.keys(fields).length) await manager.update(SiteMember, { id: memberId }, fields);
    });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "member.update", entityType: "site_member", entityId: memberId, data: { ...dto } });
    return this.findOrFail(ctx.site.id, memberId);
  }

  async remove(ctx: SiteContext, memberId: string) {
    const member = await this.findOrFail(ctx.site.id, memberId);
    if (member.role === "owner") throw new ForbiddenException("The owner cannot be removed");
    await this.memberRepository.update({ id: memberId }, { status: "removed", callPriority: null });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "member.remove", entityType: "site_member", entityId: memberId });
  }

  /** Who gets a phone call, and in which order, when nobody acknowledges an alert. */
  async setCallList(ctx: SiteContext, memberIds: string[]) {
    if (new Set(memberIds).size !== memberIds.length) throw new BadRequestException("A member appears twice");
    const members = await this.memberRepository.find({ where: { siteId: ctx.site.id, id: In(memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]), status: "active" } });
    if (members.length !== memberIds.length) throw new BadRequestException("Every id must be an active member of this site");
    await this.dataSource.transaction(async (manager) => {
      // clear first: the unique index (site, call_priority) must not collide half-way
      await manager.update(SiteMember, { siteId: ctx.site.id }, { callPriority: null });
      for (let i = 0; i < memberIds.length; i++)
        await manager.update(SiteMember, { id: memberIds[i] }, { callPriority: i + 1 });
    });
    return this.memberRepository.find({ where: { siteId: ctx.site.id, status: "active" }, order: { callPriority: "ASC" } });
  }

  async updateNotifyPrefs(ctx: SiteContext, dto: NotifyPrefsDto) {
    await this.memberRepository.update({ id: ctx.member.id }, { notifyPrefs: dto as any });
    return this.findOrFail(ctx.site.id, ctx.member.id);
  }

  async transferOwnership(ctx: SiteContext, memberId: string) {
    if (ctx.member.role !== "owner") throw new ForbiddenException("Only the owner can transfer ownership");
    const target = await this.findOrFail(ctx.site.id, memberId);
    if (!target.userId || target.status !== "active") throw new BadRequestException("The new owner must be an active member with an account");
    await this.dataSource.transaction(async (manager) => {
      // order matters: there may be only one active owner at any moment (unique index)
      await manager.update(SiteMember, { id: ctx.member.id }, { role: "manager" });
      await manager.update(SiteMember, { id: target.id }, { role: "owner", allAreas: true });
      await manager.delete(MemberAreaScope, { memberId: target.id });
    });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "site.transfer_ownership", entityType: "site_member", entityId: memberId });
    return { previousOwner: await this.findOrFail(ctx.site.id, ctx.member.id), newOwner: await this.findOrFail(ctx.site.id, memberId) };
  }

  private async replaceScopes(manager: EntityManager, siteId: string, memberId: string, areaIds: string[]) {
    const areas = await this.areaRepository.find({ where: { siteId, id: In(areaIds.length ? areaIds : ["00000000-0000-0000-0000-000000000000"]) } });
    if (areas.length !== areaIds.length) throw new BadRequestException("Every area must belong to this site");
    await manager.delete(MemberAreaScope, { memberId });
    if (areaIds.length) await manager.insert(MemberAreaScope, areaIds.map((areaId) => ({ siteId, memberId, areaId })));
  }

  private async findOrFail(siteId: string, memberId: string) {
    const member = await this.memberRepository.findOne({ where: { id: memberId, siteId, status: Not("removed") } });
    if (!member) throw new NotFoundException("Member not found");
    return member;
  }
}
