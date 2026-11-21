import { DEVICES_KIND } from "@/common/constants/check-values";
import { IsDateString, IsIn, IsOptional, IsString, Length } from "class-validator";

export class CreateDeviceDto {
  @IsIn(DEVICES_KIND)
  kind!: (typeof DEVICES_KIND)[number]; // browser | simulator | gateway | cloud_worker

  @IsString()
  @Length(2, 60)
  name!: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsIn(["active", "disabled"])
  status?: "active" | "disabled";
}

export class CreateCredentialDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class PairDeviceDto {
  @IsString()
  @Length(6, 6)
  code!: string;

  @IsOptional()
  @IsString()
  swVersion?: string;
}
