import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const WORKER_HEALTH_FILE = join(tmpdir(), 'vardena-worker-health.json');
export const WORKER_HEALTH_INTERVAL_MS = 10_000;
export const WORKER_HEALTH_MAX_AGE_MS = 30_000;

/** Local runtime telemetry only: elapsed epoch milliseconds, not a BusinessDate/API field. */
interface WorkerHealthSignal {
  pid: number;
  checkedAtMs: number;
  databaseUp: boolean;
}

/** No Nest/Prisma import: the Docker probe reads evidence from the actual worker. */
export function assertWorkerHealthy(path = WORKER_HEALTH_FILE): void {
  const signal = JSON.parse(
    readFileSync(path, 'utf8'),
  ) as Partial<WorkerHealthSignal> | null;
  if (
    signal === null ||
    typeof signal !== 'object' ||
    typeof signal.pid !== 'number' ||
    !Number.isSafeInteger(signal.pid) ||
    signal.pid <= 0 ||
    typeof signal.checkedAtMs !== 'number' ||
    !Number.isSafeInteger(signal.checkedAtMs) ||
    signal.databaseUp !== true
  ) {
    throw new Error('Invalid worker health signal');
  }
  const age = Date.now() - signal.checkedAtMs;
  if (age < 0 || age >= WORKER_HEALTH_MAX_AGE_MS) {
    throw new Error('Stale worker health signal');
  }
  // Supplement the DB-backed heartbeat, never substitute PID-only liveness.
  process.kill(signal.pid, 0);
}

/** Serial DB probes; a hung probe/event loop cannot keep refreshing the signal. */
export class WorkerHealth {
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly temporaryPath: string;

  constructor(
    private readonly checkDatabase: () => Promise<void>,
    private readonly reportFailure: () => void,
    private readonly path = WORKER_HEALTH_FILE,
  ) {
    this.temporaryPath = `${path}.${process.pid}.tmp`;
  }

  /** Called only after the application context (including its DB startup gate) is ready. */
  async start(): Promise<void> {
    this.stop();
    this.running = true;
    await this.refresh();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    rmSync(this.path, { force: true });
    rmSync(this.temporaryPath, { force: true });
  }

  private async refresh(): Promise<void> {
    // Date the beginning, not the completion: a slow query must not rejuvenate old evidence.
    const checkedAtMs = Date.now();
    let databaseUp = false;
    try {
      await this.checkDatabase();
      databaseUp = true;
    } catch {
      if (this.running) this.reportFailure();
    }
    // In-flight queries are allowed to settle, but cannot publish after shutdown.
    if (!this.running) return;
    try {
      const signal: WorkerHealthSignal = {
        pid: process.pid,
        checkedAtMs,
        databaseUp,
      };
      writeFileSync(this.temporaryPath, JSON.stringify(signal), {
        mode: 0o600,
      });
      renameSync(this.temporaryPath, this.path);
    } catch {
      // An unwritable heartbeat must fail closed (the previous signal expires).
      this.reportFailure();
    }
    this.timer = setTimeout(
      () => void this.refresh(),
      WORKER_HEALTH_INTERVAL_MS,
    );
  }
}
