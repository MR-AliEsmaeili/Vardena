import { assertWorkerHealthy } from './worker-health.js';

try {
  assertWorkerHealthy();
} catch {
  process.stderr.write(
    'Worker is not ready: missing, stale or failed database heartbeat.\n',
  );
  process.exitCode = 1;
}
