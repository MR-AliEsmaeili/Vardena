import { describe, expect, it } from 'vitest';
import { MATERIAL_REQUEST_STATUSES } from '@/api/contracts';
import { materialRequestErrorMessage } from './material-request-error-messages';
import {
  emptyMaterialRequestLine,
  materialRequestFormSchema,
  toCreateMaterialRequestInput,
  toUpdateMaterialRequestInput,
  type MaterialRequestFormValues,
} from './material-request-form-schema';
import {
  isMaterialRequestDeletable,
  isMaterialRequestEditable,
  isMaterialRequestLineLocked,
  isMaterialRequestSubmittable,
} from './material-request-status';
import {
  MATERIAL_REQUESTS_DEFAULT_SORT,
  parseMaterialRequestsUrlState,
  parseRequestedBy,
} from './material-request-url-state';
import { ApiError } from '@/api/errors';

const validValues: MaterialRequestFormValues = {
  description: '  خط تولید  ',
  lines: [
    {
      itemId: 'item-1',
      warehouseId: 'wh-1',
      quantity: '5.0000',
      unitId: 'unit-1',
      reservationRequested: true,
    },
  ],
};

describe('material request status matrix', () => {
  it('allows edit/submit only in draft and returned, and delete only in draft', () => {
    expect(MATERIAL_REQUEST_STATUSES.map(isMaterialRequestEditable)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(MATERIAL_REQUEST_STATUSES.map(isMaterialRequestSubmittable)).toEqual(
      [true, false, true, false, false, false],
    );
    expect(MATERIAL_REQUEST_STATUSES.map(isMaterialRequestDeletable)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('locks a line once it has been invoked at least once', () => {
    expect(isMaterialRequestLineLocked({ invocationCount: 0 })).toBe(false);
    expect(isMaterialRequestLineLocked({ invocationCount: 1 })).toBe(true);
  });
});

describe('material request form schema', () => {
  it('accepts a positive decimal string and keeps it exact', () => {
    const parsed = materialRequestFormSchema.safeParse(validValues);
    expect(parsed.success).toBe(true);
  });

  it('rejects zero, negative, rounded-too-fine and non-numeric quantities', () => {
    for (const quantity of ['0', '0.0000', '-1', '1.00001', '1,5', 'abc']) {
      const parsed = materialRequestFormSchema.safeParse({
        ...validValues,
        lines: [{ ...validValues.lines[0]!, quantity }],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it('requires at least one line and a description within 1000 characters', () => {
    expect(
      materialRequestFormSchema.safeParse({ ...validValues, lines: [] })
        .success,
    ).toBe(false);
    expect(
      materialRequestFormSchema.safeParse({
        ...validValues,
        description: 'x'.repeat(1001),
      }).success,
    ).toBe(false);
  });

  it('builds an exact create body with the organization and no status', () => {
    const body = toCreateMaterialRequestInput('org-1', validValues);
    expect(body).toEqual({
      organizationId: 'org-1',
      description: 'خط تولید',
      lines: validValues.lines,
    });
    expect(body).not.toHaveProperty('status');
  });

  it('omits an empty description on create and clears it with null on update', () => {
    const emptyDescription = { ...validValues, description: '   ' };
    expect(
      toCreateMaterialRequestInput('org-1', emptyDescription),
    ).not.toHaveProperty('description');
    expect(toUpdateMaterialRequestInput(emptyDescription).description).toBe(
      null,
    );
  });

  it('starts a new request with exactly one empty line and no reservation', () => {
    expect(emptyMaterialRequestLine()).toEqual({
      itemId: '',
      warehouseId: '',
      quantity: '',
      unitId: '',
      reservationRequested: false,
    });
  });
});

describe('material request URL state', () => {
  it('normalizes an unknown status and an unsupported sort away', () => {
    const state = parseMaterialRequestsUrlState(
      new URLSearchParams('status=archived&sort=description:asc&page=0'),
    );
    expect(state.status).toBe('');
    expect(state.sort).toBe(MATERIAL_REQUESTS_DEFAULT_SORT);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(50);
  });

  it('keeps a valid closed status and a valid ULID requester', () => {
    const state = parseMaterialRequestsUrlState(
      new URLSearchParams(
        'status=returned&requestedBy=01arz3ndektsv4rrffq69g5fav&sort=number:asc',
      ),
    );
    expect(state.status).toBe('returned');
    expect(state.requestedBy).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(state.sort).toBe('number:asc');
  });

  it('drops a requester that is not a ULID', () => {
    expect(parseRequestedBy('not-a-ulid')).toBe('');
    expect(parseRequestedBy(null)).toBe('');
  });
});

describe('material request error copy', () => {
  it('localizes the editable-status refusal instead of showing server English', () => {
    const { message } = materialRequestErrorMessage(
      'update',
      new ApiError({
        code: 'BusinessRuleViolation',
        message:
          'The request can only be edited, submitted or deleted while it is a draft or has been returned for correction.',
      }),
    );
    expect(message).toContain('پیش‌نویس');
  });

  it('recognizes a status-race message and a missing unit conversion', () => {
    expect(
      materialRequestErrorMessage(
        'submit',
        new ApiError({
          code: 'BusinessRuleViolation',
          message:
            'Material Request is "approved", but this action requires "draft" or "returned".',
        }),
      ).message,
    ).toContain('پیش‌نویس');
    expect(
      materialRequestErrorMessage(
        'create',
        new ApiError({
          code: 'BusinessRuleViolation',
          message:
            'No unit conversion from the entered unit to the base unit covers 2026-10-28.',
        }),
      ).message,
    ).toContain('تبدیل');
  });

  it('maps permission and network failures to shared copy', () => {
    expect(
      materialRequestErrorMessage(
        'delete',
        new ApiError({ code: 'PermissionDenied', message: 'nope' }),
      ).message,
    ).toContain('مجوز');
    expect(
      materialRequestErrorMessage(
        'create',
        new ApiError({ code: 'NetworkError', message: 'offline' }),
      ).message,
    ).toContain('ارتباط');
  });
});
