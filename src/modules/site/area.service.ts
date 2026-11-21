import { SiteContext } from "@/common/decorators/current-user.decorator";
import { CreateAreaDto, UpdateAreaDto } from "@/modules/site/dto/site.dto";
import { Area } from "@/modules/site/entities/area.entity";
import { SiteAccessService } from "@/modules/site/site-access.service";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

@Injectable()
export class AreaService {
  constructor(@InjectRepository(Area) private readonly areaRepository: Repository<Area>) {}

  list(ctx: SiteContext) {
    return this.areaRepository.find({
      where: ctx.areaIds === null ? { siteId: ctx.site.id } : { siteId: ctx.site.id, id: In(ctx.areaIds.length ? ctx.areaIds : ["00000000-0000-0000-0000-000000000000"]) },
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
  }

  async create(ctx: SiteContext, dto: CreateAreaDto) {
    try {
      return await this.areaRepository.save(this.areaRepository.create({ siteId: ctx.site.id, name: dto.name }));
    } catch (error: any) {
      if (error?.code === "23505") throw new ConflictException("An area with this name already exists");
      throw error;
    }
  }

  async update(ctx: SiteContext, areaId: string, dto: UpdateAreaDto) {
    SiteAccessService.assertArea(ctx, areaId);
    const result = await this.areaRepository.update({ id: areaId, siteId: ctx.site.id }, dto);
    if (!result.affected) throw new NotFoundException("Area not found");
    return this.areaRepository.findOneOrFail({ where: { id: areaId } });
  }

  async remove(ctx: SiteContext, areaId: string) {
    SiteAccessService.assertArea(ctx, areaId);
    try {
      const result = await this.areaRepository.delete({ id: areaId, siteId: ctx.site.id });
      if (!result.affected) throw new NotFoundException("Area not found");
    } catch (error: any) {
      // foreign key ON DELETE RESTRICT from cameras
      if (error?.code === "23503") throw new ConflictException("Move or delete the cameras in this area first");
      throw error;
    }
  }
}
