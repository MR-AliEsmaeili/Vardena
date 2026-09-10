import { Type } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

/** Standard list response envelope (architecture.md section 9). */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function toPaginatedResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { items, total, page, pageSize };
}

/** Offset/limit pair derived from a page query. */
export function toOffset(
  page: number,
  pageSize: number,
): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export interface SortField {
  field: string;
  direction: 'asc' | 'desc';
}

/**
 * Parse a validated `sort` string into ordered fields. Returns [] when
 * absent. Throws on a malformed entry (programmer error — endpoints must
 * validate with `PageQueryDto` first; silently mistranslating sorts would
 * return wrongly ordered data).
 */
export function parseSort(sort: string | undefined): SortField[] {
  if (sort === undefined || sort === '') return [];
  return sort.split(',').map((entry) => {
    const [field, direction] = entry.split(':');
    if (
      field === undefined ||
      field === '' ||
      (direction !== 'asc' && direction !== 'desc')
    ) {
      throw new Error(
        `Invalid sort entry: ${JSON.stringify(entry)}. Expected "field:(asc|desc)".`,
      );
    }
    return { field, direction };
  });
}

/**
 * OpenAPI helper for paginated endpoints (ADR-0014: DTOs are the contract).
 * Usage in a controller:
 *
 *   const PaginatedWidget = paginatedResponseOf(WidgetDto);
 *   @ApiExtraModels(PaginatedWidget)
 *   @ApiOkResponse({ schema: { allOf: [{ $ref: getSchemaPath(PaginatedWidget) }] } })
 */
export function paginatedResponseOf<TModel extends Type<unknown>>(
  model: TModel,
) {
  class PaginatedResponseClass {
    @ApiProperty({ type: [model] })
    items: Array<InstanceType<TModel>>;

    @ApiProperty({ example: 42 })
    total: number;

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 100 })
    pageSize: number;
  }
  return PaginatedResponseClass;
}
