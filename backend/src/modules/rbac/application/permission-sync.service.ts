import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { PermissionsRepository } from '../data/permissions.repository.js';
import { PermissionRegistry } from './permission-registry.js';

/**
 * Mirrors the code permission registry into `rbac.permissions` at startup
 * (ADR-0006: "a startup sync mirrors the registry into `rbac.permissions`").
 *
 * Properties that make this safe to run on every boot:
 * - idempotent: upsert by `code`, updating descriptions only;
 * - transactional: the whole registry is applied in one transaction, so the
 *   table is never observed half-synced;
 * - non-fatal: a database that is unreachable at boot must not stop the API
 *   from starting (the API is designed to boot without a database — the
 *   readiness probe reports the real state, ADR-0015 §4). A failed sync is
 *   logged; authorization keeps working from the assignment tables, and role
 *   administration reports the missing mirror rows explicitly.
 */
@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  constructor(
    private readonly registry: PermissionRegistry,
    private readonly permissions: PermissionsRepository,
    private readonly logger: JsonLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const result = await this.sync();
    if (result !== null) {
      this.logger.log(
        'Permission registry synced',
        { ...result },
        PermissionSyncService.name,
      );
    }
  }

  /**
   * Run the sync. Returns `null` when the database was unavailable (logged,
   * not thrown) so boot continues; throws nothing else.
   */
  async sync(): Promise<{
    created: number;
    updated: number;
    total: number;
  } | null> {
    const definitions = this.registry.all();
    try {
      return await this.permissions.syncDefinitions(definitions, new Date());
    } catch (error) {
      this.logger.warn(
        'Permission registry sync failed; rbac.permissions may be incomplete until the next successful boot',
        {
          registrySize: definitions.length,
          error: error instanceof Error ? error.message : String(error),
        },
        PermissionSyncService.name,
      );
      return null;
    }
  }
}
