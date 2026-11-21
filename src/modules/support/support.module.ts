import { SupportTicket } from "@/modules/support/entities/support-ticket.entity";
import { TicketMessage } from "@/modules/support/entities/ticket-message.entity";
import { SupportController } from "@/modules/support/support.controller";
import { SupportService } from "@/modules/support/support.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([SupportTicket, TicketMessage])],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
