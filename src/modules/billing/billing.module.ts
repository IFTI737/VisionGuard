import { BillingController, PaymentWebhookController } from "@/modules/billing/billing.controller";
import { BillingService } from "@/modules/billing/billing.service";
import { EntitlementService } from "@/modules/billing/entitlement.service";
import { InvoiceLine } from "@/modules/billing/entities/invoice-line.entity";
import { Invoice } from "@/modules/billing/entities/invoice.entity";
import { Payment } from "@/modules/billing/entities/payment.entity";
import { Plan } from "@/modules/billing/entities/plan.entity";
import { SubscriptionItem } from "@/modules/billing/entities/subscription-item.entity";
import { Subscription } from "@/modules/billing/entities/subscription.entity";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Pack } from "@/modules/catalog/entities/pack.entity";
import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

// Global: EntitlementService is needed by PlanLimitGuard on routes of other modules.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Plan, Subscription, SubscriptionItem, Invoice, InvoiceLine, Payment, Pack, Camera])],
  controllers: [BillingController, PaymentWebhookController],
  providers: [BillingService, EntitlementService],
  exports: [BillingService, EntitlementService],
})
export class BillingModule {}
