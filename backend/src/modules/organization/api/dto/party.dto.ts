import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
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
  MAX_CODE_LENGTH,
  MAX_PARTY_NAME_LENGTH,
} from '../../domain/master-data.js';
import { PARTY_TYPES, type PartyType } from '../../domain/party.js';

/**
 * Party API contracts (D-02, master-data-strategy.md §5).
 *
 * Customer/supplier are capability booleans on the request, not separate
 * endpoints and not a role array: `isCustomer: true, isSupplier: true` is one
 * party that both sells to us and supplies us. At least one capability is
 * required — that rule is a domain rule, so it is enforced in the service
 * (422) and not only here.
 *
 * There are deliberately no national-id / economic-code / tax fields: their
 * semantics and validation are unresolved and expert-gated (OQ-30, OQ-38).
 */

const MAX_EMAIL_LENGTH = 320;
const MAX_PHONE_LENGTH = 64;

export class CreatePartyDto {
  @ApiProperty({ format: 'ulid', description: 'Owning organization.' })
  @IsUlid()
  organizationId!: string;

  @ApiProperty({ example: 'C-0001', maxLength: MAX_CODE_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Code is required.' })
  @MaxLength(MAX_CODE_LENGTH)
  code!: string;

  @ApiProperty({ example: 'Nika Retail', maxLength: MAX_PARTY_NAME_LENGTH })
  @IsString()
  @MinLength(1, { message: 'Display name is required.' })
  @MaxLength(MAX_PARTY_NAME_LENGTH)
  displayName!: string;

  @ApiPropertyOptional({
    description: 'Registered/legal name, where the counterparty has one.',
    maxLength: MAX_PARTY_NAME_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PARTY_NAME_LENGTH)
  legalName?: string;

  @ApiProperty({
    enum: PARTY_TYPES,
    description: 'Closed, code-defined party identity type.',
  })
  @IsIn(PARTY_TYPES as readonly string[], {
    message: `Party type must be one of: ${PARTY_TYPES.join(', ')}.`,
  })
  partyType!: string;

  @ApiProperty({ example: true, description: 'Customer capability.' })
  @IsBoolean()
  isCustomer!: boolean;

  @ApiProperty({ example: false, description: 'Supplier capability.' })
  @IsBoolean()
  isSupplier!: boolean;

  @ApiPropertyOptional({ maxLength: MAX_EMAIL_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_EMAIL_LENGTH)
  @IsEmail({}, { message: 'Email must be a valid address.' })
  email?: string;

  @ApiPropertyOptional({ maxLength: MAX_PHONE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHONE_LENGTH)
  phone?: string;
}

export class UpdatePartyDto {
  @ApiPropertyOptional({ maxLength: MAX_CODE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Code cannot be blank.' })
  @MaxLength(MAX_CODE_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: MAX_PARTY_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Display name cannot be blank.' })
  @MaxLength(MAX_PARTY_NAME_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: MAX_PARTY_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PARTY_NAME_LENGTH)
  legalName?: string;

  @ApiPropertyOptional({ enum: PARTY_TYPES })
  @IsOptional()
  @IsIn(PARTY_TYPES as readonly string[], {
    message: `Party type must be one of: ${PARTY_TYPES.join(', ')}.`,
  })
  partyType?: PartyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCustomer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSupplier?: boolean;

  @ApiPropertyOptional({ maxLength: MAX_EMAIL_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_EMAIL_LENGTH)
  @IsEmail({}, { message: 'Email must be a valid address.' })
  email?: string;

  @ApiPropertyOptional({ maxLength: MAX_PHONE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PHONE_LENGTH)
  phone?: string;
}

export class ListPartiesQueryDto extends PageQueryDto {
  @ApiProperty({ format: 'ulid' })
  @IsUlid()
  organizationId!: string;

  @ApiPropertyOptional({ enum: PARTY_TYPES })
  @IsOptional()
  @IsIn(PARTY_TYPES as readonly string[])
  partyType?: PartyType;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Restrict to parties with the customer capability.',
  })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isCustomer?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Restrict to parties with the supplier capability.',
  })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isSupplier?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Case-insensitive substring match on code, display or legal name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class PartyResponseDto {
  @ApiProperty({ format: 'ulid' })
  id!: string;

  @ApiProperty({ format: 'ulid' })
  organizationId!: string;

  @ApiProperty({ example: 'C-0001' })
  code!: string;

  @ApiProperty({ example: 'Nika Retail' })
  displayName!: string;

  @ApiProperty({ nullable: true })
  legalName!: string | null;

  @ApiProperty({ enum: PARTY_TYPES })
  partyType!: string;

  @ApiProperty()
  isCustomer!: boolean;

  @ApiProperty()
  isSupplier!: boolean;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
