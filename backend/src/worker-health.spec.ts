import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertWorkerHealthy,
  WorkerHealth,
  WORKER_HEALTH_INTERVAL_MS,
  WORKER_HEALTH_MAX_AGE_MS,
} from './worker-health.js';

// Real temporary files and a real live PID; only database outcomes/time are controlled.
describe('Worker DB-backed health signal', () => {
  let directory: string;
  let path: string;
  const monitors: WorkerHealth[] = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'vardena-worker-health-'));
    path = join(directory, 'health.json');
  });

  afterEach(() => {
    for (const monitor of monitors.splice(0)) monitor.stop();
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  function monitor(check: () => Promise<void>, target = path) {
    const failure = vi.fn();
    const health = new WorkerHealth(check, failure, target);
    monitors.push(health);
    return { health, failure };
  }

  function signal(overrides: Record<string, unknown> = {}) {
    writeFileSync(
      path,
      JSON.stringify({
        pid: process.pid,
        checkedAtMs: Date.now(),
        databaseUp: true,
        ...overrides,
      }),
    );
  }

  it('does not equate a live PID with readiness or publish before the DB probe completes', async () => {
    let ready!: () => void;
    const { health } = monitor(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const starting = health.start();
    expect(() => assertWorkerHealthy(path)).toThrow();
    ready();
    await starting;
    expect(() => assertWorkerHealthy(path)).not.toThrow();
    expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false);
  });

  it('replaces old readiness with failure, then recovers after a successful DB probe', async () => {
    vi.useFakeTimers();
    const check = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('database disconnected'))
      .mockResolvedValue(undefined);
    const { health, failure } = monitor(check);
    await health.start();
    expect(() => assertWorkerHealthy(path)).not.toThrow();
    await vi.advanceTimersByTimeAsync(WORKER_HEALTH_INTERVAL_MS);
    expect(() => assertWorkerHealthy(path)).toThrow();
    expect(failure).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(WORKER_HEALTH_INTERVAL_MS);
    expect(() => assertWorkerHealthy(path)).not.toThrow();
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('discards an inherited signal even if its first probe fails', async () => {
    signal();
    const { health } = monitor(async () => {
      throw new Error('connection refused');
    });
    await health.start();
    expect(() => assertWorkerHealthy(path)).toThrow();
  });

  it('expires a hung probe without starting overlapping probes', async () => {
    vi.useFakeTimers();
    const check = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => new Promise<void>(() => {}));
    const { health } = monitor(check);
    await health.start();
    await vi.advanceTimersByTimeAsync(
      WORKER_HEALTH_INTERVAL_MS + WORKER_HEALTH_MAX_AGE_MS,
    );
    expect(() => assertWorkerHealthy(path)).toThrow();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('does not rejuvenate a slow query by dating its completion', async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    const { health } = monitor(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const starting = health.start();
    await vi.advanceTimersByTimeAsync(WORKER_HEALTH_MAX_AGE_MS);
    ready();
    await starting;
    expect(() => assertWorkerHealthy(path)).toThrow();
  });

  it('removes readiness on shutdown and prevents late probes from publishing again', async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    const check = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            ready = resolve;
          }),
      );
    const { health } = monitor(check);
    await health.start();
    await vi.advanceTimersByTimeAsync(WORKER_HEALTH_INTERVAL_MS);
    health.stop();
    ready();
    await vi.advanceTimersByTimeAsync(WORKER_HEALTH_MAX_AGE_MS);
    expect(existsSync(path)).toBe(false);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('does not report healthy when the signal cannot be written', async () => {
    const target = join(directory, 'missing-directory', 'health.json');
    const { health, failure } = monitor(async () => {}, target);
    await health.start();
    expect(failure).toHaveBeenCalledOnce();
    expect(() => assertWorkerHealthy(target)).toThrow();
  });

  it.each([
    { databaseUp: false },
    { checkedAtMs: Date.now() - WORKER_HEALTH_MAX_AGE_MS },
    { checkedAtMs: Date.now() + 60_000 },
    { checkedAtMs: 'invalid' },
    { pid: -1 },
    { pid: 2_147_483_647 },
    { pid: '1' },
  ])(
    'rejects failed, stale, future, malformed or dead-process evidence: %j',
    (override) => {
      signal(override);
      expect(() => assertWorkerHealthy(path)).toThrow();
    },
  );

  it.each(['null', '{}', '[]', 'not json'])(
    'rejects invalid file contents: %s',
    (content) => {
      writeFileSync(path, content);
      expect(() => assertWorkerHealthy(path)).toThrow();
    },
  );
});
