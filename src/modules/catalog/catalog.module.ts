import { Plan } from "@/modules/billing/entities/plan.entity";
import { CatalogController } from "@/modules/catalog/catalog.controller";
import { CatalogService } from "@/modules/catalog/catalog.service";
import { AiModel } from "@/modules/catalog/entities/ai-model.entity";
import { ModelClass } from "@/modules/catalog/entities/model-class.entity";
import { ObjectClass } from "@/modules/catalog/entities/object-class.entity";
import { PackModel } from "@/modules/catalog/entities/pack-model.entity";
import { Pack } from "@/modules/catalog/entities/pack.entity";
import { RuleTemplate } from "@/modules/catalog/entities/rule-template.entity";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([ObjectClass, AiModel, ModelClass, Pack, PackModel, RuleTemplate, Plan])],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService, TypeOrmModule],
})
export class CatalogModule {}
