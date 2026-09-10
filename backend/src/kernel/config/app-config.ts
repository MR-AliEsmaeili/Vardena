/**
 * Typed application configuration (security.md section 6: config schema).
 *
 * All environment-specific values come from environment variables and are
 * validated once at startup. `loadAppConfig()` throws a single descriptive
 * error listing every problem so misconfigured deployments fail fast with a
 * clear message instead of booting into a broken state.
 *
 * Rules for future agents:
 * - Add new keys here AND to `.env.example` AND to the README config table.
 * - Secrets stay placeholders-only in `.env.example`; never commit values.
 * - Keep this module dependency-free (pure TypeScript) so it can run before
 *   Nest boots and stay trivially unit-testable.
 */

export const APP_CONFIG = Symbol('APP_CONFIG');

export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RateLimitConfig {
  /** Fixed window length in milliseconds. */
  windowMs: number;
  /** Max requests per window per IP. */
  max: number;
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  appVersion: string;
  logLevel: LogLevel;
  swaggerEnabled: boolean;
  /** Allowed browser origins for CORS; empty = same-origin only. */
  corsOrigins: string[];
  trustProxy: boolean;
  rateLimit: RateLimitConfig;
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function parseBoolean(
  raw: string | undefined,
  key: string,
  errors: string[],
): boolean | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  errors.push(`${key} must be true/false (got ${JSON.stringify(raw)}).`);
  return undefined;
}

function parsePort(
  raw: string | undefined,
  errors: string[],
): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(
      `PORT must be an integer between 1 and 65535 (got ${JSON.stringify(raw)}).`,
    );
    return undefined;
  }
  return port;
}

function parsePositiveInt(
  raw: string | undefined,
  key: string,
  errors: string[],
): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(
      `${key} must be a positive integer (got ${JSON.stringify(raw)}).`,
    );
    return undefined;
  }
  return value;
}

function parseCorsOrigins(raw: string | undefined, errors: string[]): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const origin = part.trim().replace(/\/+$/, '');
    if (origin === '') continue;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      errors.push(
        `CORS_ORIGINS contains an invalid URL: ${JSON.stringify(part.trim())}.`,
      );
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push(
        `CORS_ORIGINS entries must be http(s) URLs (got ${JSON.stringify(origin)}).`,
      );
      continue;
    }
    origins.push(url.origin);
  }
  return origins;
}

function parseDatabaseUrl(
  raw: string | undefined,
  errors: string[],
): string | undefined {
  if (raw === undefined || raw.trim() === '') {
    errors.push('DATABASE_URL is required (postgresql:// connection string).');
    return undefined;
  }
  const value = raw.trim();
  if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
    errors.push('DATABASE_URL must be a postgresql:// connection string.');
    return undefined;
  }
  return value;
}

/**
 * Load and validate configuration from the given env mapping.
 * @throws Error listing every invalid/missing value.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];

  const nodeEnvRaw = env['NODE_ENV']?.trim() || 'development';
  let nodeEnv: NodeEnv = 'development';
  if ((NODE_ENVS as readonly string[]).includes(nodeEnvRaw)) {
    nodeEnv = nodeEnvRaw as NodeEnv;
  } else {
    errors.push(
      `NODE_ENV must be one of ${NODE_ENVS.join(', ')} (got ${JSON.stringify(env['NODE_ENV'])}).`,
    );
  }

  const logLevelRaw = env['LOG_LEVEL']?.trim().toLowerCase();
  let logLevel: LogLevel = nodeEnv === 'development' ? 'debug' : 'info';
  if (logLevelRaw !== undefined && logLevelRaw !== '') {
    if ((LOG_LEVELS as readonly string[]).includes(logLevelRaw)) {
      logLevel = logLevelRaw as LogLevel;
    } else {
      errors.push(
        `LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got ${JSON.stringify(env['LOG_LEVEL'])}).`,
      );
    }
  }

  const port = parsePort(env['PORT'], errors) ?? 3000;
  const databaseUrl = parseDatabaseUrl(env['DATABASE_URL'], errors);
  const corsOrigins = parseCorsOrigins(env['CORS_ORIGINS'], errors);
  const swaggerEnabled =
    parseBoolean(env['SWAGGER_ENABLED'], 'SWAGGER_ENABLED', errors) ??
    nodeEnv !== 'production';
  const trustProxy =
    parseBoolean(env['TRUST_PROXY'], 'TRUST_PROXY', errors) ?? false;
  const windowMs =
    parsePositiveInt(
      env['RATE_LIMIT_WINDOW_MS'],
      'RATE_LIMIT_WINDOW_MS',
      errors,
    ) ?? 60_000;
  const max =
    parsePositiveInt(env['RATE_LIMIT_MAX'], 'RATE_LIMIT_MAX', errors) ?? 300;

  if (errors.length > 0) {
    throw new Error(
      `Invalid configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }

  return {
    nodeEnv,
    port,
    // Guaranteed by the errors check above (missing URL pushes an error).
    databaseUrl: databaseUrl as string,
    appVersion: env['APP_VERSION']?.trim() || '0.0.0-dev',
    logLevel,
    swaggerEnabled,
    corsOrigins,
    trustProxy,
    rateLimit: { windowMs, max },
  };
}
