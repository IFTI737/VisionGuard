import { PERMISSIONS } from "@/common/constants/permissions";
import { SITES_KIND } from "@/common/constants/check-values";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID,
  Length, Matches, Max, Min,
} from "class-validator";

export class CreateSiteDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsIn(SITES_KIND)
  kind!: (typeof SITES_KIND)[number];

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  sensitivity?: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "digestTime must look like 07:00" })
  digestTime?: string;

  @IsOptional()
  @IsBoolean()
  shareTrainingData?: boolean;
}

export class PauseSiteDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  minutes!: number;
}

const MEMBER_ROLES = ["manager", "guard", "viewer"] as const;

export class InviteMemberDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: "phone must be in international format, e.g. +8801712345678" })
  phone?: string;

  @IsString()
  @Length(2, 80)
  displayName!: string;

  @IsIn(MEMBER_ROLES)
  role!: (typeof MEMBER_ROLES)[number];

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  areaIds?: string[]; // given => the member only sees these areas

  @IsOptional()
  @IsArray()
  @IsIn(PERMISSIONS, { each: true })
  permissions?: string[];
}

export class CreateContactDto {
  @IsString()
  @Length(2, 80)
  displayName!: string;

  @Matches(/^\+[1-9]\d{7,14}$/, { message: "phone must be in international format, e.g. +8801712345678" })
  phone!: string;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(MEMBER_ROLES)
  role?: (typeof MEMBER_ROLES)[number];

  @IsOptional()
  @IsString()
  @Length(2, 80)
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsIn(PERMISSIONS, { each: true })
  permissions?: string[];

  @IsOptional()
  @IsBoolean()
  allAreas?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  areaIds?: string[];
}

export class CallListDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID("4", { each: true })
  memberIds!: string[]; // in the order they should be called
}

export class NotifyPrefsDto {
  @IsOptional()
  @IsObject()
  channels?: Record<string, { enabled: boolean; minSeverity?: string }>;

  @IsOptional()
  @IsObject()
  quiet?: { from: string; to: string };
}

export class TransferOwnershipDto {
  @IsUUID()
  memberId!: string;
}

export class AcceptInviteDto {
  @IsString()
  token!: string;
}

export class CreateAreaDto {
  @IsString()
  @Length(1, 60)
  name!: string;
}

export class UpdateAreaDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
