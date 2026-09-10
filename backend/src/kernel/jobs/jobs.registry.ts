import { Injectable } from '@nestjs/common';

/**
 * Worker-side job-handler registry (ADR-0010).
 *
 * This registry answers ONE question: "which code handles job NAME?" It is
 * process infrastructure, not the job queue itself:
 * - The future Jobs module owns the DB-backed queue (`jobs.job_runs`),
 *   scheduling, retries, and the admin API.
 * - The future Sync dispatcher owns outbox dispatch; it is NOT implemented
 *   here (see `worker.ts`).
 *
 * How future jobs register (worker process only):
 *
 *   @Injectable()
 *   export class RenderPdfHandler {
 *     constructor(jobs: JobsRegistry) {
 *       jobs.register('print.render-pdf', (payload, ctx) => this.handle(payload, ctx));
 *     }
 *   }
 *
 * Handlers must be idempotent (safe re-run after a crash) and carry a
 * correlation id per job so worker logs stay traceable (no HTTP request
 * exists in the worker, so there is no ambient context).
 */
export interface JobContext {
  correlationId: string;
}

export type JobHandler<TPayload = unknown> = (
  payload: TPayload,
  ctx: JobContext,
) => Promise<void>;

export interface JobRegistration {
  name: string;
  description?: string;
}

interface StoredHandler {
  handler: JobHandler<any>;
  description?: string;
}

@Injectable()
export class JobsRegistry {
  private readonly handlers = new Map<string, StoredHandler>();

  register<TPayload>(
    name: string,
    handler: JobHandler<TPayload>,
    meta?: { description?: string },
  ): void {
    const key = name.trim();
    if (key === '') throw new Error('Job name must be a non-empty string.');
    if (this.handlers.has(key))
      throw new Error(`Job handler "${key}" is already registered.`);
    const stored: StoredHandler = { handler: handler as JobHandler<any> };
    if (meta?.description !== undefined) stored.description = meta.description;
    this.handlers.set(key, stored);
  }

  get(name: string): JobHandler<any> {
    const entry = this.handlers.get(name);
    if (entry === undefined)
      throw new Error(`No job handler registered for "${name}".`);
    return entry.handler;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  list(): JobRegistration[] {
    return [...this.handlers.entries()].map(([name, entry]) =>
      entry.description === undefined
        ? { name }
        : { name, description: entry.description },
    );
  }
}
