import { RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { CreateExportDto } from "@/modules/report/dto/report.dto";
import { ReportService } from "@/modules/report/report.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { Process, Processor } from "@nestjs/bull";
import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Job } from "bull";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@Controller("sites/:siteId")
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get("overview")
  async overview(@SiteCtx() ctx: SiteContext) {
    return await this.reportService.overview(ctx);
  }

  @Get("reports/summary")
  @RequirePermission("reports.view")
  async summary(@SiteCtx() ctx: SiteContext, @Query("days", new DefaultValuePipe(7), ParseIntPipe) days: number) {
    return await this.reportService.summary(ctx.site.id, Math.min(Math.max(days, 1), 90));
  }

  @Get("search")
  async search(@SiteCtx() ctx: SiteContext, @Query("q") q: string) {
    return await this.reportService.search(ctx, q);
  }

  @Post("exports")
  @RequirePermission("reports.view")
  async requestExport(@SiteCtx() ctx: SiteContext, @Body() dto: CreateExportDto) {
    return await this.reportService.requestExport(ctx, dto);
  }

  @Get("exports")
  @RequirePermission("reports.view")
  async exports(@SiteCtx() ctx: SiteContext) {
    return await this.reportService.listExports(ctx);
  }

  @Get("exports/:id")
  @RequirePermission("reports.view")
  async getExport(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    return await this.reportService.getExport(ctx, id);
  }
}

/** A big CSV must not make the HTTP request wait, so a queue worker builds it. */
@Processor(QUEUE.EXPORT)
export class ExportProcessor {
  constructor(private readonly reportService: ReportService) {}

  @Process("build")
  async build(job: Job<{ exportId: string }>) {
    await this.reportService.buildExport(job.data.exportId);
  }
}
