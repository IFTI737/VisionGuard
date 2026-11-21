import { CurrentUser } from "@/common/decorators";
import { JwtGuard } from "@/common/guard";
import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { CreateTicketDto, TicketMessageDto } from "@/modules/support/dto/support.dto";
import { SupportService } from "@/modules/support/support.service";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("support")
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller("support/tickets")
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return await this.supportService.create(user, dto);
  }

  @Get()
  async mine(@CurrentUser() user: AuthUser) {
    return await this.supportService.listMine(user.id);
  }

  @Get(":id")
  async getOne(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return await this.supportService.getMine(user.id, id);
  }

  @Post(":id/messages")
  async reply(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: TicketMessageDto) {
    return await this.supportService.replyAsCustomer(user.id, id, dto);
  }
}
