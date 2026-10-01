import { Injectable } from '@nestjs/common';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { InstallationsRepository } from '../data/installations.repository.js';
import {
  SELF_PROVISIONED_INSTALLATION_NAME,
  type InstallationIdentity,
} from '../domain/installation.js';

/**
 * The installation identity of this deployment (L-02, see
 * `domain/installation.ts` for the model and its non-goals).
 *
 * Lifecycle: generated once (a server-side ULID), persisted in
 * `licensing.installations`, and loaded on every later call. Startup performs
 * no activation and no network call; the identity is resolved lazily on first
 * use so a process can boot before the database is reachable, and is then
 * memoised for the lifetime of the process.
 *
 * The in-process cache is safe because the row is immutable once created: a
 * restart re-reads the same row, which is exactly the property a license
 * bound to this installation depends on.
 */
@Injectable()
export class InstallationIdentityService {
  private cached: InstallationIdentity | null = null;
  private inFlight: Promise<InstallationIdentity> | null = null;

  constructor(
    private readonly installations: InstallationsRepository,
    private readonly logger: JsonLogger,
  ) {}

  /** Load the identity, creating it on first ever use. */
  async current(): Promise<InstallationIdentity> {
    if (this.cached !== null) return this.cached;
    this.inFlight ??= this.resolve().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** The identity id, or null when it cannot be read (database unavailable). */
  async currentIdOrNull(): Promise<string | null> {
    try {
      return (await this.current()).installationId;
    } catch {
      return null;
    }
  }

  private async resolve(): Promise<InstallationIdentity> {
    const existing = await this.installations.findSelf();
    if (existing !== null) {
      this.cached = existing;
      return existing;
    }
    const created = await this.installations.createSelf({
      id: generateId(),
      name: SELF_PROVISIONED_INSTALLATION_NAME,
      now: new Date(),
    });
    this.cached = created;
    this.logger.log(
      'Installation identity provisioned',
      { installationId: created.installationId },
      InstallationIdentityService.name,
    );
    return created;
  }
}
