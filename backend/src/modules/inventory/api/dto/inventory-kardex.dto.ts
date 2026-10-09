import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { IsBusinessDay } from '../../../../kernel/http/is-business-day.decorator.js';
import { MOVEMENT_TYPES } from '../../domain/movement-type.js';

export class InventoryKardexQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' }) @IsUlid() organizationId!: string;
  @ApiProperty({ format: 'ulid' }) @IsUlid() itemId!: string;
  @ApiProperty({ format: 'ulid' }) @IsUlid() warehouseId!: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description:
      'Inclusive lower bound on the movement BUSINESS DAY, canonical Gregorian YYYY-MM-DD (OQ-73).',
  })
  @IsOptional()
  @IsBusinessDay()
  dateFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-08',
    description:
      'Inclusive upper bound on the movement BUSINESS DAY, canonical Gregorian YYYY-MM-DD (OQ-73).',
  })
  @IsOptional()
  @IsBusinessDay()
  dateTo?: string;

  @ApiPropertyOptional({
    format: 'ulid',
    description: 'Unit used for presentation. Omit for the item base unit.',
  })
  @IsOptional()
  @IsUlid()
  displayUnitId?: string;

  @ApiPropertyOptional({
    description:
      'Opaque PostgreSQL ledger snapshot returned by page 1. Required for pages after page 1.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/)
  snapshot?: string;
}

export class InventoryKardexRowDto {
  @ApiProperty({ format: 'ulid' }) movementId!: string;
  @ApiProperty({ format: 'date', example: '2026-10-08' })
  movementDate!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ enum: MOVEMENT_TYPES }) movementType!: string;
  @ApiProperty({ example: '-20.0000' }) signedQuantity!: string;
  @ApiProperty({ format: 'ulid' }) displayUnitId!: string;
  @ApiProperty({ example: '80.0000' }) runningQuantity!: string;
  @ApiProperty({ format: 'ulid', nullable: true }) transferId!: string | null;
  @ApiProperty({ format: 'ulid', nullable: true }) reversalOfMovementId!:
    string | null;
  @ApiProperty({ nullable: true }) referenceType!: string | null;
  @ApiProperty({ nullable: true }) referenceId!: string | null;
}

export class InventoryKardexScopeDto {
  @ApiProperty({ format: 'ulid' }) organizationId!: string;
  @ApiProperty({ format: 'ulid' }) itemId!: string;
  @ApiProperty({ format: 'ulid' }) warehouseId!: string;
  @ApiProperty({ format: 'date', nullable: true }) dateFrom!: string | null;
  @ApiProperty({ format: 'date', nullable: true }) dateTo!: string | null;
  @ApiProperty({ format: 'ulid' }) baseUnitId!: string;
  @ApiProperty({ format: 'ulid' }) displayUnitId!: string;
}

export class InventoryKardexResponseDto {
  @ApiProperty({ type: [InventoryKardexRowDto] })
  items!: InventoryKardexRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty({ type: InventoryKardexScopeDto })
  scope!: InventoryKardexScopeDto;
  @ApiProperty({ example: '100.0000' }) opening!: string;
  @ApiProperty({ example: '130.0000' }) closing!: string;
  @ApiProperty({
    enum: [
      'ledger_movements_before_date_from',
      'zero_before_all_recorded_movements',
    ],
  })
  openingBasis!: string;
  @ApiProperty({ description: 'Pass unchanged for every subsequent page.' })
  snapshot!: string;
}
