import { describe, expect, it } from 'vitest';
import {
  isMaterialRequestStatus,
  materialRequestTransitionMessage,
  MATERIAL_REQUEST_STATUSES,
  planDecision,
  planEdit,
  planReversal,
  toMaterialRequestDto,
  type MaterialRequest,
} from './material-request.js';

function baseRequest(
  overrides: Partial<MaterialRequest> = {},
): MaterialRequest {
  return {
    id: 'mr-1',
    organizationId: 'org-1',
    number: null,
    status: 'draft',
    description: null,
    requestedBy: 'user-1',
    submittedAt: null,
    submittedBy: null,
    returnedAt: null,
    returnedBy: null,
    returnReason: null,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    approvalReversedAt: null,
    approvalReversedBy: null,
    approvalReversalReason: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('isMaterialRequestStatus', () => {
  it('accepts every closed-list status, including returned and cancelled', () => {
    for (const status of MATERIAL_REQUEST_STATUSES) {
      expect(isMaterialRequestStatus(status)).toBe(true);
    }
    expect(MATERIAL_REQUEST_STATUSES).toContain('returned');
    expect(MATERIAL_REQUEST_STATUSES).toContain('cancelled');
  });

  it('rejects an unknown status', () => {
    expect(isMaterialRequestStatus('archived')).toBe(false);
    expect(isMaterialRequestStatus('')).toBe(false);
  });
});

describe('planEdit (edit, submit — draft or returned-for-correction)', () => {
  it('allows a draft', () => {
    expect(planEdit('draft')).toEqual({ problem: null });
  });

  it('allows a request returned for correction (Owner decision: the requester may edit and must resubmit)', () => {
    expect(planEdit('returned')).toEqual({ problem: null });
  });

  it.each(['submitted', 'approved', 'rejected', 'cancelled'])(
    'refuses a %s request',
    (status) => {
      expect(planEdit(status)).toEqual({ problem: 'not_editable' });
    },
  );
});

describe('planDecision (approve/reject/return-for-correction — submitted-only)', () => {
  it('allows a submitted request', () => {
    expect(planDecision('submitted')).toEqual({ problem: null });
  });

  it.each(['draft', 'returned', 'approved', 'rejected', 'cancelled'])(
    'refuses a %s request',
    (status) => {
      expect(planDecision(status)).toEqual({ problem: 'not_submitted' });
    },
  );
});

describe('planReversal (reverse approval AND cancel — approved-only)', () => {
  it('allows an approved request', () => {
    expect(planReversal('approved')).toEqual({ problem: null });
  });

  it.each(['draft', 'submitted', 'returned', 'rejected', 'cancelled'])(
    'refuses a %s request',
    (status) => {
      expect(planReversal(status)).toEqual({ problem: 'not_approved' });
    },
  );
});

describe('materialRequestTransitionMessage', () => {
  it('has a non-empty message for every problem', () => {
    expect(materialRequestTransitionMessage('not_editable')).toMatch(
      /draft|returned/i,
    );
    expect(materialRequestTransitionMessage('not_submitted')).toMatch(
      /submitted/i,
    );
    expect(materialRequestTransitionMessage('not_approved')).toMatch(
      /approved/i,
    );
    expect(materialRequestTransitionMessage('already_terminal')).toMatch(
      /terminal/i,
    );
  });
});

describe('toMaterialRequestDto', () => {
  it('serializes dates to ISO strings and passes every other field through', () => {
    const request = baseRequest({
      number: 'MR-0001',
      status: 'approved',
      description: 'Office supplies',
      approvedAt: new Date('2026-01-02T00:00:00Z'),
      approvedBy: 'user-2',
    });
    const dto = toMaterialRequestDto(request);
    expect(dto.id).toBe('mr-1');
    expect(dto.number).toBe('MR-0001');
    expect(dto.status).toBe('approved');
    expect(dto.approvedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(dto.approvedBy).toBe('user-2');
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps null timestamps as null, never an empty string', () => {
    const dto = toMaterialRequestDto(baseRequest());
    expect(dto.submittedAt).toBeNull();
    expect(dto.returnedAt).toBeNull();
    expect(dto.approvedAt).toBeNull();
    expect(dto.rejectedAt).toBeNull();
    expect(dto.approvalReversedAt).toBeNull();
    expect(dto.cancelledAt).toBeNull();
  });

  it('serializes a returned-for-correction request, including its required reason', () => {
    const request = baseRequest({
      status: 'returned',
      returnedAt: new Date('2026-01-03T00:00:00Z'),
      returnedBy: 'user-2',
      returnReason: 'Wrong item on line 2',
    });
    const dto = toMaterialRequestDto(request);
    expect(dto.status).toBe('returned');
    expect(dto.returnedAt).toBe('2026-01-03T00:00:00.000Z');
    expect(dto.returnedBy).toBe('user-2');
    expect(dto.returnReason).toBe('Wrong item on line 2');
  });

  it('serializes a cancelled request, distinct from an approval reversal', () => {
    const request = baseRequest({
      status: 'cancelled',
      approvedAt: new Date('2026-01-02T00:00:00Z'),
      approvedBy: 'user-2',
      cancelledAt: new Date('2026-01-04T00:00:00Z'),
      cancelledBy: 'user-3',
      cancellationReason: 'No longer needed',
    });
    const dto = toMaterialRequestDto(request);
    expect(dto.status).toBe('cancelled');
    expect(dto.cancelledAt).toBe('2026-01-04T00:00:00.000Z');
    expect(dto.cancelledBy).toBe('user-3');
    expect(dto.cancellationReason).toBe('No longer needed');
    // Cancellation never touches the SEPARATE approval-reversal columns.
    expect(dto.approvalReversedAt).toBeNull();
    expect(dto.approvalReversedBy).toBeNull();
  });

  it("never clears a prior cycle's approval/rejection/reversal facts (header is cumulative, not reset)", () => {
    // Owner-aligned decision: status is the sole "current state" signal;
    // approvedAt/rejectedAt/approvalReversedAt etc. accumulate across
    // cycles rather than being cleared when the request moves on.
    const request = baseRequest({
      status: 'approved',
      approvedAt: new Date('2026-01-05T00:00:00Z'),
      approvedBy: 'user-3',
      approvalReversedAt: new Date('2026-01-03T00:00:00Z'),
      approvalReversedBy: 'user-3',
      approvalReversalReason: 'Wrong warehouse selected',
    });
    const dto = toMaterialRequestDto(request);
    expect(dto.approvedAt).toBe('2026-01-05T00:00:00.000Z');
    expect(dto.approvalReversedAt).toBe('2026-01-03T00:00:00.000Z');
    expect(dto.approvalReversalReason).toBe('Wrong warehouse selected');
  });
});
