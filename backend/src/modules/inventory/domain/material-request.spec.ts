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

function baseRequest(overrides: Partial<MaterialRequest> = {}): MaterialRequest {
  return {
    id: 'mr-1',
    organizationId: 'org-1',
    number: null,
    status: 'draft',
    description: null,
    requestedBy: 'user-1',
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    approvalReversedAt: null,
    approvalReversedBy: null,
    approvalReversalReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('isMaterialRequestStatus', () => {
  it('accepts every closed-list status', () => {
    for (const status of MATERIAL_REQUEST_STATUSES) {
      expect(isMaterialRequestStatus(status)).toBe(true);
    }
  });

  it('rejects an unknown status, including a never-added "cancelled"', () => {
    expect(isMaterialRequestStatus('cancelled')).toBe(false);
    expect(isMaterialRequestStatus('')).toBe(false);
  });
});

describe('planEdit (edit, submit, delete — draft-only)', () => {
  it('allows a draft', () => {
    expect(planEdit('draft')).toEqual({ problem: null });
  });

  it.each(['submitted', 'approved', 'rejected'])(
    'refuses a %s request',
    (status) => {
      expect(planEdit(status)).toEqual({ problem: 'not_draft' });
    },
  );
});

describe('planDecision (approve/reject — submitted-only)', () => {
  it('allows a submitted request', () => {
    expect(planDecision('submitted')).toEqual({ problem: null });
  });

  it.each(['draft', 'approved', 'rejected'])(
    'refuses a %s request',
    (status) => {
      expect(planDecision(status)).toEqual({ problem: 'not_submitted' });
    },
  );
});

describe('planReversal (reverse approval — approved-only)', () => {
  it('allows an approved request', () => {
    expect(planReversal('approved')).toEqual({ problem: null });
  });

  it.each(['draft', 'submitted', 'rejected'])(
    'refuses a %s request',
    (status) => {
      expect(planReversal(status)).toEqual({ problem: 'not_approved' });
    },
  );
});

describe('materialRequestTransitionMessage', () => {
  it('has a non-empty message for every problem', () => {
    expect(materialRequestTransitionMessage('not_draft')).toMatch(/draft/i);
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
    expect(dto.approvedAt).toBeNull();
    expect(dto.rejectedAt).toBeNull();
    expect(dto.approvalReversedAt).toBeNull();
  });

  it('never clears a prior cycle\'s approval/rejection/reversal facts (header is cumulative, not reset)', () => {
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
