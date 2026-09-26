import { Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { AccountsRepository } from '../data/accounts.repository.js';
import { AccountingDocumentsRepository } from '../data/accounting-documents.repository.js';
import { AccountingPeriodsRepository } from '../data/accounting-periods.repository.js';
import { FinancialAreasRepository } from '../data/financial-areas.repository.js';
import { FiscalYearsRepository } from '../data/fiscal-years.repository.js';
import {
  evaluatePostingReadiness,
  type PostingReadiness,
  type PostingReadinessAccount,
} from '../domain/posting-readiness.js';

/**
 * Posting readiness — the internal application seam the future Posting
 * Engine consumes (Task 10.5; contract §15.5/§19.3, ADR-0026).
 *
 * WHAT THIS IS
 *
 * A READ-ONLY eligibility evaluation over the stored voucher aggregate and
 * its references, delegating every rule to the pure decision table in
 * `domain/posting-readiness.ts` (which reuses `checkVoucherLines`,
 * `checkOriginEvidence` and the module's problem vocabularies — no second
 * implementation of any rule). It answers:
 *
 * ```
 * AccountingDocumentsService (compose/issue/finalize — Task 10.4)
 *        │  a FINAL voucher exists, immutable and numbered
 *        ▼
 * PostingReadinessService.evaluateReadiness(organizationId, documentId)
 *        │  ready | not_ready + machine-readable reasons
 *        ▼
 * future Posting Engine (§19.3 projections / ledger materialization)
 * ```
 *
 * WHAT IT DELIBERATELY DOES NOT DO (Task 10.5's boundary):
 * - NO posting: no ledger/balance/trial-balance write, no posted state, no
 *   posting rules (contract §19/§20 — a later task);
 * - NO HTTP endpoint and NO permission code: readiness is an in-module
 *   contract (the Posting Engine is Accounting-owned, ADR-0026 §1), so —
 *   like `requireUsableAccountInOrganization` and the other internal
 *   resolvers — it carries no authority of its own; the calling operation
 *   authorizes. AR-21 binds endpoints, and none exists here. A future HTTP
 *   surface (if the contract ever requires one) owns its permission and
 *   denial tests;
 * - NO mutation of anything: the constructor's dependencies are repositories
 *   and the organization pin only — no numbering service, no posting-
 *   operations ledger, no event bus, no logger. It cannot allocate a number,
 *   write an idempotency row or emit an event, structurally.
 *
 * ORGANIZATION ISOLATION (AC-I-01/16, ADR-0021 §4/§8, ADR-0025):
 * the evaluation is organization-qualified and answers 404 — never 403, and
 * never a readiness verdict — for a missing or foreign document, so no
 * alternate lookup path can make another organization's voucher
 * posting-ready.
 *
 * CONSISTENCY BOUNDARY (why plain reads, no locks — task 10.5 §10):
 * every fact the verdict depends on is immutable (a final voucher and its
 * lines, §15.2), frozen by reference (a referenced account's postability,
 * AC-I-11) or contractually excluded from the decision (period/year status,
 * §7.2 rule 7; account activity, §8.6 — the domain input types carry
 * neither). A `ready` verdict on a final voucher is therefore STABLE: no
 * later operation can revoke it, so an unlocked read is not a check-then-act
 * race. The future engine still owns its own effect's consistency and
 * re-validates inside its own transaction (the ADR-0022 "evaluate inside the
 * transaction" posture), reusing `data/accounting-locks.ts` unchanged — this
 * service takes no locks at all, so it can never violate or reverse the
 * module's fixed area → year → period → accounts → document order.
 */
@Injectable()
export class PostingReadinessService {
  constructor(
    private readonly documents: AccountingDocumentsRepository,
    private readonly areas: FinancialAreasRepository,
    private readonly years: FiscalYearsRepository,
    private readonly periods: AccountingPeriodsRepository,
    private readonly accounts: AccountsRepository,
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * Evaluate whether the stored voucher may be consumed by the future
   * Posting Engine. Throws only the module's uniform 404 for a missing or
   * foreign document; every other outcome is the structured verdict.
   */
  async evaluateReadiness(
    organizationId: string,
    documentId: string,
  ): Promise<PostingReadiness> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const document = await this.documents.findById(documentId);
    if (document === null || document.organizationId !== organizationId) {
      throw AppException.notFound('AccountingDocument', documentId);
    }

    // Read set, in the module's canonical order (area → year → period →
    // accounts), by the STORED ids: the decision verifies that these rows
    // are still the ones `document_date` resolves to (AC-I-02/AC-I-14),
    // instead of re-resolving and silently accepting a drift. All plain
    // reads — see the class doc for why no locks are taken.
    const area = await this.areas.findById(document.financialAreaId);
    const fiscalYear = await this.years.findById(document.fiscalYearId);
    const accountingPeriod = await this.periods.findById(
      document.accountingPeriodId,
    );
    const referencedAccounts: PostingReadinessAccount[] = [];
    for (const accountId of [
      ...new Set(document.lines.map((line) => line.accountId)),
    ].sort()) {
      const account = await this.accounts.findById(accountId);
      // A missing row stays absent: the decision table reports
      // `account_not_found` for a referenced id with no snapshot row.
      if (account !== null) {
        referencedAccounts.push(account);
      }
    }

    return evaluatePostingReadiness({
      document,
      scope: { area, fiscalYear, accountingPeriod },
      accounts: referencedAccounts,
    });
  }
}
