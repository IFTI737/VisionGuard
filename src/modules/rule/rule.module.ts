import { Camera } from "@/modules/camera/entities/camera.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { CatalogModule } from "@/modules/catalog/catalog.module";
import { ModelAssignment } from "@/modules/rule/entities/model-assignment.entity";
import { Rule } from "@/modules/rule/entities/rule.entity";
import { RuleController } from "@/modules/rule/rule.controller";
import { RuleService } from "@/modules/rule/rule.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([Rule, ModelAssignment, Zone, Camera]), CatalogModule],
  controllers: [RuleController],
  providers: [RuleService],
  exports: [RuleService, TypeOrmModule],
})
export class RuleModule {}
