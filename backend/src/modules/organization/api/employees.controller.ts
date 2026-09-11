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
import { EmployeesService } from '../application/employees.service.js';
import { EMPLOYEE_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  CreateEmployeeDto,
  EmployeeResponseDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto.js';

const PaginatedEmployeeDto = paginatedResponseOf(EmployeeResponseDto);

/**
 * Employee administration — minimal reference data (OQ-32).
 *
 * Transport-only (AR-03). This is not an HR surface: there are no contracts,
 * attendance, payroll or recruitment endpoints, and no user-account linkage
 * (OQ-37). Department/branch organization consistency is enforced in the
 * application service.
 */
@ApiTags('employees')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(EMPLOYEE_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the employees of one organization.' })
  @ApiExtraModels(PaginatedEmployeeDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedEmployeeDto) }] },
  })
  async list(
    @Query() query: ListEmployeesQueryDto,
  ): Promise<{
    items: EmployeeResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.employees.listEmployees(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(EMPLOYEE_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one employee.' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @ApiNotFoundResponse({ description: 'Employee does not exist.' })
  async get(@Param('id') id: string): Promise<EmployeeResponseDto> {
    return this.employees.getEmployee(id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(EMPLOYEE_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create an employee record.' })
  @ApiCreatedResponse({ type: EmployeeResponseDto })
  @ApiConflictResponse({
    description: 'Employee code already exists in this organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(@Body() body: CreateEmployeeDto): Promise<EmployeeResponseDto> {
    return this.employees.createEmployee({
      organizationId: body.organizationId,
      employeeCode: body.employeeCode,
      firstName: body.firstName,
      lastName: body.lastName,
      departmentId: body.departmentId,
      branchId: body.branchId,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(EMPLOYEE_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit an employee record.' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @ApiNotFoundResponse({ description: 'Employee does not exist.' })
  @ApiConflictResponse({
    description: 'Employee code already exists in this organization.',
  })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employees.updateEmployee(id, {
      employeeCode: body.employeeCode,
      firstName: body.firstName,
      lastName: body.lastName,
      departmentId: body.departmentId,
      branchId: body.branchId,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(EMPLOYEE_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled employee.' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @ApiNotFoundResponse({ description: 'Employee does not exist.' })
  async enable(@Param('id') id: string): Promise<EmployeeResponseDto> {
    return this.employees.enableEmployee(id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(EMPLOYEE_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable an employee (blocks new usage; historical references stay readable).',
  })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @ApiNotFoundResponse({ description: 'Employee does not exist.' })
  async disable(@Param('id') id: string): Promise<EmployeeResponseDto> {
    return this.employees.disableEmployee(id);
  }
}
