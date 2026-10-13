import { describe, expect, it } from 'vitest';
import { AppException } from './app-exception.js';
import { ERROR_STATUS } from './error-codes.js';

describe('AppException', () => {
  it('pins every code to its documented HTTP status', () => {
    const cases: Array<[AppException, keyof typeof ERROR_STATUS]> = [
      [
        AppException.validation([
          { field: 'a', message: 'm', code: 'isString' },
        ]),
        'ValidationFailed',
      ],
      [AppException.badRequest(), 'BadRequest'],
      [AppException.unauthorized(), 'Unauthorized'],
      [AppException.forbidden(), 'PermissionDenied'],
      [AppException.notFound('Widget', '1'), 'EntityNotFound'],
      [AppException.conflict(), 'Conflict'],
      [AppException.businessRule('No.'), 'BusinessRuleViolation'],
      [AppException.rateLimited(7), 'RateLimitExceeded'],
      [AppException.serviceUnavailable(), 'ServiceUnavailable'],
    ];
    for (const [exception, code] of cases) {
      expect(exception.code).toBe(code);
      expect(exception.getStatus()).toBe(ERROR_STATUS[code]);
    }
  });

  it('carries validation issues and not-found details', () => {
    const issues = [
      { field: 'title', message: 'too short', code: 'minLength' },
    ];
    expect(AppException.validation(issues).details).toEqual(issues);
    expect(AppException.notFound('Widget').details).toEqual({
      entity: 'Widget',
    });
    expect(AppException.rateLimited(7).details).toEqual({
      retryAfterSeconds: 7,
    });
  });
});
