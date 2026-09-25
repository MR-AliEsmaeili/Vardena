import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import { GeneralLedgerService } from '../application/general-ledger.service.js';
import { GENERAL_LEDGER_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  GeneralLedgerQueryDto,
  GeneralLedgerResponseDto,
} from './dto/general-ledger.dto.js';

const PaginatedGeneralLedgerDto = paginatedResponseOf(GeneralLedgerResponseDto);

/** Explicit, read-only General Ledger report API. */
@ApiTags('accounting-general-ledger')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing Accounting.GeneralLedger.View.',
})
@Controller({ path: 'accounting/general-ledger', version: '1' })
export class GeneralLedgerController {
  constructor(private readonly generalLedger: GeneralLedgerService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(GENERAL_LEDGER_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Read the bounded General Ledger.',
    description:
      'Reads immutable posted ledger entries with a deterministic default order of Document Date, Posting Timestamp, Document ID, Ledger Line ID. The optional sort is limited to the documented allow-list; Document Date is the financial reporting axis and Posting Timestamp is technical/audit data. No source mutation is possible.',
  })
  @ApiExtraModels(PaginatedGeneralLedgerDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedGeneralLedgerDto) }] },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid paging/date/filter value, unsupported query parameter, or sort field outside the documented allow-list.',
  })
  @ApiNotFoundResponse({
    description:
      'Organization, financial area, fiscal year, period, account, or hierarchy root is not in the request organization scope.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The area/year/period scope is inconsistent, the organization is disabled, or the date range escapes the fiscal year.',
  })
  async list(@Query() query: GeneralLedgerQueryDto): Promise<{
    items: GeneralLedgerResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.generalLedger.list(query);
    return {
      items: result.items as GeneralLedgerResponseDto[],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }
}
