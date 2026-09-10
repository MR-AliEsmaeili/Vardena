import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { JsonLogger } from '../logging/json-logger.service.js';

/**
 * Shared Prisma Client holder (docs/database-strategy.md section 2).
 *
 * There is exactly one instance per process (API, worker), owning one `pg`
 * pool. The generated Prisma Client (`prisma generate` output) is loaded
 * lazily because codegen is a build step that may not have run yet — a
 * missing client fails with an actionable error instead of a crash.
 *
 * Rules for future agents (AR-07):
 * - Inject `PrismaService` ONLY in a module's `data/` layer (repositories).
 * - Never import another module's generated model types; cross-module reads
 *   go through the owning module's public service.
 * - `getClient<T>()` defaults to the minimal structural type; repositories
 *   working with generated models call `getClient<PrismaClient>()` with the
 *   generated type imported from `src/generated/prisma/client.js`.
 */
const GENERATED_CLIENT_SPECIFIER = '../../generated/prisma/client.js';

/**
 * Minimal structural surface of the generated client: the only part the
 * foundation needs. The runtime object is always the full generated client.
 */
export interface PrismaDatabaseClient {
  $queryRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
  $disconnect(): Promise<void>;
}

interface GeneratedClientModule {
  PrismaClient: new (options: { adapter: unknown }) => PrismaDatabaseClient;
}

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly adapter: PrismaPg;
  private clientPromise: Promise<PrismaDatabaseClient> | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: JsonLogger,
  ) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 3000,
      max: 10,
    });
    // An idle-client error without a listener crashes Node — log it instead.
    this.pool.on('error', (error: Error) => {
      this.logger.error(
        'Postgres pool idle-client error',
        { error: error.message },
        PrismaService.name,
      );
    });
    this.adapter = new PrismaPg(this.pool);
  }

  /**
   * The shared client, loaded once. First call imports the `prisma generate`
   * output; throws an actionable error when codegen has not run yet.
   */
  async getClient<
    TClient extends PrismaDatabaseClient = PrismaDatabaseClient,
  >(): Promise<TClient> {
    this.clientPromise ??= this.loadClient();
    return (await this.clientPromise) as TClient;
  }

  /** Connectivity probe used by readiness checks and worker startup. */
  async checkHealth(): Promise<void> {
    const client = await this.getClient();
    await client.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.clientPromise !== undefined) {
      // Initialization may have failed (missing codegen, bad URL) — a failed
      // client has nothing to disconnect, but the pool must still close.
      const client = await this.clientPromise.catch(() => undefined);
      if (client !== undefined) await client.$disconnect();
    }
    await this.pool.end();
  }

  /** Credential-free connection label, safe for logs. */
  describeConnection(): string {
    return safeDatabaseLabel(this.config.databaseUrl);
  }

  private async loadClient(): Promise<PrismaDatabaseClient> {
    let generated: GeneratedClientModule;
    try {
      // Variable specifier on purpose: a static import would fail the build
      // when codegen has not run yet instead of producing the error below.
      generated = (await import(
        /* @vite-ignore */ GENERATED_CLIENT_SPECIFIER
      )) as GeneratedClientModule;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'Prisma Client has not been generated. Run "npm run prisma:generate" from backend/ and retry.',
        );
      }
      throw error;
    }
    return new generated.PrismaClient({ adapter: this.adapter });
  }
}

/** Render a credential-free connection label for logs (never log the URL raw). */
export function safeDatabaseLabel(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname === '' ? 'unknown-host' : url.hostname;
    const port = url.port === '' ? '' : `:${url.port}`;
    const database =
      url.pathname === '' || url.pathname === '/' ? '' : url.pathname;
    return `${url.protocol}//${host}${port}${database}`;
  } catch {
    return 'unparseable DATABASE_URL';
  }
}
