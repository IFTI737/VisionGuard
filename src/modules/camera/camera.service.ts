import { EVENTS } from "@/common/constants/events";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { AuditService } from "@/modules/audit/audit.service";
import { CreateCameraDto, UpdateCameraDto } from "@/modules/camera/dto/camera.dto";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { RuleService } from "@/modules/rule/rule.service";
import { SiteAccessService } from "@/modules/site/site-access.service";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";

const NONE = ["00000000-0000-0000-0000-000000000000"];

@Injectable()
export class CameraService {
  constructor(
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(Zone) private readonly zoneRepository: Repository<Zone>,
    private readonly ruleService: RuleService,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  list(ctx: SiteContext, filter: { areaId?: string; status?: string }) {
    return this.cameraRepository.find({
      where: {
        siteId: ctx.site.id,
        ...(ctx.areaIds !== null ? { areaId: In(ctx.areaIds.length ? ctx.areaIds : NONE) } : {}),
        ...(filter.areaId ? { areaId: filter.areaId } : {}),
        ...(filter.status ? { status: filter.status as any } : {}),
      },
      order: { createdAt: "ASC" },
    });
  }

  async create(ctx: SiteContext, dto: CreateCameraDto) {
    SiteAccessService.assertArea(ctx, dto.areaId);
    try {
      const camera = await this.dataSource.transaction(async (manager) => {
        const saved = await manager.save(
          manager.create(Camera, {
            siteId: ctx.site.id, // always from the URL the guard checked, never from the body
            areaId: dto.areaId, deviceId: dto.deviceId ?? null, name: dto.name,
            sourceKind: dto.sourceKind, sourceRef: dto.sourceRef ?? null,
          }),
        );
        // camera-health rules and model assignments come with every camera
        await this.ruleService.provisionCamera(manager, ctx.site.id, saved.id, saved.name, ctx.userId);
        return saved;
      });
      await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "camera.create", entityType: "camera", entityId: camera.id });
      this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
      return camera;
    } catch (error: any) {
      // The database itself refuses an area or device of another site:
      // FOREIGN KEY (site_id, area_id) REFERENCES areas(site_id, id)
      if (error?.code === "23503")
        throw new BadRequestException({ statusCode: 400, code: "wrong_site", message: "The area or device does not belong to this site (refused by the database foreign key)" });
      if (error?.code === "23505") throw new ConflictException("A camera with this name already exists on the site");
      throw error;
    }
  }

  async getOne(ctx: SiteContext, cameraId: string) {
    const camera = await this.findOrFail(ctx, cameraId);
    const zones = await this.zoneRepository.find({ where: { cameraId }, order: { createdAt: "ASC" } });
    return { ...camera, zones };
  }

  async update(ctx: SiteContext, cameraId: string, dto: UpdateCameraDto) {
    await this.findOrFail(ctx, cameraId);
    if (dto.areaId) SiteAccessService.assertArea(ctx, dto.areaId);
    try {
      await this.cameraRepository.update({ id: cameraId }, dto);
    } catch (error: any) {
      if (error?.code === "23503") throw new BadRequestException({ statusCode: 400, code: "wrong_site", message: "The area or device does not belong to this site (refused by the database foreign key)" });
      throw error;
    }
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return this.findOrFail(ctx, cameraId);
  }

  async remove(ctx: SiteContext, cameraId: string) {
    await this.findOrFail(ctx, cameraId);
    await this.cameraRepository.softDelete({ id: cameraId });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "camera.delete", entityType: "camera", entityId: cameraId });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
  }

  /** Loads a camera of this site and checks the caller's area scope. */
  async findOrFail(ctx: SiteContext, cameraId: string) {
    const camera = await this.cameraRepository.findOne({ where: { id: cameraId, siteId: ctx.site.id } });
    if (!camera) throw new NotFoundException("Camera not found");
    SiteAccessService.assertArea(ctx, camera.areaId);
    return camera;
  }
}
