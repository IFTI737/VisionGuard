import { RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { ConversationService } from "@/modules/conversation/conversation.service";
import { ListMessagesDto, MarkReadDto, SendMessageDto } from "@/modules/conversation/dto/conversation.dto";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("conversations")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@RequirePermission("chat.use")
@Controller("sites/:siteId/conversations")
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  async list(@SiteCtx() ctx: SiteContext) {
    return await this.conversationService.list(ctx);
  }

  @Get(":id/messages")
  async messages(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Query() query: ListMessagesDto) {
    return await this.conversationService.messages(ctx, id, query);
  }

  @Post(":id/messages")
  async send(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return await this.conversationService.send(ctx, id, dto);
  }

  @Post(":id/read")
  @HttpCode(204)
  async read(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: MarkReadDto) {
    await this.conversationService.markRead(ctx, id, dto.lastReadId);
  }
}
