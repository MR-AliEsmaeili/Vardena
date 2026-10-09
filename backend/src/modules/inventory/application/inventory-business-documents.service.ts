import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  businessDateFromInstant,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import type { BusinessDateInput } from '../../../kernel/datetime/business-date-input.js';
import { NumberingService } from '../../documents/application/numbering.service.js';
import {
  InventoryBusinessDocumentsRepository,
  type DocumentLineCreate,
} from '../data/inventory-business-documents.repository.js';
import { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import type {
  DocTxClient,
  InventoryDocumentUpdate,
} from '../data/inventory-business-document-rows.js';
import { InsufficientStockError } from '../data/inventory-posting-errors.js';
import { resolveEffectivePolicy } from '../domain/negative-stock-policy.js';
import { movementSign, reversalTypeFor } from '../domain/movement-type.js';
import { subtractDecimalStrings } from '../domain/quantities.js';
import {
  INVENTORY_DOCUMENT_REFERENCE_TYPE,
  assertCancellable,
  assertDeletable,
  assertEditable,
  assertTransition,
  classifyDocumentEdit,
  deriveDocumentValuationState,
  hasLedgerEffect,
  InventoryDocumentRuleError,
  isInventoryDocumentKind,
  isInventoryDocumentStatus,
  MAX_DOCUMENT_CANCELLATION_REASON_LENGTH,
  MAX_DOCUMENT_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_REFERENCE_LENGTH,
  toInventoryDocumentDto,
  validateDocument,
  type DocumentSideEffectAssessment,
  type InventoryBusinessDocument,
  type InventoryDocumentDto,
  type InventoryDocumentKind,
  type InventoryDocumentStatus,
} from '../domain/inventory-business-document.js';
import { INVENTORY_DOCUMENT_PERMISSIONS } from '../domain/inventory-document-permissions.js';
import { documentTypeFor } from '../domain/inventory-document-types.js';
import {
  INVENTORY_DOCUMENT_CANCELLED_EVENT,
  INVENTORY_DOCUMENT_CREATED_EVENT,
  INVENTORY_DOCUMENT_FINALIZED_EVENT,
  INVENTORY_DOCUMENT_SEALED_EVENT,
  INVENTORY_DOCUMENT_UPDATED_EVENT,
  INVENTORY_DOCUMENT_VALUATION_STALE_EVENT,
} from '../domain/inventory-document.events.js';
import {
  MOVEMENT_PERMISSIONS,
  TRANSFER_PERMISSIONS,
} from '../domain/inventory-core-permissions.js';
import { VALUATION_PERMISSIONS } from '../domain/inventory-valuation-permissions.js';
import {
  isRepricingChoice,
  type RepricingChoice,
} from '../domain/backdating.js';
import { publishEvent, resolveSort } from './master-data-support.js';
import { resolveEnteredCost } from './inventory-cost-support.js';
import {
  resolveBusinessDate as resolveBusinessDateInput,
  resolveBusinessDateFilter,
  resolveEnteredToBase,
} from './inventory-posting-support.js';
import { purchaseReturnValueFromBasis } from '../domain/return-valuation.js';
import {
  addDecimalStrings,
  compareDecimalStrings,
} from '../domain/quantities.js';
import { lockMovementRow } from '../data/inventory-locks.js';
import { assertPostableItem } from './inventory-movements.service.js';
import {
  requireTransferBackdateDecision,
  translateTransferReplayError,
} from './inventory-transfers.service.js';
import { ItemsService } from './items.service.js';
import { UnitsService } from './units.service.js';
import { WarehousesService } from './warehouses.service.js';
import {
  InventoryValuationService,
  type PreparedRecalculation,
} from './inventory-valuation.service.js';
import { InventoryAccountingPostingService } from './inventory-accounting-posting.service.js';
import type { InventoryAccountingPostingOperation } from '../data/inventory-accounting-posting.repository.js';
import type { InventoryValuationRunDto } from '../domain/inventory-valuation.js';

const SORTABLE_FIELDS: Record<string, string> = {
  businessDate: 'businessDate',
  createdAt: 'createdAt',
  number: 'number',
  status: 'status',
};

// Domain-owned since C-59D (the movements service reads it too); re-exported
// here so existing import sites keep working.
export { INVENTORY_DOCUMENT_REFERENCE_TYPE } from '../domain/inventory-business-document.js';

/** `operation_key` columns are VARCHAR(128). */
const MAX_OPERATION_KEY = 128;

export interface DocumentLineInput {
  itemId: string;
  /** Entered magnitude, decimal string, in `unitId`. */
  quantity: string;
  unitId: string;
  /**
   * RETURN KINDS ONLY (C-59D OD-RET-01): the ledger fact of the originating
   * receipt (purchase return) or issue (sales return). Ignored (refused) for
   * the other kinds.
   */
  basisMovementId?: string | null | undefined;
}

export interface CreateDocumentInput {
  organizationId: string;
  kind: string;
  /**
   * C-63: the BusinessDate in its API input form — a canonical Gregorian day
   * (`YYYY-MM-DD`), a declared Jalali day (`{ calendar, value }`), or a legacy
   * ISO instant whose UTC calendar day is used. Omit to default to today's
   * business day in the organization zone.
   */
  businessDate?: BusinessDateInput | undefined;
  warehouseId?: string | null | undefined;
  sourceWarehouseId?: string | null | undefined;
  destinationWarehouseId?: string | null | undefined;
  /** Receipt only; optional valuation assignment (PDR-05). */
  cost?: string | null | undefined;
  description?: string | null | undefined;
  reference?: string | null | undefined;
  lines: DocumentLineInput[];
}

export interface UpdateDocumentInput {
  /** C-63: same input contract as {@link CreateDocumentInput.businessDate}. */
  businessDate?: BusinessDateInput | undefined;
  warehouseId?: string | null | undefined;
  sourceWarehouseId?: string | null | undefined;
  destinationWarehouseId?: string | null | undefined;
  cost?: string | null | undefined;
  description?: string | null | undefined;
  reference?: string | null | undefined;
  lines?: DocumentLineInput[] | undefined;
  /**
   * OD-54-05: an edit with a material side effect on an already-posted
   * document only proceeds when the caller explicitly acknowledges it.
   */
  acknowledgeSideEffects?: boolean | undefined;
  /** OD-VAL-11: `recalculate` | `skip`. Never defaulted. */
  repricing?: string | null | undefined;
}

export interface FinalizeDocumentInput {
  backdateConfirmed?: boolean | undefined;
  repricing?: string | null | undefined;
}

export interface CancelDocumentInput {
  reason?: string | null | undefined;
}

export interface ListDocumentsQuery {
  organizationId: string;
  kind?: string | undefined;
  status?: string | undefined;
  warehouseId?: string | undefined;
  /**
   * INCLUSIVE business-day bounds, canonical Gregorian `YYYY-MM-DD`
   * (OQ-73: the column is PostgreSQL `date`, so the filter is a true date
   * comparison — no instant arithmetic, no UTC-midnight convention).
   */
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

/** What a line resolves to once master data and conversions are applied. */
interface ResolvedLine {
  id: string;
  lineNumber: number;
  itemId: string;
  quantity: string;
  unitId: string;
  baseQuantity: string;
  baseUnitId: string;
  conversionFactor: string;
  branchId: string;
  warehouseId: string;
  allowNegative: boolean;
  /** RETURN KINDS ONLY; validated against the ledger, `null` otherwise. */
  basisMovementId: string | null;
}

/**
 * Inventory Business Documents (C-58) — application orchestration.
 *
 * This service is a BUSINESS-DOCUMENT boundary over the existing Inventory
 * capabilities, never a second implementation of them. It owns:
 * authorization, organization scope, master-data validation, the lifecycle
 * state machine, the OQ-54/ADR-0040 edit pipeline and the composition of the
 * ledger effects. It owns no stock arithmetic: every movement, balance,
 * valuation and idempotency write goes through
 * `InventoryMovementsRepository` — the one authoritative ledger
 * (ADR-0017/ADR-0022) — inside ONE caller-owned transaction (the seam PR
 * #120 opened).
 *
 * Lifecycle (`domain/inventory-business-document.ts`):
 *   draft → operational → accounting_posted → immutable, plus
 *   draft|operational → cancelled. Illegal transitions are refused; there is
 *   no generic status mutation endpoint.
 *
 * Transactional contract, per command:
 *   - **numbering is its own transactional boundary.** `NumberingService`
 *     owns a non-composable transaction, so the allocation is NOT part of
 *     the inventory transaction and does NOT roll back with it. What holds
 *     instead is the allocation-key invariant: the key is the document id,
 *     so the same document always replays the SAME number, a different
 *     finalized document always gets a different number, and a number is
 *     never silently reused. A failed finalize therefore leaves the
 *     document a draft with `number = null` and an allocation reserved for
 *     it; the retry consumes that same allocation instead of burning a
 *     second one.
 *   - **finalize**: allocate the number (above), then ONE transaction
 *     containing every movement (both legs for a transfer), every balance
 *     delta, every valuation-state write, any EXPLICITLY requested
 *     repricing, every idempotency row, and the document's own state
 *     change. Any failure rolls back all of that inventory work: the
 *     document stays a draft, no movement exists, no balance moved, no
 *     valuation run is recorded.
 *   - **edit**: load → validate → classify side effects → then ONE
 *     transaction that reverses the exact facts the document posted,
 *     re-posts the new ones, writes the header and runs the EXPLICITLY
 *     requested repricing. A rejected edit — negative stock, or a failed
 *     valuation replay — leaves the previous valid state completely intact.
 *   - **repricing**: `repricing: "recalculate"` is executed inside the
 *     command's transaction through
 *     `InventoryValuationService.recalculateWithin` (same service, same
 *     replay, caller-owned transaction), so quantities and values commit
 *     together. `repricing: "skip"` writes `valuationStale = true` and
 *     emits the stale event — never a silent default (OD-54-06/11).
 *   - **cancel**: reverses the document's own ledger facts in one
 *     transaction and marks the document `cancelled`; the number is kept and
 *     never reused, and the document stays visible (OD-54-07/08/09).
 *
 * Idempotency: finalize derives a deterministic operation key from the
 * document id, so a retry of a committed finalize replays the document
 * instead of posting twice; the per-line keys additionally make a duplicate
 * ledger effect impossible at the database level (unique
 * `(organization_id, operation_key)`). A repeated identical edit classifies
 * as `safe` — no change, no ledger write.
 *
 * Explicitly NOT here (scope boundaries): GL/COGS posting, approval
 * workflow, FIFO/LIFO, lot/serial, multi-currency. `accountingPost` records
 * the BOUNDARY (after it the document is immutable to direct edit/delete);
 * it creates no journal entry, because Inventory→Accounting posting is not
 * part of this slice.
 */
@Injectable()
export class InventoryBusinessDocumentsService {
  constructor(
    private readonly documents: InventoryBusinessDocumentsRepository,
    private readonly movements: InventoryMovementsRepository,
    private readonly conversions: UnitConversionsRepository,
    private readonly organizations: OrganizationsService,
    private readonly items: ItemsService,
    private readonly warehouses: WarehousesService,
    private readonly units: UnitsService,
    private readonly valuation: InventoryValuationService,
    private readonly numbering: NumberingService,
    private readonly authorization: AuthorizationService,
    private readonly posting: InventoryAccountingPostingService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  // ---- reads ---------------------------------------------------------------

  async listDocuments(
    query: ListDocumentsQuery,
  ): Promise<PaginatedResult<InventoryDocumentDto>> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.documents.list({
      where: {
        organizationId: query.organizationId,
        kind: parseKind(query.kind),
        status: parseStatus(query.status),
        warehouseId: query.warehouseId,
        dateFrom: resolveBusinessDateFilter('dateFrom', query.dateFrom),
        dateTo: resolveBusinessDateFilter('dateTo', query.dateTo),
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { businessDate: 'desc' },
        { createdAt: 'desc' },
      ]),
      skip,
      take,
    });
    const includeCost = await this.valuation.canViewCost();
    return toPaginatedResult(
      await Promise.all(
        items.map((document) =>
          this.toDtoWithCostAccess(document, includeCost),
        ),
      ),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getDocument(
    id: string,
    organizationId: string,
  ): Promise<InventoryDocumentDto> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    return this.toDto(await this.mustFind(id, organizationId));
  }

  // ---- create --------------------------------------------------------------

  async createDraft(input: CreateDocumentInput): Promise<InventoryDocumentDto> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.CREATE,
    ]);
    const kind = requireKind(input.kind);
    await this.organizations.requireUsableOrganization(input.organizationId);

    const businessDate = await this.resolveBusinessDate(input);
    const header = this.normalizeHeader(kind, input);
    if (header.cost !== null) {
      await this.authorization.requireAllPermissions([
        VALUATION_PERMISSIONS.ASSIGN_COST,
      ]);
    }
    const lines = await this.resolveLines({
      organizationId: input.organizationId,
      kind,
      header,
      businessDate,
      lines: input.lines,
    });
    validateDocument({
      organizationId: input.organizationId,
      kind,
      lines,
      warehouseId: header.warehouseId,
      sourceWarehouseId: header.sourceWarehouseId,
      destinationWarehouseId: header.destinationWarehouseId,
      cost: header.cost,
    });

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const document = await this.documents.createDocument({
      header: {
        id: generateId(),
        organizationId: input.organizationId,
        kind,
        businessDate,
        warehouseId: header.warehouseId,
        sourceWarehouseId: header.sourceWarehouseId,
        destinationWarehouseId: header.destinationWarehouseId,
        receiptCost: header.cost,
        status: 'draft',
        description: header.description,
        reference: header.reference,
        actorId,
        at: now,
      },
      lines: lines.map(toLineCreate),
    });
    await this.publishDocumentEvent(
      INVENTORY_DOCUMENT_CREATED_EVENT,
      document,
      [],
    );
    this.logger.log(
      'Inventory business document created',
      {
        documentId: document.id,
        organizationId: document.organizationId,
        kind: document.kind,
      },
      InventoryBusinessDocumentsService.name,
    );
    return this.toDto(document);
  }

  async deleteDraft(id: string, organizationId: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.DELETE,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const document = await this.mustFind(id, organizationId);
    rethrowDomain(() => assertDeletable(document));
    await this.documents.deleteDraft(organizationId, id);
    this.logger.log(
      'Inventory business document draft deleted',
      { documentId: id, organizationId },
      InventoryBusinessDocumentsService.name,
    );
  }

  // ---- edit (OQ-54 / ADR-0040 pipeline) ------------------------------------

  /**
   * Load → Validate → Detect side effects → Apply → Reconcile → optional
   * EXPLICIT repricing → Persist atomically.
   *
   * Editing a DRAFT touches no ledger (a draft has no movements). Editing an
   * OPERATIONAL document reconciles its effect: the exact movements the
   * document posted are reversed and the new ones posted, in ONE
   * transaction, so the balance/valuation state can never be left stale or
   * half-applied. A material change is refused until the caller
   * acknowledges it, and repricing never happens implicitly.
   */
  async updateDocument(
    id: string,
    organizationId: string,
    input: UpdateDocumentInput,
  ): Promise<InventoryDocumentDto> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.EDIT,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);

    // 1. LOAD
    const current = await this.mustFind(id, organizationId);
    rethrowDomain(() => assertEditable(current));

    // 2. VALIDATE
    const businessDate =
      input.businessDate === undefined
        ? current.businessDate
        : await this.resolveBusinessDate({
            organizationId,
            businessDate: input.businessDate,
          });
    const header = this.normalizeHeader(current.kind, {
      warehouseId:
        input.warehouseId === undefined
          ? current.warehouseId
          : input.warehouseId,
      sourceWarehouseId:
        input.sourceWarehouseId === undefined
          ? current.sourceWarehouseId
          : input.sourceWarehouseId,
      destinationWarehouseId:
        input.destinationWarehouseId === undefined
          ? current.destinationWarehouseId
          : input.destinationWarehouseId,
      cost: input.cost === undefined ? current.cost : input.cost,
      description:
        input.description === undefined
          ? current.description
          : input.description,
      reference:
        input.reference === undefined ? current.reference : input.reference,
    });
    if (header.cost !== null && header.cost !== current.cost) {
      await this.authorization.requireAllPermissions([
        VALUATION_PERMISSIONS.ASSIGN_COST,
      ]);
    }
    const lineInputs =
      input.lines ??
      current.lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unitId: line.unitId,
        basisMovementId: line.basisMovementId,
      }));
    const resolved = await this.resolveLines({
      organizationId,
      kind: current.kind,
      header,
      businessDate,
      lines: lineInputs,
      // Positional id reuse: an edit that does not change the line set must
      // keep the SAME line rows, so the ledger facts they own are never
      // orphaned by a header-only change (e.g. a description).
      existingIds: current.lines.map((line) => line.id),
    });
    validateDocument({
      organizationId,
      kind: current.kind,
      lines: resolved,
      warehouseId: header.warehouseId,
      sourceWarehouseId: header.sourceWarehouseId,
      destinationWarehouseId: header.destinationWarehouseId,
      cost: header.cost,
    });

    // 3. DETECT SIDE EFFECTS — explicit, testable, never implicit.
    const posted = hasLedgerEffect(current.status);
    const assessment = classifyDocumentEdit({
      hasPostedEffect: posted,
      before: {
        businessDate: current.businessDate,
        warehouseId: current.warehouseId,
        sourceWarehouseId: current.sourceWarehouseId,
        destinationWarehouseId: current.destinationWarehouseId,
        cost: current.cost,
        lines: current.lines,
      },
      after: {
        businessDate,
        warehouseId: header.warehouseId,
        sourceWarehouseId: header.sourceWarehouseId,
        destinationWarehouseId: header.destinationWarehouseId,
        cost: header.cost,
        lines: resolved,
      },
    });
    const repricing = parseRepricing(input.repricing);
    if (assessment.classification === 'material') {
      if (input.acknowledgeSideEffects !== true) {
        throw AppException.businessRule(
          'This edit changes an inventory effect that is already posted. Confirm it explicitly; Vardena never changes posted stock or valuation silently.',
          {
            code: 'inventory.document.side_effect_acknowledgement_required',
            documentId: current.id,
            reasons: assessment.reasons,
            requiresLedgerReconciliation:
              assessment.requiresLedgerReconciliation,
            affectsValuation: assessment.affectsValuation,
          },
        );
      }
      if (repricing === null) {
        throw AppException.businessRule(
          'Tell Vardena what to do with the existing valuation: recalculate it, or continue and keep it explicitly stale. There is no default.',
          {
            code: 'inventory.document.repricing_choice_required',
            documentId: current.id,
            reasons: assessment.reasons,
          },
        );
      }
      if (repricing === 'recalculate') {
        await this.authorization.requireAllPermissions([
          VALUATION_PERMISSIONS.RECALCULATE,
        ]);
      }
    }

    // Backdating is assessed BEFORE anything is written, exactly like a
    // direct posting: a re-post into the past is still a posting into the
    // past (OD-VAL-10/11). A TRANSFER re-post additionally requires the
    // operator's acknowledgement and the recalculation authority (C-59C);
    // its acknowledgement travels as the C-58 `acknowledgeSideEffects` flag
    // (the recorded debt in `docs/tasks/c-59c-...` §6).
    if (assessment.requiresLedgerReconciliation) {
      await this.assertPostingAllowed({
        organizationId,
        kind: current.kind,
        header,
        businessDate,
        lines: resolved,
        backdateConfirmed: input.acknowledgeSideEffects === true,
        repricing,
      });
    }

    // 4/5/6/7. APPLY + RECONCILE + REPRICE + PERSIST — one transaction.
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const editId = generateId();
    const movementIds: string[] = [];
    // The explicit repricing is PLANNED here — permissions, master data,
    // idempotency envelope and method resolution, no writes — so that the
    // transaction below contains the valuation replay itself and nothing
    // that could have been decided outside it.
    const repricingPlans =
      assessment.classification === 'material' && repricing === 'recalculate'
        ? await this.planDocumentRepricing(
            current.id,
            organizationId,
            resolved,
            { keyPrefix: `invdoc:${current.id}:e:${editId}` },
          )
        : [];
    let valuationRuns: InventoryValuationRunDto[] = [];
    // Rewriting the line rows is a line-set change, not a side effect of
    // every edit: a header-only edit must leave the rows — and therefore
    // their movement links — exactly as they are.
    const linesChanged = assessment.reasons.includes(
      'inventory.document.change.lines',
    );
    try {
      await this.documents.withTransaction(async (tx) => {
        if (assessment.requiresLedgerReconciliation) {
          await this.reverseDocumentEffect(tx, current, {
            keyPrefix: `invdoc:${current.id}:e:${editId}:rev`,
            actorId,
            at: now,
          });
        }
        if (linesChanged) {
          await this.documents.replaceLines(
            tx,
            { id: current.id, organizationId, actorId, at: now },
            resolved.map(toLineCreate),
          );
        }
        await this.documents.updateHeader(tx, current.id, {
          businessDate,
          warehouseId: header.warehouseId,
          sourceWarehouseId: header.sourceWarehouseId,
          destinationWarehouseId: header.destinationWarehouseId,
          receiptCost: header.cost,
          description: header.description,
          reference: header.reference,
          ...(assessment.classification === 'material'
            ? {
                // Same reasoning as the finalize path: when a TRANSFER's
                // effect is re-posted, the re-post itself (coupled replay or
                // incremental pair) leaves both keys consistent, so the
                // "did not reprice" flag would be a false alarm.
                valuationStale:
                  current.kind === 'transfer' &&
                  assessment.requiresLedgerReconciliation
                    ? false
                    : repricing === 'skip',
              }
            : {}),
          updatedAt: now,
          updatedBy: actorId,
        });
        if (assessment.requiresLedgerReconciliation) {
          const reposted = await this.postDocumentEffect(tx, {
            documentId: current.id,
            organizationId,
            kind: current.kind,
            header,
            businessDate,
            lines: resolved,
            keyPrefix: `invdoc:${current.id}:e:${editId}`,
            actorId,
            at: now,
            // The C-58 debt (recorded, not redesigned here): the edit endpoint
            // still carries ONE acknowledgement flag for both the side-effect
            // confirmation and the backdate confirmation.
            backdateConfirmed: input.acknowledgeSideEffects === true,
          });
          movementIds.push(...reposted);
        }
        // 6. The repricing the operator explicitly asked for, replayed on
        // the facts this very transaction just wrote. A failure here rolls
        // the reversal, the re-post and the header change back with it:
        // the command is either fully applied and repriced, or not applied
        // at all.
        valuationRuns = await this.repriceWithin(tx, repricingPlans);
      });
    } catch (error) {
      throw this.translatePostingError(error, header);
    }

    // Announced only after the commit: no subscriber may see a valuation
    // run that was rolled back.
    await this.announceRepricing(valuationRuns);

    const updated = await this.mustFind(id, organizationId);
    await this.publishDocumentEvent(
      INVENTORY_DOCUMENT_UPDATED_EVENT,
      updated,
      movementIds,
    );
    if (updated.valuationStale) {
      // OD-54-06/11: "continue without repricing" must be visible, not quiet.
      await this.publishDocumentEvent(
        INVENTORY_DOCUMENT_VALUATION_STALE_EVENT,
        updated,
        movementIds,
      );
    }
    this.logger.log(
      'Inventory business document edited',
      {
        documentId: updated.id,
        organizationId,
        classification: assessment.classification,
        reconciled: assessment.requiresLedgerReconciliation,
        repricing,
      },
      InventoryBusinessDocumentsService.name,
    );
    return this.toDto(updated);
  }

  // ---- finalize ------------------------------------------------------------

  /**
   * Post the document's operational effect: stock moves, balances advance,
   * valuation state updates (including an explicitly requested repricing)
   * and the document becomes `operational` — all of that in ONE
   * transaction, all or nothing.
   *
   * The NUMBER is the documented exception: it is allocated first, in the
   * Numbering authority's own transaction, and does not roll back with the
   * inventory work. Because the allocation key is the document id, a retry
   * replays the same number rather than consuming a new one.
   */
  async finalizeDocument(
    id: string,
    organizationId: string,
    input: FinalizeDocumentInput,
  ): Promise<InventoryDocumentDto> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.FINALIZE,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const current = await this.mustFind(id, organizationId);
    const operationKey = finalizeKey(current.id);

    // Idempotent replay: the committed finalize already carries this key AND
    // its ledger effect still stands. A CANCELLED document also carries the
    // key — cancellation keeps it for audit — but its effect was reversed, so
    // re-finalizing it is an illegal transition, never a replay. Gating on
    // `hasLedgerEffect` keeps the retry safe without turning
    // `cancelled → operational` into a silent success.
    if (
      hasLedgerEffect(current.status) &&
      current.operationKey === operationKey
    ) {
      return this.toDto(current);
    }
    rethrowDomain(() => assertTransition(current.status, 'operational'));

    // The ledger authority is checked in addition to the document
    // authority: finalizing creates real movement facts.
    await this.authorization.requireAllPermissions([
      current.kind === 'transfer'
        ? TRANSFER_PERMISSIONS.CREATE
        : MOVEMENT_PERMISSIONS.CREATE,
    ]);
    await this.organizations.requireUsableOrganization(organizationId);

    const header = {
      warehouseId: current.warehouseId,
      sourceWarehouseId: current.sourceWarehouseId,
      destinationWarehouseId: current.destinationWarehouseId,
      cost: current.cost,
      description: current.description,
      reference: current.reference,
    };
    // Re-resolve every reference and conversion at finalize time: master
    // data may have been disabled, or a conversion version may have changed,
    // since the draft was typed. The stored basis movement id travels with
    // the line (C-59D OD-RET-01): without it a finalized return would post
    // basis-less — unvalued instead of mirrored from its receipt, and the
    // over-return bound gone (the correction sprint's axis-3 finding).
    const resolved = await this.resolveLines({
      organizationId,
      kind: current.kind,
      header,
      businessDate: current.businessDate,
      lines: current.lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unitId: line.unitId,
        basisMovementId: line.basisMovementId,
      })),
      existingIds: current.lines.map((line) => line.id),
    });
    validateDocument({
      organizationId,
      kind: current.kind,
      lines: resolved,
      warehouseId: header.warehouseId,
      sourceWarehouseId: header.sourceWarehouseId,
      destinationWarehouseId: header.destinationWarehouseId,
      cost: header.cost,
    });
    const repricing = parseRepricing(input.repricing);
    const backdating = await this.assertPostingAllowed({
      organizationId,
      kind: current.kind,
      header,
      businessDate: current.businessDate,
      lines: resolved,
      backdateConfirmed: input.backdateConfirmed === true,
      repricing,
    });

    // The number is allocated BEFORE the transaction, in its own
    // (non-composable) Documents Foundation transaction — the same accepted
    // gap every other consumer has. `allocationKey` is the document id, so a
    // retry replays the SAME serial instead of burning a second one.
    const allocation = await this.numbering.allocateNumber({
      organizationId,
      documentType: documentTypeFor(current.kind),
      allocationKey: current.id,
      referenceModule: 'inventory',
      referenceDocumentType: documentTypeFor(current.kind),
      referenceDocumentId: current.id,
    });

    // Planned before the transaction, executed inside it (see
    // `planDocumentRepricing`). A TRANSFER needs no separate repricing plan
    // (C-59C): the coupled two-key replay inside `postTransfer` already
    // restates both of its keys from the transfer's date, so an extra
    // recalculation would repeat the same work and add a second run row for
    // the same command.
    const repricingPlans =
      current.kind !== 'transfer' &&
      backdating.backdated &&
      repricing === 'recalculate'
        ? await this.planDocumentRepricing(
            current.id,
            organizationId,
            resolved,
            { keyPrefix: operationKey },
          )
        : [];

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let movementIds: string[] = [];
    let valuationRuns: InventoryValuationRunDto[] = [];
    try {
      await this.documents.withTransaction(async (tx) => {
        movementIds = await this.postDocumentEffect(tx, {
          documentId: current.id,
          organizationId,
          kind: current.kind,
          header,
          businessDate: current.businessDate,
          lines: resolved,
          keyPrefix: operationKey,
          actorId,
          at: now,
          backdateConfirmed: input.backdateConfirmed === true,
        });
        await this.documents.updateHeader(tx, current.id, {
          status: 'operational',
          number: allocation.number,
          operationKey,
          // A transfer is never left stale by a successful backdated
          // finalize: the coupled replay restated both keys, and the transfer
          // pair has no repricing choice to skip (OD-TRF-05).
          valuationStale:
            current.kind === 'transfer'
              ? false
              : backdating.backdated && repricing !== 'recalculate',
          finalizedAt: now,
          finalizedBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        });
        // Explicit repricing runs on the movements written above, in the
        // SAME transaction: a failed replay rolls the posting back and the
        // document stays a draft.
        valuationRuns = await this.repriceWithin(tx, repricingPlans);
      });
    } catch (error) {
      throw this.translatePostingError(error, header);
    }

    await this.announceRepricing(valuationRuns);

    const finalized = await this.mustFind(id, organizationId);
    await this.publishDocumentEvent(
      INVENTORY_DOCUMENT_FINALIZED_EVENT,
      finalized,
      movementIds,
    );
    if (finalized.valuationStale) {
      await this.publishDocumentEvent(
        INVENTORY_DOCUMENT_VALUATION_STALE_EVENT,
        finalized,
        movementIds,
      );
    }
    this.logger.log(
      'Inventory business document finalized',
      {
        documentId: finalized.id,
        organizationId,
        kind: finalized.kind,
        number: finalized.number,
        movements: movementIds.length,
      },
      InventoryBusinessDocumentsService.name,
    );
    return this.toDto(finalized);
  }

  // ---- accounting boundary --------------------------------------------------

  /**
   * Cross the Accounting Post boundary (OD-54-01/02, now C-62).
   *
   * PRE-C-62 THIS COMMAND ONLY SET A FLAG. It recorded the boundary on the
   * Inventory document and created no Accounting effect at all — that was the
   * gap C-62 closes. It now delegates to `InventoryAccountingPostingService`,
   * which owns the whole operation: eligibility under the document and
   * valuation locks, the durable intent, the synchronous application-service
   * call to Accounting, and the Accounting-owned answer that decides the
   * document's standing.
   *
   * WHAT THIS COMMAND STILL GUARANTEES
   * ----------------------------------
   *   * Inventory never selects an account and never writes an Accounting row
   *     (PO-02, AR-07);
   *   * the document only becomes Accounting Posted when Accounting reported
   *     a FINAL voucher — never on a draft, never on a refusal (C62-OD-02);
   *   * the same operation key replays the same answer instead of creating a
   *     second voucher (C62-OD-06);
   *   * the operation is NOT one shared transaction: OD-01's feasibility gate
   *     failed, so this is the durable two-phase fallback and must never be
   *     described as atomic (see `inventory-accounting-posting.service.ts`).
   */
  async accountingPostDocument(
    id: string,
    organizationId: string,
    input: {
      operationKey?: string | undefined;
      expectedDocumentRevision?: string | undefined;
    } = {},
  ): Promise<InventoryDocumentDto> {
    const outcome = await this.posting.requestAccountingPosting(
      id,
      organizationId,
      input,
    );
    const updated = await this.mustFind(id, organizationId);
    this.logger.log(
      'Inventory business document accounting posting requested',
      {
        documentId: id,
        organizationId,
        action: outcome.action,
        operationKey: outcome.operationKey,
        postingMode: outcome.postingMode,
        outcome: outcome.outcome,
        accountingPostingState: outcome.state,
        accountingDocumentId: outcome.accountingDocumentId,
        glPosted: outcome.glPosted,
        refusalCode: outcome.refusalCode,
        replayed: outcome.replayed,
      },
      InventoryBusinessDocumentsService.name,
    );
    return this.toDto(updated);
  }

  /**
   * The durable C-62 posting trail of one document, newest first.
   *
   * Read-only and deliberately separate from the document read: the document
   * states where it STANDS, the operation states what HAPPENED, and the two
   * are not the same thing — a refusal leaves the document standing exactly
   * where it was. An operator (and an auditor) needs both, so the trail is
   * readable on its own instead of being inferred from the document.
   */
  async listAccountingPostings(
    id: string,
    organizationId: string,
  ): Promise<readonly InventoryAccountingPostingOperation[]> {
    return this.posting.listAccountingPostings(id, organizationId);
  }

  /**
   * Cancel the Accounting DRAFT a posting created (C62-OD-02). Delegated for
   * the same reason as the posting itself: the draft belongs to Accounting, so
   * the request goes through the contract and the Inventory standing only
   * moves once Accounting confirms.
   */
  async cancelAccountingPosting(
    id: string,
    organizationId: string,
    input: {
      operationKey?: string | undefined;
      expectedDocumentRevision?: string | undefined;
    } = {},
  ): Promise<InventoryDocumentDto> {
    const outcome = await this.posting.cancelAccountingPosting(
      id,
      organizationId,
      input,
    );
    const updated = await this.mustFind(id, organizationId);
    this.logger.log(
      'Inventory business document accounting posting cancellation requested',
      {
        documentId: id,
        organizationId,
        action: outcome.action,
        operationKey: outcome.operationKey,
        accountingPostingState: outcome.state,
        refusalCode: outcome.refusalCode,
      },
      InventoryBusinessDocumentsService.name,
    );
    return this.toDto(updated);
  }

  /** Terminal seal: after this the document accepts nothing at all. */
  async sealDocument(
    id: string,
    organizationId: string,
  ): Promise<InventoryDocumentDto> {
    return this.applyLifecycleOnly(id, organizationId, {
      permission: INVENTORY_DOCUMENT_PERMISSIONS.SEAL,
      target: 'immutable',
      event: INVENTORY_DOCUMENT_SEALED_EVENT,
      stamp: (now, actorId) => ({ sealedAt: now, sealedBy: actorId }),
    });
  }

  // ---- cancellation ---------------------------------------------------------

  /**
   * Cancel before Accounting Post (OQ-54). A draft cancels with no ledger
   * effect; an operational document has its own movements reversed in ONE
   * transaction. The number is kept (never reused) and the document stays
   * visible and auditable.
   */
  async cancelDocument(
    id: string,
    organizationId: string,
    input: CancelDocumentInput,
  ): Promise<InventoryDocumentDto> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.CANCEL,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const current = await this.mustFind(id, organizationId);
    rethrowDomain(() => assertCancellable(current));
    const reason = normalizeText(
      input.reason,
      MAX_DOCUMENT_CANCELLATION_REASON_LENGTH,
      'reason',
    );
    const reversing = hasLedgerEffect(current.status);
    if (reversing) {
      await this.authorization.requireAllPermissions([
        MOVEMENT_PERMISSIONS.REVERSE,
      ]);
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const movementIds: string[] = [];
    try {
      await this.documents.withTransaction(async (tx) => {
        if (reversing) {
          movementIds.push(
            ...(await this.reverseDocumentEffect(tx, current, {
              keyPrefix: `invdoc:${current.id}:cancel`,
              actorId,
              at: now,
            })),
          );
        }
        await this.documents.updateHeader(tx, current.id, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: actorId,
          cancellationReason: reason,
          updatedAt: now,
          updatedBy: actorId,
        });
      });
    } catch (error) {
      throw this.translatePostingError(error, {
        warehouseId: current.warehouseId,
        sourceWarehouseId: current.sourceWarehouseId,
      });
    }

    const cancelled = await this.mustFind(id, organizationId);
    await this.publishDocumentEvent(
      INVENTORY_DOCUMENT_CANCELLED_EVENT,
      cancelled,
      movementIds,
    );
    this.logger.log(
      'Inventory business document cancelled',
      {
        documentId: cancelled.id,
        organizationId,
        reversedMovements: movementIds.length,
      },
      InventoryBusinessDocumentsService.name,
    );
    return this.toDto(cancelled);
  }

  // ---- internals ------------------------------------------------------------

  private async mustFind(
    id: string,
    organizationId: string,
  ): Promise<InventoryBusinessDocument> {
    const document = await this.documents.findById(organizationId, id);
    if (document === null) {
      // 404, never 403: the API must not confirm that an id belonging to
      // another organization exists (ADR-0021 §4).
      throw AppException.notFound('Inventory document', id);
    }
    return document;
  }

  private async toDto(
    document: InventoryBusinessDocument,
  ): Promise<InventoryDocumentDto> {
    return this.toDtoWithCostAccess(
      document,
      await this.valuation.canViewCost(),
    );
  }

  private async toDtoWithCostAccess(
    document: InventoryBusinessDocument,
    includeCost: boolean,
  ): Promise<InventoryDocumentDto> {
    // C-63: the organization's date/time policy is read ONCE per response and
    // handed to the mapper, which derives the Gregorian+Jalali renderings of
    // this document's business date and event timestamps from it.
    const dateTimeSettings = await this.organizations.getDateTimeSettings(
      document.organizationId,
    );
    const movementIds = document.lines.flatMap((line) =>
      [line.movementId, line.outMovementId, line.inMovementId].filter(
        (id): id is string => id !== null,
      ),
    );
    if (movementIds.length === 0) {
      return toInventoryDocumentDto(document, includeCost, {
        dateTimeSettings,
      });
    }
    const movements = await this.movements.findIds(movementIds);
    // Missing/cross-organization facts are never interpreted as priced.
    const complete =
      movements.length === movementIds.length &&
      movements.every(
        (movement) => movement.organizationId === document.organizationId,
      );
    const valuationState = deriveDocumentValuationState(
      complete ? movements.map((movement) => movement.valuationStatus) : [],
    );
    return toInventoryDocumentDto(document, includeCost, {
      dateTimeSettings,
      movementValuationState: valuationState,
    });
  }

  /**
   * Resolve the document's canonical `business_date` (C-63 / OQ-73).
   *
   * Gregorian and declared Jalali inputs become one canonical Gregorian
   * BusinessDate. Legacy ISO instants resolve to their UTC calendar day per
   * the owner-confirmed OQ-73 policy. Only an omitted date uses the
   * organization's configured zone to choose today's business day.
   */
  private async resolveBusinessDate(input: {
    organizationId: string;
    businessDate?: BusinessDateInput | undefined;
  }): Promise<BusinessDate> {
    const { timeZone } = await this.organizations.getDateTimeSettings(
      input.organizationId,
    );
    return resolveBusinessDateInput({
      field: 'businessDate',
      value: input.businessDate,
      timeZone,
    });
  }

  private normalizeHeader(
    kind: InventoryDocumentKind,
    input: {
      warehouseId?: string | null | undefined;
      sourceWarehouseId?: string | null | undefined;
      destinationWarehouseId?: string | null | undefined;
      cost?: string | null | undefined;
      description?: string | null | undefined;
      reference?: string | null | undefined;
    },
  ): {
    warehouseId: string | null;
    sourceWarehouseId: string | null;
    destinationWarehouseId: string | null;
    cost: string | null;
    description: string | null;
    reference: string | null;
  } {
    const cost = emptyToNull(input.cost);
    // C-59D: a sales return MAY carry an explicit amount — but only as a
    // Manual Price with a basis on the original issue (OD-RET-06; the basis
    // requirement itself is enforced by `validateDocument`, which sees the
    // lines). A purchase return NEVER carries a commercial amount: its exit
    // value is the basis receipt's own cost or the current average, and an
    // invoice price would silently leak commercial value into inventory
    // (OD-RET-04).
    if (kind !== 'receipt' && kind !== 'sales_return' && cost !== null) {
      // The issue's manual-cost refusal, stated at the boundary rather than
      // silently dropped (PDR-05 rule 5).
      throw AppException.validation([
        {
          field: 'cost',
          message:
            kind === 'purchase_return'
              ? 'A purchase return never carries a commercial amount. Its value is the original receipt cost (with a basis) or the current inventory cost (without one).'
              : 'Only a receipt (or a basis-linked sales return) may carry a cost. Issue cost is derived by Inventory valuation, and a transfer is value-neutral.',
          code: 'costNotAcceptedForDocumentKind',
        },
      ]);
    }
    return {
      warehouseId: kind === 'transfer' ? null : emptyToNull(input.warehouseId),
      sourceWarehouseId:
        kind === 'transfer' ? emptyToNull(input.sourceWarehouseId) : null,
      destinationWarehouseId:
        kind === 'transfer' ? emptyToNull(input.destinationWarehouseId) : null,
      cost,
      description: normalizeText(
        input.description,
        MAX_DOCUMENT_DESCRIPTION_LENGTH,
        'description',
      ),
      reference: normalizeText(
        input.reference,
        MAX_DOCUMENT_REFERENCE_LENGTH,
        'reference',
      ),
    };
  }

  /**
   * Validate every master-data reference and resolve entered → base
   * quantities against the conversion in force at the business date
   * (D-21/D-26). Fails closed on a non-stockable or lot/serial/expiry-tracked
   * item, exactly like a direct posting.
   */
  private async resolveLines(params: {
    organizationId: string;
    kind: InventoryDocumentKind;
    header: {
      warehouseId: string | null;
      sourceWarehouseId: string | null;
      destinationWarehouseId: string | null;
    };
    businessDate: BusinessDate;
    lines: DocumentLineInput[];
    existingIds?: string[] | undefined;
  }): Promise<ResolvedLine[]> {
    if (params.lines.length === 0) {
      throw AppException.badRequest('A document requires at least one line.');
    }
    const effectiveWarehouseId =
      params.kind === 'transfer'
        ? params.header.sourceWarehouseId
        : params.header.warehouseId;
    if (effectiveWarehouseId === null) {
      throw AppException.badRequest(
        params.kind === 'transfer'
          ? 'A transfer requires a source and a destination warehouse.'
          : 'A receipt or issue requires a warehouse.',
      );
    }
    if (params.kind === 'transfer') {
      if (params.header.destinationWarehouseId === null) {
        throw AppException.badRequest(
          'A transfer requires a source and a destination warehouse.',
        );
      }
      if (
        params.header.sourceWarehouseId === params.header.destinationWarehouseId
      ) {
        throw AppException.badRequest(
          'A transfer needs two different warehouses.',
        );
      }
      await this.warehouses.requireUsableWarehouseInOrganization(
        params.header.destinationWarehouseId,
        params.organizationId,
      );
    }
    const warehouse =
      await this.warehouses.requireUsableWarehouseInOrganization(
        effectiveWarehouseId,
        params.organizationId,
      );

    const resolved: ResolvedLine[] = [];
    let lineNumber = 0;
    for (const line of params.lines) {
      lineNumber += 1;
      const item = await this.items.requireUsableItemInOrganization(
        line.itemId,
        params.organizationId,
      );
      await this.units.requireUsableUnitInOrganization(
        line.unitId,
        params.organizationId,
      );
      assertPostableItem(item.code, {
        isStockable: item.isStockable,
        requiresLot: item.requiresLot,
        requiresSerial: item.requiresSerial,
        requiresExpiry: item.requiresExpiry,
      });
      const quantity = await resolveEnteredToBase({
        conversions: this.conversions,
        organizationId: params.organizationId,
        itemId: item.id,
        baseUnitId: item.baseUnitId,
        unitId: line.unitId,
        quantity: line.quantity,
        asOf: params.businessDate,
      });
      const basisMovementId = await this.resolveBasis({
        organizationId: params.organizationId,
        kind: params.kind,
        itemId: item.id,
        line,
      });
      resolved.push({
        id: params.existingIds?.[lineNumber - 1] ?? generateId(),
        lineNumber,
        itemId: item.id,
        quantity: quantity.quantity,
        unitId: line.unitId,
        baseQuantity: quantity.baseQuantity,
        baseUnitId: item.baseUnitId,
        conversionFactor: quantity.conversionFactor,
        branchId: warehouse.branchId,
        warehouseId: effectiveWarehouseId,
        allowNegative: resolveEffectivePolicy({
          itemAllow: item.allowNegativeStock,
          warehouseAllow: warehouse.allowNegativeStock,
        }),
        basisMovementId,
      });
    }
    return resolved;
  }

  /**
   * Validate and normalize one line's return basis (C-59D OD-RET-01/02/06).
   *
   * A basis is only meaningful on a return: a purchase return bases itself
   * on the originating RECEIPT movement (an `inbound`), a sales return on
   * the originating ISSUE movement (an `outbound`). Both must be the SAME
   * organization's and the SAME item's fact — a basis on a different item is
   * not evidence of anything about this line's value. The basis movement's
   * VALUE is deliberately NOT read here: it is re-read under that row's
   * lock at finalize time (see `postDocumentEffect`), where the over-return
   * guard and the pro-rata share are computed from the committed truth.
   *
   * Returns `null` for a basis-less line and for every non-return kind.
   */
  private async resolveBasis(params: {
    organizationId: string;
    kind: InventoryDocumentKind;
    itemId: string;
    line: DocumentLineInput;
  }): Promise<string | null> {
    const raw = params.line.basisMovementId?.trim() ?? '';
    if (raw === '') return null;
    if (params.kind !== 'purchase_return' && params.kind !== 'sales_return') {
      throw AppException.validation([
        {
          field: 'basisMovementId',
          message:
            'Only a purchase return or a sales return may be based on an originating movement.',
          code: 'basisNotAcceptedForDocumentKind',
        },
      ]);
    }
    const basis = await this.movements.findById(raw);
    if (basis === null || basis.organizationId !== params.organizationId) {
      throw AppException.validation([
        {
          field: 'basisMovementId',
          message: `The basis movement "${raw}" does not exist in this organization.`,
          code: 'basisMovementNotFound',
        },
      ]);
    }
    if (basis.itemId !== params.itemId) {
      throw AppException.validation([
        {
          field: 'basisMovementId',
          message:
            'The basis movement belongs to a different item. A return basis must be the same item\u2019s originating movement.',
          code: 'basisItemMismatch',
        },
      ]);
    }
    const requiredType =
      params.kind === 'purchase_return' ? 'inbound' : 'outbound';
    if (basis.movementType !== requiredType) {
      throw AppException.validation([
        {
          field: 'basisMovementId',
          message:
            params.kind === 'purchase_return'
              ? 'A purchase return must be based on the originating RECEIPT movement (an inbound).'
              : 'A sales return must be based on the originating ISSUE movement (an outbound).',
          code: 'basisMovementTypeMismatch',
        },
      ]);
    }
    return basis.id;
  }

  /**
   * Everything that must be TRUE before any ledger write: the backdating
   * decisions for a receipt/issue (OD-VAL-10/11) and, for a transfer, the
   * operator's acknowledgement of the backdating plus the valuation authority
   * the coupled two-key replay needs (C-59C, OD-TRF-01…09). Runs entirely
   * before the transaction so the user sees the refusal instead of a
   * rollback.
   */
  private async assertPostingAllowed(params: {
    organizationId: string;
    kind: InventoryDocumentKind;
    header: {
      warehouseId: string | null;
      sourceWarehouseId: string | null;
      destinationWarehouseId: string | null;
      /** The receipt's cost / the basis-linked sales return's amount. */
      cost: string | null;
    };
    businessDate: BusinessDate;
    lines: ResolvedLine[];
    backdateConfirmed: boolean;
    repricing: RepricingChoice | null;
  }): Promise<{ backdated: boolean }> {
    if (params.kind === 'transfer') {
      const source = params.header.sourceWarehouseId as string;
      const destination = params.header.destinationWarehouseId as string;
      let backdated = false;
      for (const line of params.lines) {
        const [sourceImpact, destinationImpact] = await Promise.all([
          this.valuation.assessBackdateImpact({
            organizationId: params.organizationId,
            warehouseId: source,
            itemId: line.itemId,
            movementDate: params.businessDate,
          }),
          this.valuation.assessBackdateImpact({
            organizationId: params.organizationId,
            warehouseId: destination,
            itemId: line.itemId,
            movementDate: params.businessDate,
          }),
        ]);
        // C-59C: a backdated transfer is SUPPORTED (the coupled two-key replay
        // values the pair from the source position at the transfer date), but
        // it still needs the operator's acknowledgement and — because the
        // replay restates both keys from that date onward — the valuation
        // authority to do it.
        backdated =
          requireTransferBackdateDecision({
            movementDate: params.businessDate,
            sourceWarehouseId: source,
            destinationWarehouseId: destination,
            source: sourceImpact,
            destination: destinationImpact,
            confirmed: params.backdateConfirmed,
          }) || backdated;
      }
      if (backdated) {
        await this.authorization.requireAllPermissions([
          VALUATION_PERMISSIONS.RECALCULATE,
        ]);
      }
      return { backdated };
    }

    let backdated = false;
    for (const line of params.lines) {
      const latestMovementDate = await this.movements.maxMovementDate(
        params.organizationId,
        line.warehouseId,
        line.itemId,
      );
      const decision = await this.valuation.requireBackdateDecisions({
        organizationId: params.organizationId,
        warehouseId: line.warehouseId,
        itemId: line.itemId,
        movementDate: params.businessDate,
        latestMovementDate,
        backdateConfirmed: params.backdateConfirmed,
        repricing: params.repricing,
      });
      backdated = backdated || decision.backdated;
    }
    if (backdated && params.repricing === 'recalculate') {
      await this.authorization.requireAllPermissions([
        VALUATION_PERMISSIONS.RECALCULATE,
      ]);
    }
    // C-59D OD-RET-07 (the sales-return half): a sales return with NO
    // manual amount is valued at the key's CURRENT average. With no valued
    // stock there is no average to use, and Vardena never invents one and
    // never books the goods at zero — the document layer refuses up front.
    // The pre-check is UX: the real backstop is the valuation strategy,
    // which degrades to `unvalued(insufficient_valued_quantity)` if the
    // pool empties between here and the locked write.
    if (params.kind === 'sales_return' && params.header.cost === null) {
      for (const line of params.lines) {
        const state = await this.valuation.findValuationState({
          organizationId: params.organizationId,
          warehouseId: line.warehouseId,
          itemId: line.itemId,
        });
        if (
          state === null ||
          compareDecimalStrings(state.valuedQuantity, '0') <= 0
        ) {
          throw AppException.businessRule(
            'This item has no valued stock in the warehouse, so a sales return cannot be valued at the current inventory cost. Receive and price stock first, or supply an explicit amount based on the original issue.',
            {
              code: 'inventory.document.sales_return_cold_start',
              warehouseId: line.warehouseId,
              itemId: line.itemId,
            },
          );
        }
      }
    }
    return { backdated };
  }

  /**
   * Post the document's whole ledger effect inside the caller's transaction
   * and point each line at the facts it now owns.
   *
   * Receipt → one `inbound` movement per line. Issue → one `outbound`.
   * Transfer → the authoritative two-leg atomic pair per line
   * (`InventoryMovementsRepository.postTransfer`); no second transfer
   * implementation exists.
   */
  private async postDocumentEffect(
    tx: DocTxClient,
    params: {
      documentId: string;
      organizationId: string;
      kind: InventoryDocumentKind;
      header: {
        warehouseId: string | null;
        sourceWarehouseId: string | null;
        destinationWarehouseId: string | null;
        cost: string | null;
      };
      businessDate: BusinessDate;
      lines: ResolvedLine[];
      keyPrefix: string;
      actorId: string | null;
      at: Date;
      /**
       * The caller's OD-VAL-10 answer for a backdated document, threaded to
       * the ledger write: the repository re-derives backdating from the locked
       * rows and refuses an unconfirmed transfer rather than repricing it
       * silently (C-59C).
       */
      backdateConfirmed: boolean;
    },
  ): Promise<string[]> {
    const created: string[] = [];
    const { timeZone } = await this.organizations.getDateTimeSettings(
      params.organizationId,
    );
    const postingBusinessDate = businessDateFromInstant(params.at, timeZone);
    const reference = {
      referenceType: INVENTORY_DOCUMENT_REFERENCE_TYPE,
      referenceId: params.documentId,
    };
    const cost = params.header.cost;
    if (cost !== null && params.lines.length > 1) {
      // Apportioning ONE amount across several lines needs an approved
      // rounding/allocation rule; Vardena never invents one (same
      // fail-closed stance as OQ-29 fractional conversions). Applies to a
      // receipt's cost AND a sales return's manual amount alike.
      throw AppException.businessRule(
        'An entered cost can only be assigned to a single-line document. Splitting one amount across several lines requires an apportionment rule Vardena does not define.',
        {
          code: 'inventory.document.cost_apportionment_unsupported',
          lines: params.lines.length,
        },
      );
    }

    // C-59D: lock every DISTINCT basis movement row this document returns
    // against, in ascending id order (one deterministic multi-row order),
    // BEFORE any balance or valuation state lock is taken. The lock is what
    // makes the over-return guard and the pro-rated basis value read
    // committed truth: a concurrent return against the same receipt cannot
    // interleave between this document's guard and its post. It is the same
    // lock discipline the reversal path already established (the original
    // movement row first, then the key rows).
    const basisIds = [
      ...new Set(
        params.lines
          .map((line) => line.basisMovementId)
          .filter((id): id is string => id !== null),
      ),
    ].sort((left, right) => left.localeCompare(right));
    const basisRows = new Map<
      string,
      { totalCost: string | null; baseQuantity: string }
    >();
    for (const basisId of basisIds) {
      const locked = await lockMovementRow(tx, basisId);
      if (locked === null) {
        throw AppException.businessRule(
          `The return basis movement "${basisId}" no longer exists. The document cannot be posted against it.`,
          { code: 'inventory.return.basis_missing', basisMovementId: basisId },
        );
      }
      basisRows.set(basisId, {
        totalCost: locked.totalCost,
        baseQuantity: locked.baseQuantity,
      });
    }

    // The aggregate over-return guard (OD-RET-03): each line's return is
    // bounded by its basis, but so is the SUM of every committed return
    // against the same basis. Committed = a document whose ledger effect
    // stands (operational or beyond, this document excluded — its own lines
    // are counted from `params.lines` directly).
    const basisCommitted = new Map<string, string>();
    for (const basisId of basisIds) {
      const linked = await this.documents.listBasisLinkedLines(
        tx,
        params.organizationId,
        basisId,
      );
      let committed = '0';
      for (const line of linked) {
        if (line.documentId === params.documentId) continue;
        if (
          line.documentStatus !== 'operational' &&
          line.documentStatus !== 'accounting_posted' &&
          line.documentStatus !== 'immutable'
        ) {
          continue;
        }
        committed = addDecimalStrings(committed, line.baseQuantity);
      }
      for (const line of params.lines) {
        if (line.basisMovementId === basisId) {
          committed = addDecimalStrings(committed, line.baseQuantity);
        }
      }
      basisCommitted.set(basisId, committed);
    }

    for (const line of params.lines) {
      const method = await this.valuation.resolveMethodForPosting({
        organizationId: params.organizationId,
        itemId: line.itemId,
        asOf: params.businessDate,
      });
      const operationKey = boundedKey(`${params.keyPrefix}:${line.lineNumber}`);
      if (params.kind === 'transfer') {
        const destinationWarehouseId = params.header
          .destinationWarehouseId as string;
        const destination =
          await this.warehouses.requireUsableWarehouseInOrganization(
            destinationWarehouseId,
            params.organizationId,
          );
        const transferId = generateId();
        const outLegId = generateId();
        const inLegId = generateId();
        const leg = {
          organizationId: params.organizationId,
          itemId: line.itemId,
          quantity: line.quantity,
          unitId: line.unitId,
          baseUnitId: line.baseUnitId,
          conversionFactor: line.conversionFactor,
          movementDate: params.businessDate,
          transferId,
          reversalOfMovementId: null,
          ...reference,
          reason: null,
          operationKey,
          createdAt: params.at,
          updatedAt: params.at,
          createdBy: params.actorId,
        };
        await this.movements.postTransfer(
          {
            outLeg: {
              ...leg,
              id: outLegId,
              branchId: line.branchId,
              warehouseId: line.warehouseId,
              movementType: 'transfer_out',
              baseQuantity: `-${line.baseQuantity}`,
            },
            inLeg: {
              ...leg,
              id: inLegId,
              branchId: destination.branchId,
              warehouseId: destinationWarehouseId,
              movementType: 'transfer_in',
              baseQuantity: line.baseQuantity,
            },
            operation: {
              id: generateId(),
              organizationId: params.organizationId,
              operationKey,
              operation: 'transfer_post',
              requestHash: documentRequestHash(params.documentId, operationKey),
              result: { kind: 'transfer', movementIds: [outLegId, inLegId] },
              createdAt: params.at,
              updatedAt: params.at,
              createdBy: params.actorId,
            },
            sourceAllowNegative: line.allowNegative,
            actorId: params.actorId,
            valuationMethod: method.method,
            backdateConfirmed: params.backdateConfirmed,
          },
          tx,
        );
        await this.documents.setLineMovements(
          tx,
          line.id,
          { movementId: null, outMovementId: outLegId, inMovementId: inLegId },
          { at: params.at, actorId: params.actorId },
        );
        created.push(outLegId, inLegId);
        continue;
      }

      const movementType = movementTypeForKind(params.kind);
      const enteredCost =
        params.kind === 'receipt' || params.kind === 'sales_return'
          ? resolveEnteredCost({
              input: { totalCost: cost },
              movementType,
              quantity: line.quantity,
            })
          : null;
      // C-59D: the return's own value decision, made per line from the
      // LOCKED basis row (see the basis lock block above).
      const basis =
        line.basisMovementId === null
          ? null
          : (basisRows.get(line.basisMovementId) ?? null);
      if (line.basisMovementId !== null && basis === null) {
        throw AppException.businessRule(
          `The return basis movement "${line.basisMovementId}" is not part of this document\u2019s basis set.`,
          {
            code: 'inventory.return.basis_missing',
            basisMovementId: line.basisMovementId,
          },
        );
      }
      if (params.kind === 'sales_return' && enteredCost !== null) {
        // OD-RET-06: an explicit sales-return amount is a Manual Price and
        // is ONLY valid on a basis-linked line. `validateDocument` guards
        // the draft; this re-asserts the invariant at the ledger boundary.
        if (line.basisMovementId === null) {
          throw AppException.businessRule(
            'A sales return may only carry an explicit amount on a line based on the original issue. Without a basis the return is valued at the current inventory cost.',
            {
              code: 'inventory.document.sales_return_amount_requires_basis',
              lineNumber: line.lineNumber,
            },
          );
        }
      }
      let knownValue: string | null = enteredCost;
      let knownValueSource: 'entered' | 'return_basis' | undefined =
        enteredCost === null ? undefined : 'entered';
      let forceUnvalued = false;
      if (params.kind === 'purchase_return' && basis !== null) {
        // OD-RET-02/03/04: a basis-linked purchase return leaves at the
        // ORIGINAL receipt's own cost, pro-rated exactly, never at the
        // current average and never at a commercial price. The committed
        // over-return guard runs against the same locked row.
        const basisBase = magnitude(basis.baseQuantity);
        const committed = basisCommitted.get(line.basisMovementId as string);
        if (
          committed !== undefined &&
          compareDecimalStrings(committed, basisBase) > 0
        ) {
          throw AppException.businessRule(
            `This purchase return would return more than the receipt it is based on: committed ${committed} of ${basisBase}.`,
            {
              code: 'inventory.return.over_return',
              basisMovementId: line.basisMovementId,
              committed,
              basisQuantity: basisBase,
            },
          );
        }
        if (basis.totalCost === null) {
          // The receipt was posted without a cost: the exit carries no value
          // and derives none — never zero, never the average (OD-RET-04).
          forceUnvalued = true;
          knownValue = null;
          knownValueSource = 'return_basis';
        } else {
          knownValue = purchaseReturnValueFromBasis({
            basis: {
              id: line.basisMovementId as string,
              baseQuantity: basisBase,
              totalCost: basis.totalCost,
            },
            returnedBaseQuantity: line.baseQuantity,
          });
          knownValueSource = 'return_basis';
        }
      }
      const movementId = generateId();
      await this.movements.postMovement(
        {
          movement: {
            id: movementId,
            organizationId: params.organizationId,
            branchId: line.branchId,
            warehouseId: line.warehouseId,
            itemId: line.itemId,
            movementType,
            quantity: line.quantity,
            unitId: line.unitId,
            baseQuantity:
              movementSign(movementType) < 0
                ? `-${line.baseQuantity}`
                : line.baseQuantity,
            baseUnitId: line.baseUnitId,
            conversionFactor: line.conversionFactor,
            movementDate: params.businessDate,
            transferId: null,
            reversalOfMovementId: null,
            ...reference,
            reason: null,
            operationKey,
            createdAt: params.at,
            updatedAt: params.at,
            createdBy: params.actorId,
          },
          operation: {
            id: generateId(),
            organizationId: params.organizationId,
            operationKey,
            operation: 'movement_post',
            requestHash: documentRequestHash(params.documentId, operationKey),
            result: { kind: 'movement', movementIds: [movementId] },
            createdAt: params.at,
            updatedAt: params.at,
            createdBy: params.actorId,
          },
          allowNegative: line.allowNegative,
          actorId: params.actorId,
          valuation: {
            method: method.method,
            knownValue,
            ...(knownValueSource === undefined ? {} : { knownValueSource }),
            ...(forceUnvalued ? { forceUnvalued: true } : {}),
            // Backdating was decided before the transaction; the ledger only
            // needs to know whether this fact lands in the past.
            backdated: isBefore(params.businessDate, postingBusinessDate),
          },
        },
        tx,
      );
      await this.documents.setLineMovements(
        tx,
        line.id,
        { movementId, outMovementId: null, inMovementId: null },
        { at: params.at, actorId: params.actorId },
      );
      created.push(movementId);
    }
    return created;
  }

  /**
   * Reverse exactly the facts this document posted — never "the current
   * stock", never a recomputed average. Each reversal is the ledger's own
   * mirror (`postReversal`), which reads the original's value under lock and
   * refuses a second reversal of the same movement.
   */
  private async reverseDocumentEffect(
    tx: DocTxClient,
    document: InventoryBusinessDocument,
    audit: { keyPrefix: string; actorId: string | null; at: Date },
  ): Promise<string[]> {
    const created: string[] = [];
    const { timeZone } = await this.organizations.getDateTimeSettings(
      document.organizationId,
    );
    const reversalBusinessDate = businessDateFromInstant(audit.at, timeZone);
    for (const line of document.lines) {
      const originals = [
        line.movementId,
        line.outMovementId,
        line.inMovementId,
      ].filter((value): value is string => value !== null);
      for (const originalId of originals) {
        const original = await this.movements.findById(originalId);
        if (original === null) {
          throw new Error(
            `Document "${document.id}" references a missing movement "${originalId}".`,
          );
        }
        const method = await this.valuation.resolveMethodForPosting({
          organizationId: document.organizationId,
          itemId: original.itemId,
          asOf: original.movementDate,
        });
        const item = await this.items.requireUsableItemInOrganization(
          original.itemId,
          document.organizationId,
          { allowInactive: true },
        );
        const warehouse =
          await this.warehouses.requireUsableWarehouseInOrganization(
            original.warehouseId,
            document.organizationId,
            { allowInactive: true },
          );
        const movementId = generateId();
        const operationKey = boundedKey(`${audit.keyPrefix}:${originalId}`);
        // A reversal is never dated before the fact it mirrors. Compare
        // BusinessDate values, not an instant against a day.
        const movementDate =
          reversalBusinessDate < original.movementDate
            ? original.movementDate
            : reversalBusinessDate;
        await this.movements.postReversal(
          {
            originalMovementId: originalId,
            movement: {
              id: movementId,
              organizationId: original.organizationId,
              branchId: original.branchId,
              warehouseId: original.warehouseId,
              itemId: original.itemId,
              movementType: reversalTypeFor(original.baseQuantity),
              quantity: original.quantity,
              unitId: original.enteredUnitId,
              baseQuantity: subtractDecimalStrings('0', original.baseQuantity),
              baseUnitId: original.baseUnitId,
              conversionFactor: original.conversionFactor,
              movementDate,
              transferId: null,
              reversalOfMovementId: originalId,
              referenceType: original.referenceType,
              referenceId: original.referenceId,
              reason: original.reason,
              operationKey,
              createdAt: audit.at,
              updatedAt: audit.at,
              createdBy: audit.actorId,
            },
            operation: {
              id: generateId(),
              organizationId: original.organizationId,
              operationKey,
              operation: 'movement_reversal',
              requestHash: documentRequestHash(document.id, operationKey),
              result: { kind: 'movement', movementIds: [movementId] },
              createdAt: audit.at,
              updatedAt: audit.at,
              createdBy: audit.actorId,
            },
            allowNegative: resolveEffectivePolicy({
              itemAllow: item.allowNegativeStock,
              warehouseAllow: warehouse.allowNegativeStock,
            }),
            actorId: audit.actorId,
            valuation: {
              method: method.method,
              knownValue: null,
              backdated: false,
            },
          },
          tx,
        );
        created.push(movementId);
      }
      await this.documents.setLineMovements(
        tx,
        line.id,
        { movementId: null, outMovementId: null, inMovementId: null },
        { at: audit.at, actorId: audit.actorId },
      );
    }
    return created;
  }

  /**
   * Plan the repricing the operator EXPLICITLY asked for — permissions,
   * master data, idempotency envelope and method resolution — WITHOUT
   * writing anything. Runs before the command's transaction is opened so
   * that only the replay itself happens inside it.
   *
   * One plan per distinct (warehouse, item) key: the same key touched by
   * several lines is replayed once, exactly as before.
   */
  private async planDocumentRepricing(
    documentId: string,
    organizationId: string,
    lines: readonly ResolvedLine[],
    audit: { keyPrefix: string },
  ): Promise<PreparedRecalculation[]> {
    const plans: PreparedRecalculation[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const key = `${line.warehouseId}:${line.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const plan = await this.valuation.prepareRecalculation({
        organizationId,
        warehouseId: line.warehouseId,
        itemId: line.itemId,
        operationKey: boundedKey(`${audit.keyPrefix}:reprice:${key}`),
        trigger: 'backdated_document',
        reason: `Repricing explicitly requested for inventory document ${documentId}.`,
      });
      // `null` means this exact key was already recalculated under this
      // operation key (idempotent replay) — nothing left to execute.
      if (plan !== null) plans.push(plan);
    }
    return plans;
  }

  /**
   * Execute the planned repricing INSIDE the command's own transaction,
   * after the quantity facts it must reprice have been written there.
   *
   * This is what makes `repricing: "recalculate"` truthful: the movements,
   * the document row and the valuation replay commit together, and a failed
   * replay rolls the whole command back instead of leaving a posted
   * document whose valuation silently did not run. The returned runs are
   * announced by the caller AFTER the commit.
   */
  private async repriceWithin(
    tx: DocTxClient,
    plans: readonly PreparedRecalculation[],
  ): Promise<InventoryValuationRunDto[]> {
    const runs: InventoryValuationRunDto[] = [];
    for (const plan of plans) {
      runs.push(await this.valuation.recalculateWithin(tx, plan));
    }
    return runs;
  }

  /** Publish the valuation runs of a committed command. */
  private async announceRepricing(
    runs: readonly InventoryValuationRunDto[],
  ): Promise<void> {
    for (const run of runs) {
      await this.valuation.announceRecalculated(run);
    }
  }

  private async applyLifecycleOnly(
    id: string,
    organizationId: string,
    command: {
      permission: string;
      target: InventoryDocumentStatus;
      event: string;
      stamp: (
        now: Date,
        actorId: string | null,
      ) => Partial<InventoryDocumentUpdate>;
    },
  ): Promise<InventoryDocumentDto> {
    await this.authorization.requireAllPermissions([command.permission]);
    await this.organizations.assertOrganizationInScope(organizationId);
    const current = await this.mustFind(id, organizationId);
    rethrowDomain(() => assertTransition(current.status, command.target));
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    await this.documents.withTransaction(async (tx) => {
      await this.documents.updateHeader(tx, current.id, {
        status: command.target,
        ...command.stamp(now, actorId),
        updatedAt: now,
        updatedBy: actorId,
      });
    });
    const updated = await this.mustFind(id, organizationId);
    await this.publishDocumentEvent(command.event, updated, []);
    this.logger.log(
      'Inventory business document lifecycle transition',
      {
        documentId: updated.id,
        organizationId,
        status: updated.status,
      },
      InventoryBusinessDocumentsService.name,
    );
    return this.toDto(updated);
  }

  private publishDocumentEvent(
    type: string,
    document: InventoryBusinessDocument,
    movementIds: string[],
  ): Promise<void> {
    return publishEvent(this.events, {
      type,
      aggregateType: 'InventoryBusinessDocument',
      aggregateId: document.id,
      payload: {
        id: document.id,
        organizationId: document.organizationId,
        kind: document.kind,
        number: document.number,
        status: document.status,
        movementIds,
      },
    });
  }

  /**
   * Turn the ledger's internal failures into the SAME stable business codes
   * a direct posting produces, so the UI renders one insufficient-stock
   * experience regardless of which surface caused it (FE-UX-02 §1.2) — and a
   * transfer whose coupled replay refuses gets the code the transfer endpoint
   * uses (C-59C), never a generic failure.
   */
  private translatePostingError(
    error: unknown,
    header: { warehouseId?: string | null; sourceWarehouseId?: string | null },
  ): unknown {
    if (error instanceof InsufficientStockError) {
      const warehouseId =
        header.sourceWarehouseId ?? header.warehouseId ?? null;
      return AppException.businessRule(
        `This operation would drive the warehouse below zero: on hand ${error.onHand}, requested ${error.requested}. No stock was moved and the document was not changed.`,
        {
          code: 'inventory.insufficient_stock',
          warehouseId,
          onHand: error.onHand,
          requested: error.requested,
        },
      );
    }
    return translateTransferReplayError(error) ?? error;
  }
}

// ---- Internal helpers ----

function finalizeKey(documentId: string): string {
  return boundedKey(`invdoc:${documentId}:finalize`);
}

function boundedKey(value: string): string {
  return value.slice(0, MAX_OPERATION_KEY);
}

/**
 * The idempotency hash for a document-owned ledger operation. The key itself
 * is already derived from the document and the line, so the hash binds the
 * stored operation to that exact pair: a replay with the same key and a
 * different document can never be mistaken for the same intent.
 */
function documentRequestHash(documentId: string, operationKey: string): string {
  // `inventory_operations.request_hash` is a fixed CHAR(64) sha256 hex, like
  // every other idempotency hash in this module — the readable identity is
  // hashed, never stored raw (a raw identity overflows the column).
  return createHash('sha256')
    .update(`inventory_document:${documentId}:${operationKey}`)
    .digest('hex');
}

function isBefore(candidate: BusinessDate, reference: BusinessDate): boolean {
  return candidate < reference;
}

/** The ledger type a document kind posts (C-59D: the return types). */
function movementTypeForKind(kind: InventoryDocumentKind) {
  switch (kind) {
    case 'receipt':
      return 'inbound' as const;
    case 'issue':
      return 'outbound' as const;
    case 'purchase_return':
      return 'purchase_return' as const;
    case 'sales_return':
      return 'sales_return' as const;
    case 'transfer':
      return 'transfer_out' as const;
  }
}

/** `|value|` — a basis receipt's quantity, stored signed, is positive. */
function magnitude(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
}

function toLineCreate(line: ResolvedLine): DocumentLineCreate {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    itemId: line.itemId,
    quantity: line.quantity,
    unitId: line.unitId,
    baseQuantity: line.baseQuantity,
    baseUnitId: line.baseUnitId,
    conversionFactor: line.conversionFactor,
    basisMovementId: line.basisMovementId,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeText(
  value: string | null | undefined,
  maxLength: number,
  field: string,
): string | null {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  if (normalized.length > maxLength) {
    throw AppException.validation([
      {
        field,
        message: `${field} must be at most ${maxLength} characters.`,
        code: 'maxLength',
      },
    ]);
  }
  return normalized;
}

function requireKind(value: string): InventoryDocumentKind {
  if (!isInventoryDocumentKind(value)) {
    throw AppException.badRequest(
      'Document kind must be one of: receipt, issue, transfer.',
    );
  }
  return value;
}

function parseKind(
  value: string | undefined,
): InventoryDocumentKind | undefined {
  if (value === undefined || value === '') return undefined;
  return requireKind(value);
}

function parseStatus(
  value: string | undefined,
): InventoryDocumentStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isInventoryDocumentStatus(value)) {
    throw AppException.badRequest(
      'Document status must be one of: draft, operational, accounting_posted, immutable, cancelled.',
    );
  }
  return value;
}

function parseRepricing(
  value: string | null | undefined,
): RepricingChoice | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!isRepricingChoice(trimmed)) {
    throw AppException.validation([
      {
        field: 'repricing',
        message:
          'repricing must be "recalculate" or "skip". There is no default: valuation is never recalculated silently.',
        code: 'invalidRepricingChoice',
      },
    ]);
  }
  return trimmed;
}

/**
 * Domain rule violations are framework-free; the HTTP boundary needs them as
 * 422 with their stable code. One translation point, never scattered
 * try/catch.
 */
function rethrowDomain(work: () => void): void {
  try {
    work();
  } catch (error) {
    if (error instanceof InventoryDocumentRuleError) {
      throw AppException.businessRule(error.message, { code: error.code });
    }
    throw error;
  }
}

export type { DocumentSideEffectAssessment };
