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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { MaterialRequestsService } from '../application/material-requests.service.js';
import { MATERIAL_REQUEST_PERMISSIONS } from '../domain/material-request-permissions.js';
import { InventoryScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  CreateMaterialRequestDto,
  InvokeMaterialRequestLineDto,
  ListMaterialRequestsQueryDto,
  MaterialRequestDetailResponseDto,
  MaterialRequestEventResponseDto,
  MaterialRequestLineResponseDto,
  MaterialRequestResponseDto,
  RejectMaterialRequestDto,
  ReverseMaterialRequestApprovalDto,
  UpdateMaterialRequestDto,
} from './dto/material-request.dto.js';

const PaginatedMaterialRequestDto = paginatedResponseOf(
  MaterialRequestResponseDto,
);

/**
 * Material Request (C-50) — an Inventory-owned business aggregate recording
 * DEMAND for stock, never a movement/receipt/issue, Purchase Request or
 * accounting document.
 *
 * Transport-only (AR-03): every business rule — draft-only editing,
 * explicit approval/rejection, approver-only reversal, optional per-line
 * reservation with availability checked at approval time, and bounded
 * invocation into a subsequent process — lives in
 * `MaterialRequestsService`/the domain layer.
 */
@ApiTags('material-requests')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/material-requests', version: '1' })
export class MaterialRequestsController {
  constructor(private readonly materialRequests: MaterialRequestsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List Material Requests of one organization.' })
  @ApiExtraModels(PaginatedMaterialRequestDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedMaterialRequestDto) }] },
  })
  async list(@Query() query: ListMaterialRequestsQueryDto): Promise<{
    items: MaterialRequestResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.materialRequests.listMaterialRequests(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one Material Request with its lines.' })
  @ApiOkResponse({ type: MaterialRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Material Request does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<MaterialRequestDetailResponseDto> {
    return this.materialRequests.getMaterialRequest(id, scope.organizationId);
  }

  @Get(':id/events')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'The append-only lifecycle narrative for one Material Request ' +
      '(created, submitted, approved, rejected, approval_reversed, line_invoked).',
  })
  @ApiOkResponse({ type: [MaterialRequestEventResponseDto] })
  @ApiNotFoundResponse({ description: 'Material Request does not exist.' })
  async listEvents(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<MaterialRequestEventResponseDto[]> {
    return this.materialRequests.listEvents(id, scope.organizationId);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create a draft Material Request with its lines. Each line picks its ' +
      'own warehouse; the system never auto-splits a line across warehouses.',
  })
  @ApiOkResponse({ type: MaterialRequestDetailResponseDto })
  @ApiNotFoundResponse({
    description: 'Organization, item, warehouse or unit does not exist.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'A non-stockable/lot-or-serial-tracked item, a disabled item/warehouse/unit, or no unit conversion covering now.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateMaterialRequestDto,
  ): Promise<MaterialRequestDetailResponseDto> {
    return this.materialRequests.createDraft({
      organizationId: body.organizationId,
      description: body.description,
      lines: body.lines,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit a draft Material Request. Only drafts can be edited; providing ' +
      '`lines` replaces the whole line set.',
  })
  @ApiOkResponse({ type: MaterialRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Material Request does not exist.' })
  @ApiUnprocessableEntityResponse({
    description: 'The request is not a draft.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async update(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: UpdateMaterialRequestDto,
  ): Promise<MaterialRequestDetailResponseDto> {
    return this.materialRequests.updateDraft(id, scope.organizationId, {
      description: body.description,
      lines: body.lines,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.DELETE)
  @ApiOperation({
    summary: 'Delete a draft Material Request. Only drafts can be deleted.',
  })
  @ApiNotFoundResponse({ description: 'Material Request does not exist.' })
  @ApiUnprocessableEntityResponse({
    description: 'The request is not a draft.',
  })
  async remove(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<void> {
    await this.materialRequests.deleteDraft(id, scope.organizationId);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.SUBMIT)
  @ApiOperation({
    summary:
      'Submit a draft Material Request for approval, allocating its number.',
  })
  @ApiOkResponse({ type: MaterialRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Material Request does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The request is not a draft, or no numbering series is configured for it.',
  })
  async submit(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<MaterialRequestDetailResponseDto> {
    return this.materialRequests.submit(id, scope.organizationId);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.APPROVE)
  @ApiOperation({
    summary:
      'Approve a submitted Material Request. Reserves stock, atomically with ' +
      'the approval, for every line that requested a reservation; insufficient ' +
      'availability on ANY flagged line refuses the WHOLE approval.',
  })
  @ApiOkResponse({ type: MaterialRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Material Request does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The request is not submitted, or a flagged line has insufficient available stock.',
  })
  async approve(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<MaterialRequestDetailResponseDto> {
    return this.materialRequests.approve(id, scope.organizationId);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.REJECT)
  @ApiOperation({
    summary: 'Reject a submitted Material Request with a reason.',
  })
  @ApiOkResponse({ type: MaterialRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Material Request does not exist.' })
  @ApiUnprocessableEntityResponse({
    description: 'The request is not submitted.',
  })
  @ApiBadRequestResponse({ description: 'A rejection reason is required.' })
  async reject(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: RejectMaterialRequestDto,
  ): Promise<MaterialRequestDetailResponseDto> {
    return this.materialRequests.reject(id, scope.organizationId, {
      reason: body.reason,
    });
  }

  @Post(':id/reverse-approval')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.REVERSE_APPROVAL)
  @ApiOperation({
    summary:
      'Reverse the approval of a Material Request, releasing any reservations ' +
      'it created. Necessary but not sufficient: only the ORIGINAL approver ' +
      'may use this, and it is refused once any line has been invoked.',
  })
  @ApiOkResponse({ type: MaterialRequestDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Material Request does not exist.' })
  @ApiForbiddenResponse({
    description:
      'Missing the permission, or the caller is not the original approver.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The request is not approved, or at least one line has already been invoked.',
  })
  async reverseApproval(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: ReverseMaterialRequestApprovalDto,
  ): Promise<MaterialRequestDetailResponseDto> {
    return this.materialRequests.reverseApproval(id, scope.organizationId, {
      reason: body.reason,
    });
  }

  @Put(':id/lines/invoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MATERIAL_REQUEST_PERMISSIONS.INVOKE)
  @ApiOperation({
    summary:
      'Record that an approved line has been carried into a subsequent ' +
      'process (e.g. a warehouse issue or a Purchase Request) via a Document ' +
      'Relation. Partial/multiple invocations of the same line are allowed, ' +
      'capped at the quantity still remaining on it.',
  })
  @ApiOkResponse({ type: MaterialRequestLineResponseDto })
  @ApiNotFoundResponse({
    description:
      'Material Request, line, or destination document type does not exist.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The request is not approved, or the invoked quantity exceeds the remaining quantity on the line.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async invokeLine(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: InvokeMaterialRequestLineDto,
  ): Promise<MaterialRequestLineResponseDto> {
    return this.materialRequests.invokeLine(id, scope.organizationId, {
      lineId: body.lineId,
      destinationModule: body.destinationModule,
      destinationDocumentType: body.destinationDocumentType,
      destinationDocumentId: body.destinationDocumentId,
      destinationLineId: body.destinationLineId,
      quantity: body.quantity,
    });
  }
}
