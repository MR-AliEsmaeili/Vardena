/**
 * Entrypoint guard shared by the API (`main.ts`), worker (`worker.ts`), and
 * post-migration installation bootstrap. Failures happen before DI exists, so
 * they are logged as a single
 * JSON fatal line on stderr (no secrets: config errors name keys, never
 * values; driver errors are driver-formatted and contain no credentials).
 */
export async function runEntrypoint(
  name: 'api' | 'worker' | 'system-bootstrap',
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'fatal',
        context: 'Bootstrap',
        service: `vardena-${name}`,
        message: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  }
}
