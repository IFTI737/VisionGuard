import { IsDateString, IsIn, IsOptional } from "class-validator";

export class CreateExportDto {
  @IsIn(["incidents", "alerts"])
  reportType!: "incidents" | "alerts";

  @IsIn(["csv"])
  format!: "csv";

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;
}
