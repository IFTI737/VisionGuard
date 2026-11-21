import { Roles } from "@/common/decorators";
import { Role } from "@/common/enums/role.enum";
import { JwtGuard, RolesGuard } from "@/common/guard";
import { appConfig } from "@/config/app.config";
import { MaintenanceService, TASKS } from "@/modules/maintenance/maintenance.service";
import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

/**
 * Development and demonstration only (404 in production, admin login needed).
 * Background tasks normally run on a timetable. During a live demonstration
 * nobody wants to wait an hour for the hourly rollup, so an admin can run a
 * task now:  POST /v1/dev/tasks/rollup-hours
 */
@ApiTags("dev tools")
@ApiBearerAuth()
@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller("dev/tasks")
export class DevController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  list() {
    this.assertNotProduction();
    return TASKS;
  }

  @Post(":task")
  @HttpCode(200)
  async run(@Param("task") task: string, @Body() options: Record<string, any>) {
    this.assertNotProduction();
    return { task, result: await this.maintenance.run(task, options ?? {}) };
  }

  private assertNotProduction() {
    if (appConfig.env.NODE_ENV === "production") throw new NotFoundException();
  }
}
