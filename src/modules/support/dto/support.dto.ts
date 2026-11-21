import { PageQueryDto } from "@/common/dto/page-query.dto";
import { SUPPORT_TICKETS_CATEGORY, SUPPORT_TICKETS_PRIORITY, SUPPORT_TICKETS_STATUS } from "@/common/constants/check-values";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from "class-validator";

export class CreateTicketDto {
  @IsOptional() @IsUUID()
  siteId?: string;

  @IsIn(SUPPORT_TICKETS_CATEGORY)
  category!: (typeof SUPPORT_TICKETS_CATEGORY)[number]; // complaint | bug | billing | false_alarm | feature_request | other

  @IsString() @Length(3, 150)
  subject!: string;

  @IsString() @Length(1, 8000)
  body!: string;
}

export class TicketMessageDto {
  @IsString() @Length(1, 8000)
  body!: string;

  @IsOptional() @IsBoolean()
  isInternal?: boolean; // staff only: a note the customer never sees
}

export class ListTicketsDto extends PageQueryDto {
  @IsOptional() @IsIn(SUPPORT_TICKETS_STATUS)
  status?: (typeof SUPPORT_TICKETS_STATUS)[number];

  @IsOptional() @IsIn(SUPPORT_TICKETS_PRIORITY)
  priority?: (typeof SUPPORT_TICKETS_PRIORITY)[number];

  @IsOptional() @IsIn(SUPPORT_TICKETS_CATEGORY)
  category?: (typeof SUPPORT_TICKETS_CATEGORY)[number];
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(SUPPORT_TICKETS_STATUS)
  status?: (typeof SUPPORT_TICKETS_STATUS)[number];

  @IsOptional() @IsIn(SUPPORT_TICKETS_PRIORITY)
  priority?: (typeof SUPPORT_TICKETS_PRIORITY)[number];

  @IsOptional() @IsUUID()
  assignedTo?: string;
}

export class QuoteTicketDto {
  @IsInt() @Min(0)
  priceMinor!: number;
}
