import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";

export class SendMessageDto {
  @IsString() @Length(1, 4000)
  body!: string;

  @IsOptional() @IsUUID()
  mediaId?: string;

  @IsOptional() @IsString() @Length(1, 64)
  clientMsgId?: string; // made by the app; the same id sent twice is stored once
}

export class ListMessagesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  before?: number; // message id; older messages than this

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 30;
}

export class MarkReadDto {
  @Type(() => Number) @IsInt() @Min(0)
  lastReadId!: number;
}
