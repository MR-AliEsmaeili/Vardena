import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsUlid } from '../../../../kernel/http/is-ulid.decorator.js';
import { PageQueryDto } from '../../../../kernel/pagination/page-query.dto.js';
import type {
  AccountStatementEntry,
  AccountStatementTotals,
  AccountStatementScope,
} from '../../domain/account-statement.js';

/**
 * Account Statement API shape (Task 17B Account Statement slice).
 *
 * QUERY — the decided filter surface (prompt §12), NOTHING else. Exactly the
 * scope keys (`organizationId`, `accountId`, `fiscalYearId`, optional
 * `accountingPeriodId`, optional `financialAreaId`) plus the shared paging
 * parameters. There is no client sort (the statement order is fixed), no
 * date window (decision D2 fixes the opening to the fiscal-year/period
 * boundary), no voucher/serial/status/text filters and no generic filter
 * engine. The global whitelist validation (`forbidNonWhitelisted`, set up in
 * `main.ts`) rejects ANY other query parameter with 400 — the parameter
 * profile the implementation gate locks (§14).
 *
 * RESPONSE — the declared statement envelope (prompt §8): header/scope echo,
 * movement rows, totals and the three disclosure constants. Amount fields
 * are exact canonical decimal strings (AR-05); dates are `YYYY-MM-DD`
 * strings (§7.2).
 */
export class AccountStatementQueryDto extends PageQueryDto {
  @ApiProperty({
    description:
      'Organization whose ledger is read (tenant scope; foreign ids answer 404).',
  })
  @IsUlid()
  organizationId: string;

  @ApiProperty({
    description:
      'One POSTABLE account of the chart (decision D1). Non-postable accounts answer 422.',
  })
  @IsUlid()
  accountId: string;

  @ApiProperty({
    description:
      'One fiscal year (decision D1/D2). The statement never spans years — the opening is intra-year by design.',
  })
  @IsUlid()
  fiscalYearId: string;

  @ApiPropertyOptional({
    description:
      'One accounting period of the requested fiscal year (optional). Omit for the whole year (opening `0`, decision D2). A period of another year answers 422.',
  })
  @IsOptional()
  @IsUlid()
  accountingPeriodId?: string;

  @ApiPropertyOptional({
    description:
      'The financial area of the statement (optional). When present it must equal the fiscal year’s financial area (422 on mismatch; 404 for a foreign area id) — decision D4.',
  })
  @IsOptional()
  @IsUlid()
  financialAreaId?: string;
}

/**
 * One movement row of the statement (prompt §8 "Movement rows") — the accepted
 * Task 17A `LedgerMovementDto` fields unchanged (ids only on rows; the
 * account's code/title live once in the scope echo), plus the two derived
 * measures. `voucherId` + `voucherLineId` + the `source*` snapshot are the
 * traceability keys back to the originating document (manual voucher or
 * system-origin source entity).
 */
export class AccountStatementEntryDto {
  @ApiProperty({ description: 'Ledger entry id (immutable source row).' })
  id: string;

  @ApiProperty({ description: 'Tenant scope of the entry.' })
  organizationId: string;

  @ApiProperty({ description: 'Bookkeeping scope of the entry.' })
  financialAreaId: string;

  @ApiProperty({
    description: 'Stored fiscal-year resolution (never recomputed).',
  })
  fiscalYearId: string;

  @ApiProperty({ description: 'Stored accounting-period resolution.' })
  accountingPeriodId: string;

  @ApiProperty({
    description: 'Source voucher id — the originating accounting document.',
  })
  voucherId: string;

  @ApiProperty({
    description: 'Human-readable voucher number (serial snapshot).',
  })
  voucherNumber: string;

  @ApiProperty({
    description: 'Source voucher line id (1:1 traceability key).',
  })
  voucherLineId: string;

  @ApiProperty({ description: '1-based line number inside the voucher.' })
  lineNo: number;

  @ApiProperty({
    description: 'Postable account id (the statement’s account).',
  })
  accountId: string;

  @ApiProperty({ description: 'Debit amount (exact decimal string).' })
  debitAmount: string;

  @ApiProperty({ description: 'Credit amount (exact decimal string).' })
  creditAmount: string;

  @ApiProperty({
    description: 'Net movement = debit − credit (exact signed decimal string).',
  })
  netAmount: string;

  @ApiProperty({
    description:
      'Running balance = opening + Σ net of every earlier row in the statement order (continues across pages).',
  })
  runningBalanceAmount: string;

  @ApiPropertyOptional({
    description: 'Line description of the voucher line, when supplied.',
    nullable: true,
  })
  description: string | null;

  @ApiProperty({ description: 'Business/occurrence date — `YYYY-MM-DD`.' })
  documentDate: string;

  @ApiProperty({
    description:
      'System timestamp of the posting act (ISO) — distinct from the business date.',
  })
  postingTimestamp: string;

  @ApiProperty({ description: '`manual` | `system` (closed list).' })
  origin: string;

  @ApiPropertyOptional({
    description: 'System-origin source module snapshot; null for `manual`.',
    nullable: true,
  })
  sourceModule: string | null;

  @ApiPropertyOptional({
    description: 'System-origin source entity type; null for `manual`.',
    nullable: true,
  })
  sourceEntityType: string | null;

  @ApiPropertyOptional({
    description:
      'System-origin source document id (traceability); null for `manual`.',
    nullable: true,
  })
  sourceEntityId: string | null;

  @ApiPropertyOptional({
    description: 'System-origin source operation; null for `manual`.',
    nullable: true,
  })
  sourceOperation: string | null;
}

/** Scope echo of the statement (prompt §8 "Header / scope"). */
export class AccountStatementScopeDto {
  @ApiProperty({ description: 'Organization the statement belongs to.' })
  organizationId: string;

  @ApiProperty({ description: 'Financial area identity and labels.' })
  financialArea: { id: string; code: string; title: string };

  @ApiProperty({
    description:
      'Fiscal year identity, labels, `YYYY-MM-DD` bounds and status (echoed — reads work for open, closed and sealed alike, decision D5).',
  })
  fiscalYear: {
    id: string;
    code: string;
    title: string;
    startDate: string;
    endDate: string;
    status: string;
  };

  @ApiProperty({
    description:
      'Account identity and labels — code/title only (no nature; decision D3).',
  })
  account: { id: string; code: string; title: string };

  @ApiPropertyOptional({
    description: 'Accounting period echo, or `null` for the whole-year window.',
    nullable: true,
  })
  accountingPeriod: {
    id: string;
    sequence: number;
    title: string;
    startDate: string;
    endDate: string;
    status: string;
  } | null;
}

/** Totals of the statement window (prompt §8 "Totals"). */
export class AccountStatementTotalsDto {
  @ApiProperty({
    description:
      'Opening balance (debit-positive). `0` without a period; otherwise the exact debit − credit of the lower-sequence periods of the same year (decision D2 — no prior-year carry-forward).',
  })
  openingBalanceAmount: string;

  @ApiProperty({
    description: 'Σ debit over the whole window (page-independent).',
  })
  debitTotalAmount: string;

  @ApiProperty({
    description: 'Σ credit over the whole window (page-independent).',
  })
  creditTotalAmount: string;

  @ApiProperty({
    description: 'Net movement = debit total − credit total (exact, signed).',
  })
  netChangeAmount: string;

  @ApiProperty({
    description: 'Closing balance = opening + net (exact, signed).',
  })
  closingBalanceAmount: string;
}

/** The complete statement envelope (prompt §8). */
export class AccountStatementResponseDto {
  @ApiProperty({ type: AccountStatementScopeDto })
  scope: AccountStatementScope;

  @ApiProperty({
    description:
      'Movement rows in the fixed statement order (documentDate, voucherNumber, lineNo, id) — one page of the window.',
  })
  movements: {
    items: AccountStatementEntry[];
    total: number;
    page: number;
    pageSize: number;
  };

  @ApiProperty({ type: AccountStatementTotalsDto })
  totals: AccountStatementTotals;

  @ApiProperty({
    description: 'Sign convention — always `debit-positive` (decision D3).',
    enum: ['debit-positive'],
  })
  signConvention: 'debit-positive';

  @ApiProperty({
    description:
      'Opening basis — always `intra-fiscal-year` (decision D2; ADR-0031 §9).',
    enum: ['intra-fiscal-year'],
  })
  openingBasis: 'intra-fiscal-year';

  @ApiProperty({
    description:
      'Statement order — the fixed legal-book order, not selectable.',
    enum: ['documentDate,voucherNumber,lineNo,id'],
  })
  orderBasis: 'documentDate,voucherNumber,lineNo,id';
}
