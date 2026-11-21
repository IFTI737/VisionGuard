import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, IsUrl, Length } from "class-validator";

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsIn(["bn", "en"])
  locale?: "bn" | "en";
}

export class WebPushEndpointDto {
  @IsUrl({ require_tld: false })
  endpoint!: string;

  @IsObject()
  keys!: { p256dh: string; auth: string };

  @IsOptional()
  @IsString()
  label?: string;
}

export class TelegramDevLinkDto {
  // Development helper: link a chat id by hand when no bot is configured.
  @IsString()
  @IsNotEmpty()
  chatId!: string;
}
