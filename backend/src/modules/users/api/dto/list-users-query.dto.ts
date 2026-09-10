import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';

/**
 * User list query: kernel pagination contract plus an active/inactive filter.
 *
 * `sort` (inherited from the kernel contract: `field:(asc|desc)`) is
 * restricted by the service to `username`, `createdAt`, `updatedAt`; anything
 * else is rejected instead of being passed to the query builder
 * (architecture.md §9).
 */
export class ListUsersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Filter by account state (true = active only).',
  })
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Query-string booleans arrive as strings: map the two canonical spellings and
 * leave anything else untouched so `@IsBoolean()` rejects it with a 400.
 */
function parseBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
