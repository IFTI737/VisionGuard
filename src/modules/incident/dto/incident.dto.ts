import { PageQueryDto } from "@/common/dto/page-query.dto";
import { INCIDENTS_FALSE_ALARM_REASON, INCIDENTS_SEVERITY, INCIDENTS_STATUS } from "@/common/constants/check-values";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class ListIncidentsDto extends PageQueryDto {
  @IsOptional() @IsIn(INCIDENTS_STATUS)
  status?: (typeof INCIDENTS_STATUS)[number];

  @IsOptional() @IsIn(INCIDENTS_SEVERITY)
  severity?: (typeof INCIDENTS_SEVERITY)[number];

  @IsOptional() @IsUUID()
  zoneId?: string;

  @IsOptional() @IsUUID()
  cameraId?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;
}

export class ResolveIncidentDto {
  @IsOptional() @IsString() @Length(1, 1000)
  note?: string;
}

export class FalseAlarmDto {
  @IsIn(INCIDENTS_FALSE_ALARM_REASON)
  reason!: (typeof INCIDENTS_FALSE_ALARM_REASON)[number];

  @IsOptional() @IsString() @Length(1, 1000)
  note?: string;
}

export class IncidentNoteDto {
  @IsString() @Length(1, 1000)
  text!: string;
}

export class ShareIncidentDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(168)
  hours!: number;
}
