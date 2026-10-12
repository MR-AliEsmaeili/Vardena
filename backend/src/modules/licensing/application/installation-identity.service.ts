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
 * The in-process cache is safe for the INSTALLATION ID, which is immutable
 * once created: a restart re-reads the same row, which is exactly the property
 * a license bound to this installation depends on. It is NOT used for the
 * commercial-customer binding: that column is written by the first import and
 * moved by an explicit transfer (Owner decision 2026-10-12, Q4), so the import
 * path reads it fresh — a cached copy could make one process refuse a
 * legitimate import or act on a binding that already moved.
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

  /**
   * The identity id that ALREADY exists, or null — never creates one.
   *
   * Import uses this: a document must name the identity this installation
   * already has, so a license can never bring an installation row into
   * existence (ADR-0046 Decision 6, design §7).
   */
  async existingIdOrNull(): Promise<string | null> {
    return (await this.existingOrNull())?.installationId ?? null;
  }

  /**
   * The identity that ALREADY exists — including its commercial customer
   * binding, which the import path's customer rules evaluate against (Owner
   * decision 2026-10-12, Q4) — or null. Never creates one.
   *
   * The row is read on EVERY call, deliberately: the id is immutable but the
   * customer binding is not, and the caller is the import path, whose
   * authoritative decision runs inside the import transaction under the
   * installation row lock. This read exists so the read-side pre-check cannot
   * disagree with that decision. A failure to read returns null, exactly like
   * `existingIdOrNull`, so the caller fails closed on the identity it cannot
   * see.
   */
  async existingOrNull(): Promise<InstallationIdentity | null> {
    try {
      const existing = await this.installations.findSelf();
      if (existing === null) return null;
      this.cached = existing;
      return existing;
    } catch {
      return null;
    }
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
