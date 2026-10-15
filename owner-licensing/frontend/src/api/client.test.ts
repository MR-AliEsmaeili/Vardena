// Pure checks of the transport-level session-expiry contract. No HTTP request is
// made: the API layer is stubbed at the module boundary elsewhere (vitest.config.ts).
import { describe, expect, it } from 'vitest';
import { expectedUnauthorizedPaths, isExpectedUnauthorized } from './client';

describe('Owner API 401 classification', () => {
  it('never lets a rejected current password trigger the session-expiry reaction', () => {
    // `POST /auth/change-password` answers 401 for two different facts: an ended
    // session, and a rejected current password. Classifying it as an ended
    // session cleared every cached value and sent the operator to `/login` with
    // a false "session expired" notice during the mandatory first-login change.
    // The endpoint is therefore an expected-401 path; the page verifies the
    // session before it names a cause.
    expect(isExpectedUnauthorized('/auth/change-password')).toBe(true);
    expect(expectedUnauthorizedPaths).toContain('/auth/change-password');
  });

  // The full path list is asserted as data, so a failure names every route.
  const classify = (paths: readonly string[]) =>
    paths.map((path) => ({ path, expected401: isExpectedUnauthorized(path) }));

  it('keeps every expected-answer request out of the expiry reaction', () => {
    const paths = [
      '/auth/login',
      '/auth/logout',
      '/auth/me',
      '/auth/change-password',
    ];
    expect(classify(paths)).toEqual(
      paths.map((path) => ({ path, expected401: true })),
    );
  });

  it('still treats a 401 from session-gated data as an ended session', () => {
    const paths = [
      '/customers',
      '/customers/01ARZ3NDEKTSV4RRFFQ69G5FAV',
      '/users',
      '/users/01ARZ3NDEKTSV4RRFFQ69G5FAV/reset-password',
      '/operational-records',
      '/operational-records/01ARZ3NDEKTSV4RRFFQ69G5FAV/activation-observations',
      '/permissions/effective',
      '/audit-events',
    ];
    expect(classify(paths)).toEqual(
      paths.map((path) => ({ path, expected401: false })),
    );
  });
});
