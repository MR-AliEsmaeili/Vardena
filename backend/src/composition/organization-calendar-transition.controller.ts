import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../modules/identity/application/auth.guard.js';
import { AuthorizationGuard } from '../modules/rbac/application/authorization.guard.js';
import { RequirePermission } from '../modules/rbac/application/require-permission.decorator.js';
import { ORGANIZATION_PERMISSIONS } from '../modules/organization/domain/organization-permissions.js';
import { DeploymentOrganizationRoot } from '../modules/organization/application/deployment-scope.decorator.js';
import {
  OrganizationResponseDto,
  UpdateOrganizationDto,
} from '../modules/organization/api/dto/organization.dto.js';
import { OrganizationCalendarTransitionService } from './organization-calendar-transition.service.js';

/**
 * The PATCH transport route stays `/api/v1/organizations/:id`; only its
 * application composition moves to the app root so the business modules remain
 * acyclic. HTTP validation, authorization metadata and response DTO are
 * unchanged (AR-03, AR-21).
 */
@ApiTags('organizations')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'organizations', version: '1' })
export class OrganizationCalendarTransitionController {
  constructor(
    private readonly calendarTransition: OrganizationCalendarTransitionService,
  ) {}

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ORGANIZATION_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit an organization.' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiNotFoundResponse({ description: 'Organization does not exist.' })
  @ApiConflictResponse({ description: 'Organization code already exists.' })
  @ApiUnprocessableEntityResponse({
    description:
      'A GREGORIAN organization cannot change to JALALI while Inventory history contains business dates outside the supported Jalali rendering range. Keep the calendar GREGORIAN; historical documents are not changed.',
  })
  @DeploymentOrganizationRoot()
  async update(
    @Param('id') id: string,
    @Body() body: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.calendarTransition.updateOrganization(id, {
      code: body.code,
      name: body.name,
      calendarSystem: body.calendarSystem,
      timeZone: body.timeZone,
    });
  }
}
