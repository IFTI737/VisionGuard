import { ConversationController } from "@/modules/conversation/conversation.controller";
import { ConversationService } from "@/modules/conversation/conversation.service";
import { ConversationMember } from "@/modules/conversation/entities/conversation-member.entity";
import { Conversation } from "@/modules/conversation/entities/conversation.entity";
import { Message } from "@/modules/conversation/entities/message.entity";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, ConversationMember, Message])],
  controllers: [ConversationController],
  providers: [ConversationService],
})
export class ConversationModule {}
