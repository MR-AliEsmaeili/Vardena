import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
import { ChartTreeService } from '../application/chart-tree.service.js';
import { ACCOUNT_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  ChartTreeNodeDto,
  ListChartTreeQueryDto,
} from './dto/chart-tree.dto.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';

const PaginatedChartTreeDto = paginatedResponseOf(ChartTreeNodeDto);

/**
 * The Accounting-owned Chart Tree read surface (ODR-2, Task 19 Slice 2).
 *
 * READ-ONLY and organization-scoped: one GET lists the whole chart in the
 * FIXED canonical order (code ascending), one GET reads a single node.
 * Transport-only (AR-03). The tree is delivered FLAT — `parentId` and `level`
 * carry the hierarchy; a consumer nests the page itself. No balances or
 * turnovers (Task 18's report surfaces own every figure), no account
 * classification beyond the authoritative `isPostable`, no mutation verb, and
 * no Reporting module (ADR-0009: Reporting is a view/policy layer, never a
 * second Account master).
 *
 * Foreign/unknown organization keys answer 404 (the Accounting isolation
 * posture); disabled organizations answer 422; cross-organization account ids
 * answer 404, indistinguishable from unknown ones.
 */
@ApiTags('accounting-chart-tree')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing Accounting.Account.View.',
})
@Controller({ path: 'accounting/chart-tree', version: '1' })
export class ChartTreeController {
  constructor(private readonly chartTree: ChartTreeService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Read one organization’s chart tree (flat, code-ascending).',
    description:
      'Returns the account master as tree nodes: identity, hierarchy (parentId/level), code, name, active/inactive and isPostable (posting leaf vs aggregation node). The order is fixed (code ascending); inactive nodes are included (accounts are never deleted). No balances, turnovers or account classification.',
  })
  @ApiExtraModels(PaginatedChartTreeDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedChartTreeDto) }] },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid paging value, unsupported query parameter, or an explicit sort (the order is fixed).',
  })
  @ApiNotFoundResponse({
    description:
      'Organization is unknown, foreign to the caller, or not in the request organization scope.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The organization is disabled.',
  })
  async list(@Query() query: ListChartTreeQueryDto): Promise<{
    items: ChartTreeNodeDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.chartTree.list(query);
    return {
      items: result.items as ChartTreeNodeDto[],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Read one chart tree node.',
  })
  @ApiOkResponse({ type: ChartTreeNodeDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameter.' })
  @ApiNotFoundResponse({
    description:
      'Organization or account is unknown, foreign to the caller, or not in the request organization scope.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The organization is disabled.',
  })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<ChartTreeNodeDto> {
    return (await this.chartTree.get(
      scope.organizationId,
      id,
    )) as ChartTreeNodeDto;
  }
}
