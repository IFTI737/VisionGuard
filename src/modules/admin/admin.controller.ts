import { CurrentUser, Roles } from "@/common/decorators";
import { PageQueryDto } from "@/common/dto/page-query.dto";
import { Role } from "@/common/enums/role.enum";
import { JwtGuard, RolesGuard } from "@/common/guard";
import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { AdminService } from "@/modules/admin/admin.service";
import { AuditQueryDto, CustomPackDto, UpdateUserByAdminDto } from "@/modules/admin/dto/admin.dto";
import { ListTicketsDto, QuoteTicketDto, TicketMessageDto, UpdateTicketDto } from "@/modules/support/dto/support.dto";
import { SupportService } from "@/modules/support/support.service";
import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

/**
 * The VisionGuard staff panel. JwtGuard checks the login, then sir's RolesGuard
 * checks the platform role. Support staff can work tickets and look up sites;
 * only admins see money, change users, or suspend a site.
 */
@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPPORT) // default for the whole controller; stricter on some routes
@Controller("admin")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly supportService: SupportService,
  ) {}

  // ---------------- tickets ----------------

  @Get("tickets")
  async tickets(@Query() query: ListTicketsDto) {
    return await this.supportService.queue(query);
  }

  @Get("tickets/:id")
  async ticket(@Param("id", ParseUUIDPipe) id: string) {
    return await this.supportService.getForStaff(id);
  }

  @Patch("tickets/:id")
  async updateTicket(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) {
    return await this.supportService.updateByStaff(id, dto);
  }

  @Post("tickets/:id/messages")
  async replyTicket(@CurrentUser() staff: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: TicketMessageDto) {
    return await this.supportService.replyAsStaff(staff, id, dto);
  }

  @Post("tickets/:id/quote")
  @HttpCode(200)
  @Roles(Role.ADMIN)
  async quote(@Param("id", ParseUUIDPipe) id: string, @Body() dto: QuoteTicketDto) {
    return await this.supportService.quote(id, dto.priceMinor);
  }

  // ---------------- sites ----------------

  @Get("sites")
  async sites(@Query() query: PageQueryDto) {
    return await this.adminService.listSites(query);
  }

  @Get("sites/:id/summary")
  async siteSummary(@CurrentUser() staff: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string) {
    return await this.adminService.siteSummary(staff, id, ip);
  }

  @Post("sites/:id/suspend")
  @HttpCode(200)
  @Roles(Role.ADMIN)
  async suspend(@CurrentUser() staff: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return await this.adminService.setSiteStatus(staff, id, "suspended");
  }

  @Post("sites/:id/unsuspend")
  @HttpCode(200)
  @Roles(Role.ADMIN)
  async unsuspend(@CurrentUser() staff: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return await this.adminService.setSiteStatus(staff, id, "active");
  }

  @Post("sites/:id/custom-pack")
  @Roles(Role.ADMIN)
  async customPack(@CurrentUser() staff: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CustomPackDto) {
    return await this.adminService.createCustomPack(staff, id, dto);
  }

  // ---------------- users ----------------

  @Get("users")
  async users(@Query() query: PageQueryDto) {
    return await this.adminService.listUsers(query);
  }

  @Patch("users/:id")
  @Roles(Role.ADMIN)
  async updateUser(@CurrentUser() staff: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateUserByAdminDto) {
    return await this.adminService.updateUser(staff, id, dto);
  }

  // ---------------- metrics: admin only ----------------

  @Get("metrics/revenue")
  @Roles(Role.ADMIN)
  async revenue() {
    return await this.adminService.revenue();
  }

  @Get("metrics/subscriptions")
  @Roles(Role.ADMIN)
  async subscriptions() {
    return await this.adminService.subscriptions();
  }

  @Get("metrics/usage")
  @Roles(Role.ADMIN)
  async usage() {
    return await this.adminService.usage();
  }

  @Get("feedback")
  @Roles(Role.ADMIN)
  async feedback(@Query() query: PageQueryDto) {
    return await this.adminService.feedback(query);
  }

  @Get("audit")
  @Roles(Role.ADMIN)
  async auditLog(@Query() query: AuditQueryDto) {
    return await this.adminService.auditLog(query, query.siteId, query.action);
  }

  @Get("health")
  @Roles(Role.ADMIN)
  async health() {
    return await this.adminService.health();
  }
}
