import { Request } from "express";
import { AuthUser } from "./auth-user.interface";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { Device } from "@/modules/device/entities/device.entity";

export interface IRequest extends Request {
  request_id?: string;
  start_at: number;
  user?: AuthUser; // set by JwtGuard
  site?: Site; // set by SiteMemberGuard
  member?: SiteMember; // set by SiteMemberGuard
  permissions?: string[]; // set by SiteMemberGuard
  areaIds?: string[] | null; // set by SiteMemberGuard: null = all areas
  device?: Device; // set by DeviceAuthGuard
}
