import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";

export class ChangePlanDto {
  @IsString()
  @IsNotEmpty()
  planCode!: string; // basic | standard | pro
}

export class AddPackDto {
  @IsString()
  @IsNotEmpty()
  packCode!: string; // farm | construction | shop | workplace
}

export class PayInvoiceDto {
  @IsIn(["sandbox", "bkash", "sslcommerz"])
  provider!: "sandbox" | "bkash" | "sslcommerz";
}

/** Body the payment gateway sends to POST /v1/webhooks/payments/:provider */
export class PaymentWebhookDto {
  @IsString()
  @IsNotEmpty()
  providerTxnId!: string;

  @IsIn(["succeeded", "failed"])
  status!: "succeeded" | "failed";

  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinor?: number;
}
