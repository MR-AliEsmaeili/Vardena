import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import {
  MAX_BARCODE_LENGTH,
  MAX_CODE_LENGTH,
  MAX_NAME_LENGTH,
} from '../../domain/master-data.js';
import { ITEM_KINDS, type ItemKind } from '../../domain/item-kind.js';

/**
 * Item API contracts (D-25, master-data-strategy.md §3).
 *
 * One resource, one shape: `itemKind` selects the defaults and the capability
 * booleans are the truth. There is no `/products` or `/services` endpoint and
 * no attributes bag.
 *
 * `itemKind` appears on create only — it is immutable afterwards, because kind
 * supplies creation-time defaults and re-applying them over deliberately-set
 * flags is a rule nobody has approved (see `application/items.service.ts`).
 *
 * Capability flags are optional on create: whatever the caller omits comes from
 * the kind's defaults, resolved once and stored.
 */

const MAX_DESCRIPTION_LENGTH = 2000;

export class CreateItemDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ example: 'ITM-0001', maxLength: MAX_CODE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({ example: 'Steel bolt M8', maxLength: MAX_NAME_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @ApiProperty({
    enum: ITEM_KINDS,
    description:
      'Closed, code-defined classification. Adding a kind is a code change, not data entry.',
  })
  @IsIn(ITEM_KINDS as readonly string[], {
    message: `Item kind must be one of: ${ITEM_KINDS.join(', ')}.`,
  })
  itemKind!: ItemKind;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Item group; must belong to the same organization.',
  })
  @IsOptional()
  @IsUlid()
  itemGroupId?: string;

  @ApiProperty({
    format: 'ulid',
    description:
      'Base unit: every quantity for this item is stored in it. Must belong to the same organization.',
  })
  @IsUlid()
  baseUnitId!: string;

  @ApiPropertyOptional({
    description: 'Omit to take the default for the item kind.',
  })
  @IsOptional()
  @IsBoolean()
  isStockable?: boolean;

  @ApiPropertyOptional({
    description: 'Omit to take the default for the item kind.',
  })
  @IsOptional()
  @IsBoolean()
  isPurchasable?: boolean;

  @ApiPropertyOptional({
    description: 'Omit to take the default for the item kind.',
  })
  @IsOptional()
  @IsBoolean()
  isSellable?: boolean;

  @ApiPropertyOptional({
    description:
      'Omit to take the default for the item kind. A valued item must be stockable.',
  })
  @IsOptional()
  @IsBoolean()
  isValued?: boolean;

  @ApiPropertyOptional({
    description: 'Requires a stockable item.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  requiresLot?: boolean;

  @ApiPropertyOptional({
    description: 'Requires a stockable item.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  requiresSerial?: boolean;

  @ApiPropertyOptional({
    description: 'Requires a stockable item.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  requiresExpiry?: boolean;

  @ApiPropertyOptional({
    description:
      'Item-level negative-stock override (ADR-0022). Omit to follow each warehouse policy; set explicitly to allow or forbid negative stock for this item everywhere.',
  })
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @ApiPropertyOptional({ maxLength: MAX_BARCODE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BARCODE_LENGTH)
  barcode?: string;
}

export class UpdateItemDto {
  @ApiPropertyOptional({ maxLength: MAX_CODE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Code cannot be blank.' })
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: MAX_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name cannot be blank.' })
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    nullable: true,
    description:
      'New item group (`null` removes it); must belong to the same organization.',
  })
  @IsOptional()
  @IsUlid()
  itemGroupId?: string | null;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'New base unit; must belong to the same organization.',
  })
  @IsOptional()
  @IsUlid()
  baseUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isStockable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPurchasable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSellable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isValued?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresLot?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresSerial?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresExpiry?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Item-level negative-stock override (ADR-0022). `null` clears the override so each warehouse policy applies again.',
  })
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean | null;

  @ApiPropertyOptional({ maxLength: MAX_BARCODE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BARCODE_LENGTH)
  barcode?: string;
}

export class ListItemsQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ enum: ITEM_KINDS })
  @IsOptional()
  @IsIn(ITEM_KINDS as readonly string[])
  itemKind?: ItemKind;

  @ApiPropertyOptional({ format: 'ulid' })
  @IsOptional()
  @IsUlid()
  itemGroupId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isStockable?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isSellable?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isPurchasable?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code, name or barcode.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class ItemResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'ITM-0001' })
  code!: string;

  @ApiProperty({ example: 'Steel bolt M8' })
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ITEM_KINDS })
  itemKind!: string;

  @ApiProperty({ format: 'ulid', nullable: true })
  itemGroupId!: string | null;

  @ApiProperty({ format: 'ulid' })
  baseUnitId!: string;

  @ApiProperty()
  isStockable!: boolean;

  @ApiProperty()
  isPurchasable!: boolean;

  @ApiProperty()
  isSellable!: boolean;

  @ApiProperty()
  isValued!: boolean;

  @ApiProperty()
  requiresLot!: boolean;

  @ApiProperty()
  requiresSerial!: boolean;

  @ApiProperty()
  requiresExpiry!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Item-level negative-stock override; `null` means the item follows each warehouse policy (ADR-0022).',
  })
  allowNegativeStock!: boolean | null;

  @ApiProperty({ nullable: true })
  barcode!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
