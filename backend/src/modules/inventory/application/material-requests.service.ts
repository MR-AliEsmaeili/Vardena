import { Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  businessDateFromInstant,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { NumberingService } from '../../documents/application/numbering.service.js';
import { DocumentRelationsService } from '../../documents/application/document-relations.service.js';
import { DocumentTypesService } from '../../documents/application/document-types.service.js';
import {
  MaterialRequestsRepository,
  MaterialRequestApproverMismatchError,
  MaterialRequestInvocationCapacityError,
  MaterialRequestLineNotFoundError,
  MaterialRequestLinesInvokedError,
  MaterialRequestStatusError,
  type ApproveLineInput,
  type DraftLineInput,
  type InvocationCapacityResult,
} from '../data/material-requests.repository.js';
import {
  BalanceDriftError,
  ReservationAvailabilityError,
} from '../data/inventory-posting-errors.js';
import { ItemsService } from './items.service.js';
import { WarehousesService } from './warehouses.service.js';
import { UnitsService } from './units.service.js';
import { UnitConversionsRepository } from '../data/unit-conversions.repository.js';
import { resolveEnteredToBase } from './inventory-posting-support.js';
import { assertPostableItem } from './inventory-movements.service.js';
import { resolveSort } from './master-data-support.js';
import {
  subtractDecimalStrings,
  canonicalizeDecimal,
  fitsQuantity,
  multiplyDecimalStrings,
  validateEnteredQuantity,
  quantityProblemMessage,
} from '../domain/quantities.js';
import { resolveEffectivePolicy } from '../domain/negative-stock-policy.js';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_REASON_LENGTH,
  materialRequestTransitionMessage,
  planDecision,
  planEdit,
  planReversal,
  toMaterialRequestDto,
  type MaterialRequest,
  type MaterialRequestDto,
} from '../domain/material-request.js';
import {
  toMaterialRequestLineDto,
  type MaterialRequestLine,
  type MaterialRequestLineDto,
} from '../domain/material-request-line.js';
import { toMaterialRequestEventDto } from '../domain/material-request-event.js';
import type { MaterialRequestEventDto } from '../domain/material-request-event.js';
import { MATERIAL_REQUEST_PERMISSIONS } from '../domain/material-request-permissions.js';
import { MATERIAL_REQUEST_DOCUMENT_TYPE } from '../domain/material-request-document-type.js';

const SORTABLE_FIELDS: Record<string, string> = {
  createdAt: 'createdAt',
  number: 'number',
  status: 'status',
};

export interface MaterialRequestDetailDto extends MaterialRequestDto {
  lines: MaterialRequestLineDto[];
}

export interface CreateMaterialRequestLineInput {
  itemId: string;
  warehouseId: string;
  /** Entered magnitude, in `unitId`. Decimal string. */
  quantity: string;
  unitId: string;
  reservationRequested?: boolean | undefined;
}

export interface CreateMaterialRequestInput {
  organizationId: string;
  description?: string | null | undefined;
  lines: CreateMaterialRequestLineInput[];
}

export interface UpdateMaterialRequestInput {
  description?: string | null | undefined;
  /** Omit to leave the line set unchanged; provide to REPLACE it wholesale
   *  (Owner decision: the system never auto-splits a line — every line here
   *  is exactly the warehouse/item/quantity the caller chose). */
  lines?: CreateMaterialRequestLineInput[] | undefined;
}

export interface ListMaterialRequestsQuery {
  organizationId: string;
  status?: string | undefined;
  requestedBy?: string | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface RejectMaterialRequestInput {
  reason: string;
}

export interface ReturnMaterialRequestForCorrectionInput {
  reason: string;
}

export interface ReverseMaterialRequestApprovalInput {
  reason?: string | null | undefined;
}

export interface CancelMaterialRequestInput {
  reason?: string | null | undefined;
}

export interface InvokeMaterialRequestLineInput {
  lineId: string;
  destinationModule: string;
  destinationDocumentType: string;
  destinationDocumentId: string;
  destinationLineId?: string | null | undefined;
  /** Entered in the LINE's own unit (`unitId`), not necessarily the base
   *  unit — converted with the line's own recorded `conversionFactor`, never
   *  re-resolved against (possibly since-changed) unit conversions. */
  quantity: string;
}

/**
 * Material Request (C-50) — application orchestration.
 *
 * Owns no stock effect of its own: no status ever changes `on_hand`;
 * `approve` creates AT MOST a reservation per flagged line (a soft claim),
 * atomically with the header transition
 * (`MaterialRequestsRepository.approve`'s own `$transaction`) — see that
 * method's docs for the deadlock-avoidance contract this service must honor
 * (reservation lines sorted by `(warehouseId, itemId)` before calling it).
 * `reverseApproval` and `cancel` are the two DISTINCT ways a reservation is
 * released (Owner decision); both are refused outright once any line has
 * been invoked, and `cancel` carries no original-approver restriction
 * unlike `reverseApproval` (no Owner decision names one for cancellation).
 *
 * Lifecycle (Owner-confirmed, C-50 §19): `draft` → `submitted` →
 * {`approved` | `rejected` | `returned`}; `returned` → `submitted` again
 * (resubmission, same `submit()` action, same allocated number); `approved`
 * → `submitted` (`reverseApproval`, original approver only) or → `cancelled`
 * (`cancel`, terminal, no part invoked). Any holder of
 * `Inventory.MaterialRequest.Approve` may approve/reject within their
 * authorized organization scope — there is no separately assigned approver,
 * and a requester MAY approve or reject their own request (no
 * requester/approver separation is enforced; see `mustFind`/the permission
 * checks below, which never compare `requestedBy` to the acting principal).
 *
 * Permission composition note (ADDITIVE, never a weakening): every mutation
 * response (create/update/submit/approve/reject) and `reverseApproval`'s
 * invocation gate need each line's invoked-quantity state. That state is
 * read from THIS module's own `material_request_lines` counters
 * (`invokedBaseQuantity`/`invocationCount`, maintained by
 * `MaterialRequestsRepository.reserveInvocationCapacity`), never from
 * `documents.document_relations` — so none of those operations require
 * `Documents.Relation.View`, a permission unrelated to the Material Request
 * action the caller already holds (a prior version of this service read
 * relations back for this and accidentally coupled every mutation's success
 * response to that permission — see `material-request-line.ts` for the full
 * rationale). `invokeLine` still calls `DocumentRelationsService.linkDocuments`
 * (the Foundation's no-permission module-internal write path) to create the
 * actual cross-module traceability record; it just never reads it back.
 *
 * `invokeLine` validates its destination (registered type, type/module
 * match, and existence+organization ownership via the owning module's own
 * API) BEFORE calling `reserveInvocationCapacity` — a destination that fails
 * validation never touches the line's remaining capacity. If
 * `linkDocuments` itself then fails AFTER capacity was reserved,
 * `releaseInvocationCapacity` compensates so a failed invocation never
 * consumes capacity, blocks a future one, or blocks approval reversal.
 *
 * Submitting allocates a number via `NumberingService.allocateNumber` BEFORE
 * calling `repository.submit()`, in a separate, non-composable transaction
 * (same accepted gap as every other Documents consumer): a crash between the
 * two leaves an orphaned allocation, never a duplicate number, and a retry
 * with the same Material Request id replays the SAME allocation (its
 * `allocationKey` is the request id).
 */
@Injectable()
export class MaterialRequestsService {
  constructor(
    private readonly repository: MaterialRequestsRepository,
    private readonly organizations: OrganizationsService,
    private readonly items: ItemsService,
    private readonly warehouses: WarehousesService,
    private readonly units: UnitsService,
    private readonly conversions: UnitConversionsRepository,
    private readonly numbering: NumberingService,
    private readonly documentRelations: DocumentRelationsService,
    private readonly documentTypes: DocumentTypesService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  // ---- draft authoring ------------------------------------------------------

  async createDraft(
    input: CreateMaterialRequestInput,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.CREATE,
    ]);
    await this.organizations.requireUsableOrganization(input.organizationId);
    if (input.lines.length === 0) {
      throw AppException.badRequest(
        'A Material Request must have at least one line.',
      );
    }
    const description = normalizeDescription(input.description);
    const actorId = this.requireActorId();
    const now = new Date();
    const { timeZone } = await this.organizations.getDateTimeSettings(
      input.organizationId,
    );
    const businessDate = businessDateFromInstant(now, timeZone);
    const lines = await this.resolveLines(
      input.organizationId,
      input.lines,
      businessDate,
    );
    const created = await this.repository.createDraft(
      {
        id: generateId(),
        organizationId: input.organizationId,
        description,
        requestedBy: actorId,
        createdAt: now,
        createdBy: actorId,
      },
      lines,
    );
    return this.toDetailDto(created.header, created.lines);
  }

  async updateDraft(
    id: string,
    organizationId: string,
    input: UpdateMaterialRequestInput,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.EDIT,
    ]);
    const current = await this.mustFind(id, organizationId);
    const plan = planEdit(current.status);
    if (plan.problem !== null) {
      throw AppException.businessRule(
        materialRequestTransitionMessage(plan.problem),
      );
    }
    const description =
      input.description === undefined
        ? undefined
        : normalizeDescription(input.description);
    const now = new Date();
    let lines: DraftLineInput[] | undefined;
    if (input.lines !== undefined) {
      if (input.lines.length === 0) {
        throw AppException.badRequest(
          'A Material Request must have at least one line.',
        );
      }
      const { timeZone } =
        await this.organizations.getDateTimeSettings(organizationId);
      lines = await this.resolveLines(
        organizationId,
        input.lines,
        businessDateFromInstant(now, timeZone),
      );
    }
    const actorId = this.requireActorId();
    try {
      const updated = await this.repository.updateDraft({
        id,
        organizationId,
        header: { description },
        lines,
        updatedAt: now,
        updatedBy: actorId,
      });
      return this.toDetailDto(updated.header, updated.lines);
    } catch (error) {
      throw mapStatusError(error);
    }
  }

  async deleteDraft(id: string, organizationId: string): Promise<void> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.DELETE,
    ]);
    await this.mustFind(id, organizationId);
    try {
      await this.repository.deleteDraft(id);
    } catch (error) {
      throw mapStatusError(error);
    }
  }

  // ---- reads ------------------------------------------------------------

  async getMaterialRequest(
    id: string,
    organizationId: string,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.VIEW,
    ]);
    const header = await this.mustFind(id, organizationId);
    const lines = await this.repository.listLines(id);
    return this.toDetailDto(header, lines);
  }

  async listMaterialRequests(
    query: ListMaterialRequestsQuery,
  ): Promise<PaginatedResult<MaterialRequestDto>> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.VIEW,
    ]);
    await this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        status: query.status,
        requestedBy: query.requestedBy,
      },
      orderBy: resolveSort(query.sort, SORTABLE_FIELDS, [
        { createdAt: 'desc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toMaterialRequestDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async listEvents(
    id: string,
    organizationId: string,
  ): Promise<MaterialRequestEventDto[]> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.VIEW,
    ]);
    await this.mustFind(id, organizationId);
    const events = await this.repository.listEvents(id);
    return events.map(toMaterialRequestEventDto);
  }

  // ---- lifecycle ----------------------------------------------------------

  async submit(
    id: string,
    organizationId: string,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.SUBMIT,
    ]);
    const current = await this.mustFind(id, organizationId);
    const plan = planEdit(current.status);
    if (plan.problem !== null) {
      throw AppException.businessRule(
        materialRequestTransitionMessage(plan.problem),
      );
    }
    const actorId = this.requireActorId();
    const now = new Date();
    // Separate, non-composable transaction (see class docs for the accepted
    // gap this implies on crash between the two steps).
    const allocation = await this.numbering.allocateNumber({
      organizationId,
      documentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
      allocationKey: id,
      referenceModule: 'inventory',
      referenceDocumentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
      referenceDocumentId: id,
    });
    try {
      const header = await this.repository.submit({
        id,
        organizationId,
        number: allocation.number,
        submittedAt: now,
        submittedBy: actorId,
      });
      const lines = await this.repository.listLines(id);
      return this.toDetailDto(header, lines);
    } catch (error) {
      throw mapStatusError(error);
    }
  }

  /**
   * Approve the request AND reserve every flagged line atomically (C-50
   * blocker #1). Lines are sorted by `(warehouseId, itemId)` before the call
   * so concurrent approvals of overlapping keys always lock in the same
   * order (deadlock avoidance — `ApproveInput.reservationLines`' contract).
   */
  async approve(
    id: string,
    organizationId: string,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.APPROVE,
    ]);
    const current = await this.mustFind(id, organizationId);
    const plan = planDecision(current.status);
    if (plan.problem !== null) {
      throw AppException.businessRule(
        materialRequestTransitionMessage(plan.problem),
      );
    }
    const lines = await this.repository.listLines(id);
    const actorId = this.requireActorId();
    const now = new Date();

    const reservationLines: ApproveLineInput[] = [];
    for (const line of lines.filter((l) => l.reservationRequested)) {
      const [item, warehouse] = await Promise.all([
        this.items.requireUsableItemInOrganization(line.itemId, organizationId),
        this.warehouses.requireUsableWarehouseInOrganization(
          line.warehouseId,
          organizationId,
        ),
      ]);
      reservationLines.push({
        lineId: line.id,
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        branchId: warehouse.branchId,
        quantity: line.quantity,
        unitId: line.unitId,
        baseQuantity: line.baseQuantity,
        baseUnitId: line.baseUnitId,
        conversionFactor: line.conversionFactor,
        allowNegative: resolveEffectivePolicy({
          itemAllow: item.allowNegativeStock,
          warehouseAllow: warehouse.allowNegativeStock,
        }),
      });
    }
    reservationLines.sort((a, b) =>
      a.warehouseId === b.warehouseId
        ? a.itemId.localeCompare(b.itemId)
        : a.warehouseId.localeCompare(b.warehouseId),
    );

    try {
      const result = await this.repository.approve({
        id,
        organizationId,
        approvedAt: now,
        approvedBy: actorId,
        reservationLines,
      });
      const updatedLines = await this.repository.listLines(id);
      return this.toDetailDto(result.header, updatedLines);
    } catch (error) {
      if (error instanceof ReservationAvailabilityError) {
        throw AppException.businessRule(error.message);
      }
      throw mapStatusError(error);
    }
  }

  async reject(
    id: string,
    organizationId: string,
    input: RejectMaterialRequestInput,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.REJECT,
    ]);
    const current = await this.mustFind(id, organizationId);
    const plan = planDecision(current.status);
    if (plan.problem !== null) {
      throw AppException.businessRule(
        materialRequestTransitionMessage(plan.problem),
      );
    }
    const reason = normalizeRequiredReason(input.reason, 'rejection');
    const actorId = this.requireActorId();
    const now = new Date();
    try {
      const header = await this.repository.reject({
        id,
        organizationId,
        rejectedAt: now,
        rejectedBy: actorId,
        reason,
      });
      const lines = await this.repository.listLines(id);
      return this.toDetailDto(header, lines);
    } catch (error) {
      throw mapStatusError(error);
    }
  }

  /**
   * Return a submitted request to its requester for correction (Owner
   * decision). Any holder of `Inventory.MaterialRequest.ReturnForCorrection`
   * may do this within their authorized organization scope — the same
   * no-separately-assigned-approver posture as approve/reject. Requires a
   * reason, same rule as rejection, so the requester knows what to fix.
   */
  async returnForCorrection(
    id: string,
    organizationId: string,
    input: ReturnMaterialRequestForCorrectionInput,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.RETURN_FOR_CORRECTION,
    ]);
    const current = await this.mustFind(id, organizationId);
    const plan = planDecision(current.status);
    if (plan.problem !== null) {
      throw AppException.businessRule(
        materialRequestTransitionMessage(plan.problem),
      );
    }
    const reason = normalizeRequiredReason(input.reason, 'return');
    const actorId = this.requireActorId();
    const now = new Date();
    try {
      const header = await this.repository.returnForCorrection({
        id,
        organizationId,
        returnedAt: now,
        returnedBy: actorId,
        reason,
      });
      const lines = await this.repository.listLines(id);
      return this.toDetailDto(header, lines);
    } catch (error) {
      throw mapStatusError(error);
    }
  }

  /**
   * Reverse an approval. Necessary but NOT sufficient conditions (C-50
   * §3.4), checked here in order:
   *   1. the request is approved (`planReversal`);
   *   2. the caller IS the original approver (`approvedBy`) — re-verified
   *      again under the row lock inside the repository as defense in
   *      depth against a race on approval itself;
   *   3. no line has been invoked yet — now checked INSIDE the repository's
   *      transaction, under the same Material Request row lock invocation
   *      itself takes (`MaterialRequestsRepository.reverseApproval`), so
   *      this is fully race-free (an earlier version checked this here,
   *      outside the transaction, and accepted a race window — that
   *      compromise is no longer necessary).
   */
  async reverseApproval(
    id: string,
    organizationId: string,
    input: ReverseMaterialRequestApprovalInput,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.REVERSE_APPROVAL,
    ]);
    const current = await this.mustFind(id, organizationId);
    const plan = planReversal(current.status);
    if (plan.problem !== null) {
      throw AppException.businessRule(
        materialRequestTransitionMessage(plan.problem),
      );
    }
    const actorId = this.requireActorId();
    if (current.approvedBy !== actorId) {
      throw AppException.forbidden(
        'Only the original approver may reverse this approval.',
      );
    }
    const reason =
      input.reason === undefined || input.reason === null
        ? null
        : normalizeDescription(input.reason);
    const now = new Date();
    try {
      const result = await this.repository.reverseApproval({
        id,
        organizationId,
        expectedApprovedBy: actorId,
        reversedAt: now,
        reversedBy: actorId,
        reason,
      });
      const lines = await this.repository.listLines(id);
      return this.toDetailDto(result.header, lines);
    } catch (error) {
      if (error instanceof MaterialRequestApproverMismatchError) {
        throw AppException.forbidden(error.message);
      }
      if (error instanceof MaterialRequestLinesInvokedError) {
        throw AppException.businessRule(error.message);
      }
      if (error instanceof BalanceDriftError) {
        throw AppException.conflict(error.message);
      }
      throw mapStatusError(error);
    }
  }

  /**
   * Cancel an APPROVED request outright (Owner decision: "an approved
   * request may be cancelled only if no part of it has entered a downstream
   * process", and "cancellation and reversal of approval are distinct
   * operations"). Unlike `reverseApproval`, any holder of
   * `Inventory.MaterialRequest.Cancel` may do this — there is no
   * original-approver restriction, because no Owner decision names one for
   * cancellation. The "no line invoked, even partially" gate is enforced
   * atomically inside `MaterialRequestsRepository.cancel`, under the same
   * row lock `reverseApproval`/invocation itself use.
   */
  async cancel(
    id: string,
    organizationId: string,
    input: CancelMaterialRequestInput,
  ): Promise<MaterialRequestDetailDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.CANCEL,
    ]);
    const current = await this.mustFind(id, organizationId);
    const plan = planReversal(current.status);
    if (plan.problem !== null) {
      throw AppException.businessRule(
        materialRequestTransitionMessage(plan.problem),
      );
    }
    const reason =
      input.reason === undefined || input.reason === null
        ? null
        : normalizeDescription(input.reason);
    const actorId = this.requireActorId();
    const now = new Date();
    try {
      const result = await this.repository.cancel({
        id,
        organizationId,
        cancelledAt: now,
        cancelledBy: actorId,
        reason,
      });
      const lines = await this.repository.listLines(id);
      return this.toDetailDto(result.header, lines);
    } catch (error) {
      if (error instanceof MaterialRequestLinesInvokedError) {
        throw AppException.businessRule(error.message);
      }
      if (error instanceof BalanceDriftError) {
        throw AppException.conflict(error.message);
      }
      throw mapStatusError(error);
    }
  }

  /**
   * Record that an approved line has been carried into a subsequent process
   * (C-50 §3.8) via a Document Relation (`fulfill`, quantity = base-unit
   * equivalent of `input.quantity`). Multiple/partial invocations of the same
   * line are allowed, with NO fixed count limit, as long as their total
   * never exceeds the line's own `baseQuantity`.
   *
   * Owner decision: when the line carries an ACTIVE reservation, every
   * successful invocation ALSO consumes the identical amount from it —
   * reducing its remaining quantity while it stays ACTIVE, or closing it the
   * moment it reaches exactly zero (never left ACTIVE at zero). This never
   * touches `onHand` and never requires a Warehouse Issue (C-52 remains
   * separate); a line with no reservation invokes exactly as before.
   *
   * Order matters (review findings #2 and #4) and is deliberate:
   *   1. validate the destination FULLY (registered type, type/module match,
   *      existence + organization ownership) — nothing stateful is touched
   *      yet, so a doomed-to-fail destination never consumes capacity or
   *      reservation quantity;
   *   2. `reserveInvocationCapacity` — the ONE atomic, lock-serialized
   *      check-and-increment against this line's own counters (and, when
   *      flagged, its reservation and the balance's `reserved` counter),
   *      immune to both a concurrent second invocation and
   *      `document_relations`' page-size limits;
   *   3. `linkDocuments` — the actual cross-module traceability write; if
   *      this fails, `releaseInvocationCapacity` compensates so the failed
   *      attempt never consumed capacity, reservation quantity, or
   *      `reserved` — and reopens the reservation if this attempt had
   *      closed it;
   *   4. `recordInvocationEvent` — append-only audit narrative, written only
   *      once the Document Relation itself is confirmed, never for an
   *      attempt that was compensated away.
   */
  async invokeLine(
    id: string,
    organizationId: string,
    input: InvokeMaterialRequestLineInput,
  ): Promise<MaterialRequestLineDto> {
    await this.authorization.requireAllPermissions([
      MATERIAL_REQUEST_PERMISSIONS.INVOKE,
    ]);
    const current = await this.mustFind(id, organizationId);
    if (current.status !== 'approved') {
      throw AppException.businessRule(
        'Only an approved Material Request can be invoked.',
      );
    }
    const lines = await this.repository.listLines(id);
    const line = lines.find((candidate) => candidate.id === input.lineId);
    if (line === undefined) {
      throw AppException.notFound('Material Request line', input.lineId);
    }

    await this.validateInvocationDestination(organizationId, input);

    const problem = validateEnteredQuantity(input.quantity);
    if (problem !== null) {
      throw AppException.badRequest(quantityProblemMessage(problem));
    }
    // The invocation input is already expressed in the line's own entered
    // unit (`line.unitId`) — the line's already-recorded `conversionFactor`
    // converts it to base units; neither is re-resolved from current master
    // data here, and `invokedEntered` is passed through verbatim to the
    // repository so a line's ACTIVE reservation (if any) can be consumed by
    // exactly this amount, in lockstep with `invokedBase` (Owner decision).
    const invokedEntered = canonicalizeDecimal(input.quantity);
    const invokedBase = canonicalizeDecimal(
      multiplyDecimalStrings(invokedEntered, line.conversionFactor),
    );
    if (!fitsQuantity(invokedBase)) {
      throw AppException.badRequest(
        "The invoked quantity, converted to the line's base unit, is out of range.",
      );
    }

    const actorId = this.requireActorId();
    const now = new Date();

    let reserved: InvocationCapacityResult;
    try {
      reserved = await this.repository.reserveInvocationCapacity({
        id,
        organizationId,
        lineId: line.id,
        invokedBase,
        invokedEntered,
        now,
        actorId,
      });
    } catch (error) {
      if (error instanceof MaterialRequestInvocationCapacityError) {
        throw AppException.businessRule(
          `The invoked quantity exceeds the ${error.remaining} still ` +
            'remaining on this line.',
        );
      }
      if (error instanceof MaterialRequestLineNotFoundError) {
        throw AppException.notFound('Material Request line', input.lineId);
      }
      if (error instanceof BalanceDriftError) {
        throw AppException.conflict(error.message);
      }
      throw mapStatusError(error);
    }

    let relation: Awaited<
      ReturnType<DocumentRelationsService['linkDocuments']>
    >;
    try {
      relation = await this.documentRelations.linkDocuments({
        organizationId,
        source: {
          module: 'inventory',
          documentType: MATERIAL_REQUEST_DOCUMENT_TYPE,
          documentId: id,
          lineId: line.id,
        },
        target: {
          module: input.destinationModule,
          documentType: input.destinationDocumentType,
          documentId: input.destinationDocumentId,
          lineId: input.destinationLineId ?? null,
        },
        relationKind: 'fulfill',
        quantity: invokedBase,
        createdByProcess: false,
      });
    } catch (error) {
      // The traceability record was never created — this attempt must not
      // be treated as a successful invocation, so give the capacity back,
      // AND — when this attempt had consumed (or fully closed) the line's
      // reservation — restore that reservation and its balance `reserved`
      // contribution to exactly their pre-attempt state.
      await this.repository.releaseInvocationCapacity({
        id,
        lineId: line.id,
        invokedBase,
        now: new Date(),
        actorId,
        reservationConsumption: reserved.reservationConsumption,
      });
      throw error;
    }
    // The Document Relation is the durable proof that this invocation
    // happened — capacity, reservation, and balance are already committed
    // by this point. The event row below is append-only audit narrative
    // only; it must never be allowed to turn an already-successful
    // invocation into a reported failure (which would both lie to the
    // caller and invite a retry that double-consumes capacity nothing was
    // actually wrong with). There is no outbox/durable-retry mechanism in
    // this codebase yet (see `kernel/events/domain-event-bus.ts`) to hand
    // this off to, and building one is out of scope for this fix — so the
    // accepted trade-off, matching the existing "never rethrow a
    // non-essential side effect" convention (see
    // `SessionRevocationConsumer.revokeAll`), is: log-and-continue. A
    // missing event for an otherwise fully-committed invocation is a
    // narrow, observable (logged) gap, not a silent one.
    try {
      await this.repository.recordInvocationEvent({
        materialRequestId: id,
        organizationId,
        actorId,
        occurredAt: now,
        relationId: relation.id,
      });
    } catch (error) {
      this.logger.error(
        'Failed to record a Material Request invocation audit event after ' +
          'the Document Relation and capacity consumption already ' +
          'committed successfully — the invocation itself stands.',
        {
          materialRequestId: id,
          organizationId,
          lineId: line.id,
          relationId: relation.id,
          error: error instanceof Error ? error.message : String(error),
        },
        MaterialRequestsService.name,
      );
    }
    return toMaterialRequestLineDto(line, {
      invokedBaseQuantity: reserved.invokedBaseQuantity,
      remainingBaseQuantity: reserved.remainingBaseQuantity,
      invocationCount: reserved.invocationCount,
    });
  }

  // ---- internals ------------------------------------------------------------

  private requireActorId(): string {
    const actorId = getPrincipal()?.userId;
    if (actorId === undefined || actorId === null || actorId === '') {
      throw AppException.unauthorized(
        'A Material Request requires an authenticated principal.',
      );
    }
    return actorId;
  }

  private async mustFind(
    id: string,
    organizationId: string,
  ): Promise<MaterialRequest> {
    await this.organizations.assertOrganizationInScope(organizationId);
    const current = await this.repository.findById(id);
    if (current === null || current.organizationId !== organizationId) {
      throw AppException.notFound('Material Request', id);
    }
    return current;
  }

  private async resolveLines(
    organizationId: string,
    inputs: CreateMaterialRequestLineInput[],
    asOf: BusinessDate,
  ): Promise<DraftLineInput[]> {
    const resolved: DraftLineInput[] = [];
    let lineNumber = 1;
    for (const input of inputs) {
      const item = await this.items.requireUsableItemInOrganization(
        input.itemId,
        organizationId,
      );
      const warehouse =
        await this.warehouses.requireUsableWarehouseInOrganization(
          input.warehouseId,
          organizationId,
        );
      assertPostableItem(item.code, {
        isStockable: item.isStockable,
        requiresLot: item.requiresLot,
        requiresSerial: item.requiresSerial,
        requiresExpiry: item.requiresExpiry,
      });
      await this.units.requireUsableUnitInOrganization(
        input.unitId,
        organizationId,
      );
      const resolvedQuantity = await resolveEnteredToBase({
        conversions: this.conversions,
        organizationId,
        itemId: item.id,
        baseUnitId: item.baseUnitId,
        unitId: input.unitId,
        quantity: input.quantity,
        asOf,
      });
      resolved.push({
        id: generateId(),
        lineNumber: lineNumber++,
        itemId: item.id,
        warehouseId: warehouse.id,
        branchId: warehouse.branchId,
        quantity: resolvedQuantity.quantity,
        unitId: input.unitId,
        baseQuantity: resolvedQuantity.baseQuantity,
        baseUnitId: item.baseUnitId,
        conversionFactor: resolvedQuantity.conversionFactor,
        reservationRequested: input.reservationRequested ?? false,
      });
    }
    return resolved;
  }

  /**
   * Validate a downstream invocation target BEFORE any state changes
   * (review finding #2): a registered document type is NOT proof the
   * destination document actually exists. This module can never read
   * another module's tables directly (AR-07), so it can only verify
   * destinations a module-owned API exposes for exactly that purpose.
   *
   * Checks, in order:
   *   1. the destination document type is registered at all;
   *   2. it is registered to the `destinationModule` the caller supplied
   *      (a registered type belonging to a DIFFERENT module than claimed is
   *      rejected here, never treated as a match);
   *   3. the destination document (and line, if supplied) actually exists,
   *      in the expected organization, via that OWNING module's own API.
   *
   * Today the only (module, documentType) pair this module can honestly
   * verify is Material Request itself — no other module in this codebase
   * yet exposes a safe "does this document exist, in this org, owned by
   * this module" read Material Request could call. Rather than fabricate a
   * check for a destination process that does not exist yet (Purchase
   * Request, Warehouse Issue, …), invocation into any other destination is
   * explicitly refused with a clear "not supported" error — this is an
   * honest, acknowledged limitation (see the implementation report), not a
   * bypassed validation.
   */
  private async validateInvocationDestination(
    organizationId: string,
    input: InvokeMaterialRequestLineInput,
  ): Promise<void> {
    const definition = this.documentTypes.requireDocumentType(
      input.destinationDocumentType,
    );
    if (definition.module !== input.destinationModule) {
      throw AppException.badRequest(
        `Document type "${input.destinationDocumentType}" belongs to module ` +
          `"${definition.module}", not "${input.destinationModule}".`,
      );
    }
    if (
      input.destinationModule === 'inventory' &&
      input.destinationDocumentType === MATERIAL_REQUEST_DOCUMENT_TYPE
    ) {
      const target = await this.repository.findById(
        input.destinationDocumentId,
      );
      if (target === null || target.organizationId !== organizationId) {
        throw AppException.notFound(
          'Destination document',
          input.destinationDocumentId,
        );
      }
      if (
        input.destinationLineId !== null &&
        input.destinationLineId !== undefined
      ) {
        const targetLines = await this.repository.listLines(
          input.destinationDocumentId,
        );
        const found = targetLines.some(
          (candidate) => candidate.id === input.destinationLineId,
        );
        if (!found) {
          throw AppException.notFound(
            'Destination document line',
            input.destinationLineId,
          );
        }
      }
      return;
    }
    throw AppException.businessRule(
      `Invocation into module "${input.destinationModule}" document type ` +
        `"${input.destinationDocumentType}" is not supported yet: no ` +
        'module-owned API exists to verify that destination exists. This ' +
        'is a known limitation, not a bypassed check.',
    );
  }

  private toDetailDto(
    header: MaterialRequest,
    lines: MaterialRequestLine[],
  ): MaterialRequestDetailDto {
    return {
      ...toMaterialRequestDto(header),
      lines: lines.map((line) =>
        toMaterialRequestLineDto(line, {
          invokedBaseQuantity: line.invokedBaseQuantity,
          remainingBaseQuantity: subtractDecimalStrings(
            line.baseQuantity,
            line.invokedBaseQuantity,
          ),
          invocationCount: line.invocationCount,
        }),
      ),
    };
  }
}

// ---- Internal helpers -------------------------------------------------------

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw AppException.badRequest(
      `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function normalizeRequiredReason(
  value: string | null | undefined,
  label: string,
): string {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    throw AppException.badRequest(`A ${label} reason is required.`);
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw AppException.badRequest(
      `Reason must be at most ${MAX_REASON_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function mapStatusError(error: unknown): unknown {
  if (error instanceof MaterialRequestStatusError) {
    return AppException.businessRule(error.message);
  }
  return error;
}
