import {
  Body,
  Controller,
  Delete,
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
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { AccountingConfigurationsService } from '../application/accounting-configurations.service.js';
import { ACCOUNTING_CONFIGURATION_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  AccountingConfigurationResponseDto,
  CreateAccountingConfigurationDto,
  ListAccountingConfigurationsQueryDto,
  UpdateAccountingConfigurationDto,
} from './dto/accounting-configuration.dto.js';

const PaginatedConfigurationDto = paginatedResponseOf(
  AccountingConfigurationResponseDto,
);

@ApiTags('accounting-configurations')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'accounting-configurations', version: '1' })
export class AccountingConfigurationsController {
  constructor(
    private readonly configurations: AccountingConfigurationsService,
  ) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_CONFIGURATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the accounting configuration versions of one organization.',
  })
  @ApiExtraModels(PaginatedConfigurationDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedConfigurationDto) }] },
  })
  async list(@Query() query: ListAccountingConfigurationsQueryDto): Promise<{
    items: AccountingConfigurationResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.configurations.listConfigurations(query);
  }

  @Get('active')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_CONFIGURATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Get the organization’s ACTIVE accounting configuration version.',
  })
  @ApiOkResponse({ type: AccountingConfigurationResponseDto })
  @ApiNotFoundResponse({
    description: 'The organization has no active accounting configuration.',
  })
  async getActive(
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountingConfigurationResponseDto> {
    return this.configurations.getActiveConfiguration(scope.organizationId);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_CONFIGURATION_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Get one accounting configuration version with its levels.',
  })
  @ApiOkResponse({ type: AccountingConfigurationResponseDto })
  @ApiNotFoundResponse({
    description: 'Accounting configuration does not exist.',
  })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountingConfigurationResponseDto> {
    return this.configurations.getConfiguration(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Draft a new accounting configuration version (generic, versioned root — Task 11).',
  })
  @ApiCreatedResponse({ type: AccountingConfigurationResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or the configuration shape is invalid.',
  })
  @ApiConflictResponse({
    description: 'A version ordinal was created concurrently. Retry.',
  })
  async create(
    @Body() body: CreateAccountingConfigurationDto,
  ): Promise<AccountingConfigurationResponseDto> {
    return this.configurations.createConfiguration({
      organizationId: body.organizationId,
      code: body.code,
      name: body.name,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null,
      levels: body.levels,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Edit a DRAFT accounting configuration version (rejected once published or operationally used).',
  })
  @ApiOkResponse({ type: AccountingConfigurationResponseDto })
  @ApiNotFoundResponse({
    description: 'Accounting configuration does not exist.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or the configuration shape is invalid.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The version is not a draft and can no longer be changed.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: UpdateAccountingConfigurationDto,
  ): Promise<AccountingConfigurationResponseDto> {
    return this.configurations.updateConfiguration(scope.organizationId, id, {
      name: body.name,
      effectiveFrom:
        body.effectiveFrom === undefined
          ? undefined
          : body.effectiveFrom === null
            ? null
            : new Date(body.effectiveFrom),
      levels: body.levels,
    });
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Activate a draft version and supersede the previously active one (exactly one active per organization).',
  })
  @ApiOkResponse({ type: AccountingConfigurationResponseDto })
  @ApiNotFoundResponse({
    description: 'Accounting configuration does not exist.',
  })
  @ApiBadRequestResponse({
    description: 'The level set is not a complete, valid configuration.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Only a draft version can be published.',
  })
  async publish(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountingConfigurationResponseDto> {
    return this.configurations.publishConfiguration(scope.organizationId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_CONFIGURATION_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary: 'Delete a DRAFT accounting configuration version.',
  })
  @ApiNotFoundResponse({
    description: 'Accounting configuration does not exist.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Only DRAFT configurations not yet operationally used can be deleted.',
  })
  async remove(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<void> {
    await this.configurations.deleteConfiguration(scope.organizationId, id);
  }
}
