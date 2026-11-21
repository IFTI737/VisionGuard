import { IRequest } from "@/common/interfaces/request.interface";
import { SiteAccessService } from "@/modules/site/site-access.service";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

/**
 * Runs after JwtGuard on every route under /v1/sites/:siteId.
 * It loads the caller's membership of that site and puts the site, the member,
 * the member's permissions and area scope on the request.
 * A site you are not a member of answers 404 (not 403), so nobody can find out
 * which site ids exist.
 */
@Injectable()
export class SiteMemberGuard implements CanActivate {
  constructor(private readonly siteAccess: SiteAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: IRequest = context.switchToHttp().getRequest();
    const siteId = req.params.siteId as string;
    const access = await this.siteAccess.resolve(siteId, req.user!.id);
    if (!access) throw new NotFoundException("Site not found");
    req.site = access.site;
    req.member = access.member;
    req.permissions = access.permissions;
    req.areaIds = access.areaIds;
    return true;
  }
}
