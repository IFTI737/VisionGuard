import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/** ?limit=25&offset=0&q=text  (same names as sir's QueryParserPipe uses) */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  @IsOptional()
  @IsString()
  q?: string;
}

export const paged = <T>(items: T[], total: number, query: PageQueryDto) => ({
  items,
  total,
  limit: query.limit,
  offset: query.offset,
});
