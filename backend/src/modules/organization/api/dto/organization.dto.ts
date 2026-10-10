import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import { parseQueryBoolean } from '../../../../kernel/http/parse-query-boolean.js';
import { MAX_CODE_LENGTH, MAX_NAME_LENGTH } from '../../domain/master-data.js';

/**
 * Organization API contracts (ADR-0014: DTOs are the OpenAPI contract).
 *
 * One file per entity holds that entity's request, query and response DTOs so
 * the whole HTTP surface of an entity can be reviewed in one place. Unknown
 * fields are rejected by the global validation pipe (`whitelist` +
 * `forbidNonWhitelisted`), so a caller cannot set `isActive`, `createdBy` or
 * any other field the API does not own — state changes go through the
 * enable/disable endpoints, each with its own permission.
 */

export class CreateOrganizationDto {
  @ApiProperty({ example: 'ACME', maxLength: MAX_CODE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({ example: 'Acme Trading Co.', maxLength: MAX_NAME_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  @MaxLength(MAX_NAME_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    example: 'Asia/Tehran',
    description:
      'C-63 IANA time zone used for local date-times. Omit for the deployment default (Asia/Tehran). A fixed offset is rejected.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timeZone?: string;
}

/** Partial update: only the supplied fields change. */
export class UpdateOrganizationDto {
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

  @ApiPropertyOptional({
    example: 'Asia/Tehran',
    description:
      'C-63 IANA time zone of this organization. Changing it affects instant rendering only; stored Instants and BusinessDates are unchanged.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timeZone?: string;
}

/**
 * Organization list query. `sort` is validated for syntax here and restricted
 * to `code`, `name`, `createdAt`, `updatedAt` by the service.
 */
export class ListOrganizationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Filter by lifecycle state.',
  })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on code or name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class OrganizationResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ example: 'ACME' })
  code!: string;

  @ApiProperty({ example: 'Acme Trading Co.' })
  name!: string;

  @ApiProperty({
    description:
      'False while disabled. A disabled organization blocks the creation of new organization-scoped records but keeps existing ones readable.',
  })
  isActive!: boolean;

  @ApiProperty({
    enum: ['JALALI'],
    readOnly: true,
    description:
      'Fixed Jalali-first MVP display calendar. This read-only compatibility field is not configurable; BusinessDates remain Gregorian canonical.',
  })
  calendarSystem!: 'JALALI';

  @ApiProperty({
    example: 'Asia/Tehran',
    description:
      'C-63 IANA time zone used to turn an instant into a local date-time for this organization.',
  })
  timeZone!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
