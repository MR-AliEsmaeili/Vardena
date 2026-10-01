import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import type { InstallationIdentity } from '../domain/installation.js';

/**
 * Data access for `licensing.installations` (AR-07: Prisma lives in `data/`).
 *
 * Exactly one row carries `is_self = true`: the identity of THIS deployment.
 * A partial unique index enforces that at the database level, so two
 * processes racing on an empty database cannot both create an identity — the
 * loser re-reads the winner's row.
 */

interface InstallationRow {
  id: string;
  customerId: string | null;
  name: string;
  isSelf: boolean;
  createdAt: Date;
}

interface InstallationDelegate {
  findFirst(args: {
    where: { isSelf: boolean };
  }): Promise<InstallationRow | null>;
  create(args: {
    data: {
      id: string;
      customerId: null;
      name: string;
      isSelf: true;
      createdAt: Date;
      updatedAt: Date;
    };
  }): Promise<InstallationRow>;
  update(args: {
    where: { id: string };
    data: { customerId: string; updatedAt: Date };
  }): Promise<InstallationRow>;
}

interface Client {
  installation: InstallationDelegate;
}

@Injectable()
export class InstallationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  async findSelf(): Promise<InstallationIdentity | null> {
    const { installation } = await this.client();
    const row = await installation.findFirst({ where: { isSelf: true } });
    return row === null ? null : toIdentity(row);
  }

  /**
   * Create the identity of this deployment. A concurrent creator wins the
   * unique index; this call then adopts the existing identity instead of
   * failing, so a new installation is never produced by a startup race.
   */
  async createSelf(params: {
    id: string;
    name: string;
    now: Date;
  }): Promise<InstallationIdentity> {
    const { installation } = await this.client();
    try {
      const row = await installation.create({
        data: {
          id: params.id,
          customerId: null,
          name: params.name,
          isSelf: true,
          createdAt: params.now,
          updatedAt: params.now,
        },
      });
      return toIdentity(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findSelf();
      if (existing === null) throw error;
      return existing;
    }
  }

  /** Bind the installation to the commercial customer a license names. */
  async attachCustomer(
    installationId: string,
    customerId: string,
    now: Date,
  ): Promise<void> {
    const { installation } = await this.client();
    await installation.update({
      where: { id: installationId },
      data: { customerId, updatedAt: now },
    });
  }
}

function toIdentity(row: InstallationRow): InstallationIdentity {
  return {
    installationId: row.id,
    name: row.name,
    customerId: row.customerId,
    createdAt: row.createdAt,
  };
}
