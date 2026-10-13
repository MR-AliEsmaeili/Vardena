import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { PartiesService } from '../application/parties.service.js';
import { PARTY_PERMISSIONS } from '../domain/organization-permissions.js';
import { OrganizationScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  CreatePartyDto,
  ListPartiesQueryDto,
  PartyResponseDto,
  UpdatePartyDto,
} from './dto/party.dto.js';

const PaginatedPartyDto = paginatedResponseOf(PartyResponseDto);

/**
 * Party administration — the single counterparty master (D-02,
 * master-data-strategy.md §5).
 *
 * Transport-only (AR-03). There are no `/customers` or `/suppliers` endpoints:
 * the capabilities are filters on this resource (`?isCustomer=true`,
 * `?isSupplier=true`), which is what makes a dual-role partner one record.
 */
@ApiTags('parties')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'parties', version: '1' })
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(PARTY_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List the parties of one organization, optionally filtered by type or capability.',
  })
  @ApiExtraModels(PaginatedPartyDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedPartyDto) }] },
  })
  async list(@Query() query: ListPartiesQueryDto): Promise<{
    items: PartyResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.parties.listParties(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(PARTY_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one party.' })
  @ApiOkResponse({ type: PartyResponseDto })
  @ApiNotFoundResponse({ description: 'Party does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<PartyResponseDto> {
    return this.parties.getParty(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(PARTY_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create a party. Set both `isCustomer` and `isSupplier` for a partner that is both.',
  })
  @ApiCreatedResponse({ type: PartyResponseDto })
  @ApiConflictResponse({
    description: 'Party code already exists in this organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(@Body() body: CreatePartyDto): Promise<PartyResponseDto> {
    return this.parties.createParty({
      organizationId: body.organizationId,
      code: body.code,
      displayName: body.displayName,
      legalName: body.legalName,
      partyType: body.partyType,
      isCustomer: body.isCustomer,
      isSupplier: body.isSupplier,
      email: body.email,
      phone: body.phone,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(PARTY_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit a party, including its capabilities (at least one must remain).',
  })
  @ApiOkResponse({ type: PartyResponseDto })
  @ApiNotFoundResponse({ description: 'Party does not exist.' })
  @ApiConflictResponse({
    description: 'Party code already exists in this organization.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
    @Body() body: UpdatePartyDto,
  ): Promise<PartyResponseDto> {
    return this.parties.updateParty(scope.organizationId, id, {
      code: body.code,
      displayName: body.displayName,
      legalName: body.legalName,
      partyType: body.partyType,
      isCustomer: body.isCustomer,
      isSupplier: body.isSupplier,
      email: body.email,
      phone: body.phone,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(PARTY_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled party.' })
  @ApiOkResponse({ type: PartyResponseDto })
  @ApiNotFoundResponse({ description: 'Party does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<PartyResponseDto> {
    return this.parties.enableParty(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(PARTY_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable a party (blocks new documents referencing it; history stays readable).',
  })
  @ApiOkResponse({ type: PartyResponseDto })
  @ApiNotFoundResponse({ description: 'Party does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<PartyResponseDto> {
    return this.parties.disableParty(scope.organizationId, id);
  }
}
