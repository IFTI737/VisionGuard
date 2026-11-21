import { SetMetadata } from "@nestjs/common";
import { Permission } from "@/common/constants/permissions";

export const PERMISSIONS_KEY = "permissions";
/** The site member needs every permission listed. Checked by PermissionGuard. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const PLAN_LIMIT_KEY = "plan_limit";
/** Refuse the request when the site's plan limit for this resource is reached. */
export const CheckPlanLimit = (resource: "cameras" | "members") =>
  SetMetadata(PLAN_LIMIT_KEY, resource);
