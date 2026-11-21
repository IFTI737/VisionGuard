import { getCurrentUser } from "@/common/helpers/auth.helper";
import { IRequest } from "@/common/interfaces/request.interface";
import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";

export const CurrentUser = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const req: IRequest = context.switchToHttp().getRequest();
    const user = getCurrentUser(req);
    if (typeof user === "string") throw new UnauthorizedException(user);
    if (!user) throw new UnauthorizedException("User not authenticated");
    return user;
  },
);

/** The caller's membership of the site in the URL (set by SiteMemberGuard). */
export const CurrentMember = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const req: IRequest = context.switchToHttp().getRequest();
    return req.member;
  },
);

/** Everything SiteMemberGuard worked out: site, member, permissions, area scope. */
export const SiteCtx = createParamDecorator(
  (data: unknown, context: ExecutionContext): SiteContext => {
    const req: IRequest = context.switchToHttp().getRequest();
    return {
      site: req.site!,
      member: req.member!,
      permissions: req.permissions ?? [],
      areaIds: req.areaIds ?? null,
      userId: req.user!.id,
    };
  },
);

export interface SiteContext {
  site: NonNullable<IRequest["site"]>;
  member: NonNullable<IRequest["member"]>;
  permissions: string[];
  areaIds: string[] | null; // null = may see every area
  userId: string;
}

/** The device that sent the request (set by DeviceAuthGuard). */
export const CurrentDevice = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const req: IRequest = context.switchToHttp().getRequest();
    return req.device;
  },
);
