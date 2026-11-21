import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Length, Max, Min } from "class-validator";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export class CreateRuleDto {
  @IsString()
  @IsNotEmpty()
  templateCode!: string; // e.g. "animal_missing"; see GET /v1/catalog/packs

  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>; // merged over the template defaults, then checked per rule kind

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @IsOptional()
  schedule?: unknown | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  sustainS?: number; // how long the problem must last before an incident opens

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  clearS?: number; // how long things must be fine before the incident counts as over

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  cooldownS?: number; // a new problem inside this time joins the same incident
}

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @IsOptional()
  schedule?: unknown | null;

  @IsOptional() @IsInt() @Min(0) @Max(86400)
  sustainS?: number;

  @IsOptional() @IsInt() @Min(0) @Max(86400)
  clearS?: number;

  @IsOptional() @IsInt() @Min(0) @Max(86400)
  cooldownS?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class MuteDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(7 * 24 * 60)
  minutes!: number; // 0 = unmute
}

export class UpdateModelAssignmentDto {
  @IsOptional()
  @IsInt()
  @Min(100)
  frameIntervalMs?: number;

  @IsOptional()
  @IsObject()
  confOverrides?: Record<string, number>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
