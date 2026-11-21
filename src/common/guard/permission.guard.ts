import { PERMISSIONS_KEY } from "@/common/decorators/permissions.decorator";
import { IRequest } from "@/common/interfaces/request.interface";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

/** Checks @RequirePermission(...) against the permissions SiteMemberGuard found. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req: IRequest = context.switchToHttp().getRequest();
    const missing = required.filter((p) => !req.permissions?.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "missing_permission",
        message: `Your role (${req.member?.role}) does not have: ${missing.join(", ")}`,
      });
    }
    return true;
  }
}
