import { JwtGuard } from "@/common/guard";
import { CatalogService } from "@/modules/catalog/catalog.service";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("catalog")
@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("plans") // public: shown on the pricing page
  async plans() {
    return await this.catalogService.listPlans();
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Get("packs")
  async packs() {
    return await this.catalogService.listPacks();
  }
}
