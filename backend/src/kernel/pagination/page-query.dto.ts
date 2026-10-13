import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * List-query conventions (architecture.md section 9).
 *
 * - `page` (1-based, default 1), `pageSize` (default 100, hard max 500).
 * - `sort`: comma-separated `field:(asc|desc)` entries, e.g.
 *   `?sort=createdAt:desc,name:asc`. This DTO validates the SYNTAX only;
 *   each endpoint restricts which fields are sortable (unknown fields must
 *   be rejected by the module, never passed to the query builder raw).
 * - Filtering uses `filter[field][op]=value` (reserved op names: eq, ne,
 *   gt, gte, lt, lte, like, in). There is intentionally no generic filter
 *   parser: each list endpoint declares its supported filters in its own
 *   query DTO, extending this class.
 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;

export const SORT_PATTERN =
  /^[A-Za-z0-9_.]+:(asc|desc)(,[A-Za-z0-9_.]+:(asc|desc))*$/;

export class PageQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    description: 'Comma-separated field:(asc|desc) entries.',
    example: 'createdAt:desc',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(SORT_PATTERN)
  sort?: string;
}
