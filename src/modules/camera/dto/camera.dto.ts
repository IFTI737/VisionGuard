import { ZONES_ANCHOR, ZONES_KIND } from "@/common/constants/check-values";
import { CreateRuleDto } from "@/modules/rule/dto/rule.dto";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min,
  ValidateNested, registerDecorator, ValidationOptions,
} from "class-validator";

/** A polygon is 3 to 32 points [x, y], each between 0 and 1 (a share of the picture, not pixels). */
export function IsPolygon(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isPolygon",
      target: object.constructor,
      propertyName,
      options: { message: "polygon must be 3 to 32 points [x, y] with x and y between 0 and 1", ...options },
      validator: {
        validate(value: unknown) {
          return (
            Array.isArray(value) && value.length >= 3 && value.length <= 32 &&
            value.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && n >= 0 && n <= 1))
          );
        },
      },
    });
  };
}

export class CreateCameraDto {
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsUUID()
  areaId!: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsIn(["browser", "rtsp", "simulator"])
  sourceKind!: "browser" | "rtsp" | "simulator";

  @IsOptional()
  @IsString()
  sourceRef?: string;
}

export class UpdateCameraDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsUUID()
  areaId?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsIn(["off", "continuous", "incident_only"])
  recordingMode?: "off" | "continuous" | "incident_only";

  @IsOptional()
  @IsIn(["pending", "disabled"])
  status?: "pending" | "disabled"; // online/offline are set by the system
}

export class CreateZoneDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional()
  @IsIn(ZONES_KIND)
  kind?: (typeof ZONES_KIND)[number];

  @IsPolygon()
  polygon!: [number, number][];

  @IsOptional()
  @IsIn(ZONES_ANCHOR)
  anchor?: (typeof ZONES_ANCHOR)[number];

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(1)
  minOverlap?: number;
}

export class QuickstartZoneDto extends CreateZoneDto {
  // extra rules to create together with the zone, besides the automatic ones for its kind
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CreateRuleDto)
  rules?: CreateRuleDto[];
}

export class UpdateZoneDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsIn(ZONES_KIND)
  kind?: (typeof ZONES_KIND)[number];

  @IsOptional()
  @IsPolygon()
  polygon?: [number, number][];

  @IsOptional()
  @IsIn(ZONES_ANCHOR)
  anchor?: (typeof ZONES_ANCHOR)[number];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
