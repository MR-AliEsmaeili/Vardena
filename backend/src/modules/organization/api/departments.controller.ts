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
import { DepartmentsService } from '../application/departments.service.js';
import { DEPARTMENT_PERMISSIONS } from '../domain/organization-permissions.js';
import { OrganizationScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  CreateDepartmentDto,
  DepartmentResponseDto,
  ListDepartmentsQueryDto,
  UpdateDepartmentDto,
} from './dto/department.dto.js';

const PaginatedDepartmentDto = paginatedResponseOf(DepartmentResponseDto);

/**
 * Department administration (docs/modules.md §Organization).
 *
 * Transport-only (AR-03). Hierarchy rules (same organization, no
 * self-parenting, no cycles) are application-service rules, not DTO rules, so
 * they surface as 422 `BusinessRuleViolation` rather than 400.
 */
@ApiTags('departments')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'departments', version: '1' })
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DEPARTMENT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the departments of one organization.' })
  @ApiExtraModels(PaginatedDepartmentDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedDepartmentDto) }] },
  })
  async list(
    @Query() query: ListDepartmentsQueryDto,
  ): Promise<{
    items: DepartmentResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.departments.listDepartments(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DEPARTMENT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one department.' })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @ApiNotFoundResponse({ description: 'Department does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<DepartmentResponseDto> {
    return this.departments.getDepartment(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DEPARTMENT_PERMISSIONS.CREATE)
  @ApiOperation({
    summary: 'Create a department (optionally under a parent department).',
  })
  @ApiCreatedResponse({ type: DepartmentResponseDto })
  @ApiConflictResponse({
    description: 'Department code already exists in this organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateDepartmentDto,
  ): Promise<DepartmentResponseDto> {
    return this.departments.createDepartment({
      organizationId: body.organizationId,
      parentDepartmentId: body.parentDepartmentId,
      code: body.code,
      name: body.name,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DEPARTMENT_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit a department. Changing the parent is validated against self-parenting and cycles.',
  })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @ApiNotFoundResponse({ description: 'Department does not exist.' })
  @ApiConflictResponse({
    description: 'Department code already exists in this organization.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
    @Body() body: UpdateDepartmentDto,
  ): Promise<DepartmentResponseDto> {
    return this.departments.updateDepartment(scope.organizationId, id, {
      parentDepartmentId: body.parentDepartmentId,
      code: body.code,
      name: body.name,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DEPARTMENT_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled department.' })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @ApiNotFoundResponse({ description: 'Department does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<DepartmentResponseDto> {
    return this.departments.enableDepartment(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DEPARTMENT_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable a department (blocks new usage; child departments and assigned employees stay readable).',
  })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @ApiNotFoundResponse({ description: 'Department does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<DepartmentResponseDto> {
    return this.departments.disableDepartment(scope.organizationId, id);
  }
}
