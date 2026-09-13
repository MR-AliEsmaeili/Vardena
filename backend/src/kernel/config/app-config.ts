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

/**
 * Authentication + session configuration (docs/security.md §2, ADR-0007, OQ-06).
 *
 * Defaults match the architectural values documented in `docs/security.md`.
 * All values are tunable per deployment via environment variables — they are
 * NOT business rules and must never be hardcoded anywhere else.
 */
export interface AuthConfig {
  /** Name of the httpOnly session cookie. */
  cookieName: string;
  /**
   * Whether to set the `Secure` flag on the cookie.
   * Default: true for production, false for development/test (so local HTTP works).
   */
  cookieSecure: boolean;
  /** SameSite directive for the cookie (Lax per ADR-0007). */
  cookieSameSite: 'lax' | 'strict' | 'none';
  /** Path for the cookie (root per ADR-0007). */
  cookiePath: string;
  /**
   * Sliding (idle) session expiry in milliseconds.
   * Default 30 minutes (security.md §2).
   */
  sessionIdleTimeoutMs: number;
  /**
   * Absolute session expiry in milliseconds (hard cap).
   * Default 12 hours (security.md §2).
   */
  sessionAbsoluteTimeoutMs: number;
  /** Strict rate limit applied to the login endpoint. */
  loginRateLimit: RateLimitConfig;
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
  auth: AuthConfig;
  /**
   * The single organization this deployment is confined to, or `null` when no
   * deployment pin is configured (ADR-0025). When set, every request that
   * names an organization must name this one; any other id answers 404.
   */
  deploymentOrganizationId: string | null;
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
 * Optional deployment organization pin (ADR-0025). Empty/unset ⇒ structural
 * scoping only (ADR-0021): organizationId stays a caller-supplied parameter.
 * Set ⇒ every request that names an organization must name this one.
 * Kept inline (no import from kernel/ids) so config validation stays
 * dependency-free and can run before anything else boots.
 */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function parseDeploymentOrganizationId(
  raw: string | undefined,
  errors: string[],
): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = raw.trim();
  if (!ULID_PATTERN.test(value)) {
    errors.push(
      'DEPLOYMENT_ORGANIZATION_ID must be a valid ULID when set (got an invalid value).',
    );
    return null;
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

  // ----- Auth configuration (security.md §2, ADR-0007, OQ-06) -----
  const cookieName = env['AUTH_COOKIE_NAME']?.trim() || 'vardena_session';
  const cookiePath = env['AUTH_COOKIE_PATH']?.trim() || '/';
  const cookieSameSiteRaw =
    env['AUTH_COOKIE_SAME_SITE']?.trim().toLowerCase() || 'lax';
  let cookieSameSite: 'lax' | 'strict' | 'none' = 'lax';
  if (!['lax', 'strict', 'none'].includes(cookieSameSiteRaw)) {
    errors.push(
      `AUTH_COOKIE_SAME_SITE must be one of lax|strict|none (got ${JSON.stringify(env['AUTH_COOKIE_SAME_SITE'])}).`,
    );
  } else {
    cookieSameSite = cookieSameSiteRaw as 'lax' | 'strict' | 'none';
  }
  const cookieSecure =
    parseBoolean(env['AUTH_COOKIE_SECURE'], 'AUTH_COOKIE_SECURE', errors) ??
    nodeEnv === 'production';

  const idleTimeoutMs =
    parsePositiveInt(
      env['AUTH_SESSION_IDLE_TIMEOUT_MS'],
      'AUTH_SESSION_IDLE_TIMEOUT_MS',
      errors,
    ) ?? 30 * 60 * 1000; // 30 minutes (security.md §2)
  const absoluteTimeoutMs =
    parsePositiveInt(
      env['AUTH_SESSION_ABSOLUTE_TIMEOUT_MS'],
      'AUTH_SESSION_ABSOLUTE_TIMEOUT_MS',
      errors,
    ) ?? 12 * 60 * 60 * 1000; // 12 hours (security.md §2)

  const loginWindowMs =
    parsePositiveInt(
      env['AUTH_LOGIN_RATE_LIMIT_WINDOW_MS'],
      'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS',
      errors,
    ) ?? 15 * 60 * 1000; // 15 minutes
  const loginMax =
    parsePositiveInt(
      env['AUTH_LOGIN_RATE_LIMIT_MAX'],
      'AUTH_LOGIN_RATE_LIMIT_MAX',
      errors,
    ) ?? 10; // 10 attempts per window

  const deploymentOrganizationId = parseDeploymentOrganizationId(
    env['DEPLOYMENT_ORGANIZATION_ID'],
    errors,
  );

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
    auth: {
      cookieName,
      cookieSecure,
      cookieSameSite,
      cookiePath,
      sessionIdleTimeoutMs: idleTimeoutMs,
      sessionAbsoluteTimeoutMs: absoluteTimeoutMs,
      loginRateLimit: { windowMs: loginWindowMs, max: loginMax },
    },
    deploymentOrganizationId,
  };
}
