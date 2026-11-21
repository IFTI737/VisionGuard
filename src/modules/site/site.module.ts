import { AreaService } from "@/modules/site/area.service";
import { Area } from "@/modules/site/entities/area.entity";
import { MemberAreaScope } from "@/modules/site/entities/member-area-scope.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { MemberService } from "@/modules/site/member.service";
import { SiteAccessService } from "@/modules/site/site-access.service";
import { OnboardingController, SiteController } from "@/modules/site/site.controller";
import { SiteService } from "@/modules/site/site.service";
import { User } from "@/modules/user/entities/user.entity";
import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

// Global: SiteAccessService is needed by SiteMemberGuard, which every site route uses.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Site, SiteMember, Area, MemberAreaScope, User])],
  controllers: [OnboardingController, SiteController],
  providers: [SiteService, MemberService, AreaService, SiteAccessService],
  exports: [SiteAccessService, TypeOrmModule],
})
export class SiteModule {}
