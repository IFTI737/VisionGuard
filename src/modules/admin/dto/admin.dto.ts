import { USERS_PLATFORM_ROLE } from "@/common/constants/check-values";
import { PageQueryDto } from "@/common/dto/page-query.dto";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from "class-validator";

export class UpdateUserByAdminDto {
  @IsOptional() @IsIn(["active", "disabled"])
  status?: "active" | "disabled";

  @IsOptional() @IsIn(USERS_PLATFORM_ROLE)
  platformRole?: (typeof USERS_PLATFORM_ROLE)[number];
}

export class CustomPackDto {
  @IsString() @Length(2, 60)
  name!: string;

  @IsArray() @ArrayMaxSize(10) @IsString({ each: true })
  templateCodes!: string[]; // existing rule templates to copy into the custom pack

  @IsInt() @Min(0)
  priceMinor!: number; // monthly price agreed with the customer, in poisha
}

export class AuditQueryDto extends PageQueryDto {
  @IsOptional() @IsUUID()
  siteId?: string;

  @IsOptional() @IsString()
  action?: string; // e.g. admin.site.view
}
