import { MailService } from "@/providers/mail/mail.service";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
