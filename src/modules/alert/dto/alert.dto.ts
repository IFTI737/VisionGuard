import { PageQueryDto } from "@/common/dto/page-query.dto";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested,
} from "class-validator";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const CHANNELS = ["inapp", "webpush", "telegram", "call"] as const;

export class CreateAlertDto {
  @IsString() @Length(2, 120)
  title!: string;

  @IsOptional() @IsString() @Length(1, 1000)
  body?: string;

  @IsIn(SEVERITIES)
  severity!: (typeof SEVERITIES)[number];

  @IsOptional() @IsUUID()
  areaId?: string; // only members who may see this area are told
}

export class ListAlertsDto extends PageQueryDto {
  @IsOptional() @IsIn(["active", "acknowledged", "exhausted", "cancelled"])
  status?: "active" | "acknowledged" | "exhausted" | "cancelled";

  @IsOptional() @IsIn(["system", "manual", "test"])
  source?: "system" | "manual" | "test";
}

export class AckTokenDto {
  @IsString() @IsNotEmpty()
  token!: string;
}

export class EscalationStepDto {
  @IsInt() @Min(0) @Max(3600)
  waitS!: number; // seconds after the previous step (step 1: after the alert is created)

  @IsArray() @ArrayMinSize(1) @IsIn(CHANNELS, { each: true })
  channels!: (typeof CHANNELS)[number][];

  @IsIn(["all_members", "role", "call_list"])
  audience!: "all_members" | "role" | "call_list";

  @IsOptional() @IsIn(["owner", "manager", "guard", "viewer"])
  role?: "owner" | "manager" | "guard" | "viewer";

  @IsOptional() @IsInt() @Min(1) @Max(5)
  callCount?: number; // how many people of the call list are tried

  @IsOptional() @IsInt() @Min(10) @Max(60)
  ringTimeoutS?: number;
}

export class EscalationPolicyDto {
  @IsString() @Length(2, 60)
  name!: string;

  @IsOptional() @IsIn(SEVERITIES)
  minSeverity?: (typeof SEVERITIES)[number]; // phone calls only for alerts at or above this

  @IsOptional() @IsInt() @Min(0) @Max(3)
  repeatCount?: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => EscalationStepDto)
  steps!: EscalationStepDto[];
}

export class MockVoiceDto {
  @IsIn(["answered", "digit", "no_answer", "busy"])
  event!: "answered" | "digit" | "no_answer" | "busy";

  @IsOptional() @IsString() @Length(1, 1)
  digit?: string; // "1" = acknowledge
}
