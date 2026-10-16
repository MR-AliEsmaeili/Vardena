import { describe, expect, it } from 'vitest';
import { licensingTestDouble } from '../../../../test/support/licensing.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AuthorizationService } from './authorization.service.js';

function svc(validUntil: Date | null) {
  const licensing = licensingTestDouble({ validUntil });
  const logger = {
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as JsonLogger;
  // userRoles is unused on the system-context path exercised here.
  return new AuthorizationService(undefined as never, logger, licensing);
}

describe('OQ-45 system-context (worker/queued) enforcement', () => {
  it('refuses a mutation permission in READ_ONLY without an HTTP principal', async () => {
    // licensingTestDouble validFrom is 2020; expiry in the past => READ_ONLY now.
    const service = svc(new Date('2020-02-01T00:00:00.000Z'));
    await expect(
      service.requireAllPermissions(['Accounting.Document.Create']),
    ).rejects.toMatchObject({ code: 'PermissionDenied' });
  });
  it('allows reads and active-license mutations in system context', async () => {
    await expect(
      svc(new Date('2020-02-01T00:00:00.000Z')).requireAllPermissions([
        'Accounting.Document.View',
      ]),
    ).resolves.toBeUndefined();
    await expect(
      svc(null).requireAllPermissions(['Accounting.Document.Create']),
    ).resolves.toBeUndefined();
  });
});
