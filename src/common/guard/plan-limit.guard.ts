import { PLAN_LIMIT_KEY } from "@/common/decorators/permissions.decorator";
import { IRequest } from "@/common/interfaces/request.interface";
import { EntitlementService } from "@/modules/billing/entitlement.service";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

/** Checks @CheckPlanLimit("cameras" | "members") before a row is created. */
@Injectable()
export class PlanLimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly entitlement: EntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resource = this.reflector.get<"cameras" | "members">(
      PLAN_LIMIT_KEY,
      context.getHandler(),
    );
    if (!resource) return true;
    const req: IRequest = context.switchToHttp().getRequest();
    const check = await this.entitlement.checkLimit(req.site!.id, resource);
    if (!check.allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "plan_limit",
        message: `Your plan (${check.plan}) allows ${check.limit} ${resource}. You already have ${check.used}.`,
      });
    }
    return true;
  }
}
