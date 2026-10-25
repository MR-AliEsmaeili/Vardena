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

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

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

export type LicenseProviderName = 'persistent' | 'local-development';

export interface LicensingConfig {
  /**
   * Which licensing authority evaluates this installation (L-02).
   *
   * `persistent` (the default) reads the license this installation actually
   * activated; `local-development` reads the values below. Selection is
   * explicit configuration and is NEVER derived from NODE_ENV: a development
   * machine that configures nothing is unlicensed exactly like production.
   */
  provider: LicenseProviderName;
  /**
   * Accepted licensing-authority Ed25519 PUBLIC keys (PEM or base64 DER).
   * Only public key material ever reaches the server; the private signing key
   * belongs to the issuing authority and is never stored or logged here.
   * More than one key is allowed so an authority key can be rotated without
   * invalidating licenses signed by the previous one.
   */
  signingPublicKeys: string[];
  /**
   * Explicit deployment gate for official signed Developer Licenses. Disabled
   * by default in every NODE_ENV; setting NODE_ENV never changes it.
   */
  developerLicensesEnabled: boolean;
  /** Dedicated developer-authority public keys; never shared implicitly. */
  developerSigningPublicKeys: string[];
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  validFrom: Date;
  validUntil: Date | null;
  organizationLimit: number | null;
  userLimit: number | null;
  moduleEntitlements: string[];
  featureEntitlements: string[];
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
  /**
   * Initial password for provisioning the bootstrap system administrator on a
   * fresh installation (`npm run bootstrap:system-admin`). Optional at config
   * load so already-provisioned installations and runtime processes do not
   * require a bootstrap credential; required when a new bootstrap
   * administrator must be created.
   */
  bootstrapSystemAdminPassword: string | null;
  /** Explicit provider configuration; never inferred from NODE_ENV or identity. */
  licensing: LicensingConfig;
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

function parseBootstrapSystemAdminPassword(
  raw: string | undefined,
  errors: string[],
): string | null {
  if (raw === undefined || raw === '') return null;
  if (raw.trim().length === 0) {
    errors.push('BOOTSTRAP_SYSTEM_ADMIN_PASSWORD cannot be blank when set.');
    return null;
  }
  if (raw.length < MIN_PASSWORD_LENGTH) {
    errors.push(
      `BOOTSTRAP_SYSTEM_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters when set.`,
    );
    return null;
  }
  if (raw.length > MAX_PASSWORD_LENGTH) {
    errors.push(
      `BOOTSTRAP_SYSTEM_ADMIN_PASSWORD must be at most ${MAX_PASSWORD_LENGTH} characters when set.`,
    );
    return null;
  }
  if (raw.trim().toUpperCase() === 'CHANGE_ME') {
    errors.push(
      'BOOTSTRAP_SYSTEM_ADMIN_PASSWORD must not use the placeholder value CHANGE_ME.',
    );
    return null;
  }
  return raw;
}

function parseLicenseLimit(
  raw: string | undefined,
  key: string,
  errors: string[],
): number | null {
  if (
    raw === undefined ||
    raw.trim() === '' ||
    raw.trim().toLowerCase() === 'unlimited'
  )
    return null;
  return parsePositiveInt(raw, key, errors) ?? null;
}

function parseIsoDate(
  raw: string | undefined,
  key: string,
  fallback: Date | null,
  errors: string[],
): Date | null {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (raw.trim().toLowerCase() === 'perpetual' && key === 'LICENSE_VALID_UNTIL')
    return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    errors.push(
      `${key} must be an ISO-8601 date-time${key === 'LICENSE_VALID_UNTIL' ? ' or perpetual' : ''}.`,
    );
    return fallback;
  }
  return parsed;
}

function parseCodes(raw: string | undefined, defaults: string[]): string[] {
  if (raw === undefined || raw.trim() === '') return defaults;
  return [
    ...new Set(
      raw
        .split(',')
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
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
  const bootstrapSystemAdminPassword = parseBootstrapSystemAdminPassword(
    env['BOOTSTRAP_SYSTEM_ADMIN_PASSWORD'],
    errors,
  );

  // Explicit local provider configuration. It is selected by name, never by
  // NODE_ENV, administrator identity, role, or email.
  const licenseProviderRaw = env['LICENSE_PROVIDER']?.trim() || 'persistent';
  if (
    licenseProviderRaw !== 'persistent' &&
    licenseProviderRaw !== 'local-development'
  ) {
    errors.push(
      'LICENSE_PROVIDER must be persistent or local-development (got ' +
        `${JSON.stringify(env['LICENSE_PROVIDER'])}).`,
    );
  }
  const licenseSigningPublicKeys = (env['LICENSE_SIGNING_PUBLIC_KEYS'] ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');
  const developerLicensesEnabled =
    parseBoolean(
      env['DEVELOPER_LICENSES_ENABLED'],
      'DEVELOPER_LICENSES_ENABLED',
      errors,
    ) ?? false;
  const developerSigningPublicKeys = (
    env['DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS'] ?? ''
  )
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');
  if (developerLicensesEnabled && developerSigningPublicKeys.length === 0) {
    errors.push(
      'DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS must contain at least one trusted developer public key when DEVELOPER_LICENSES_ENABLED=true.',
    );
  }
  const licenseStatusRaw =
    env['LICENSE_STATUS']?.trim().toUpperCase() || 'ACTIVE';
  if (!['ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(licenseStatusRaw)) {
    errors.push('LICENSE_STATUS must be ACTIVE, EXPIRED, or SUSPENDED.');
  }
  const licenseValidFrom = parseIsoDate(
    env['LICENSE_VALID_FROM'],
    'LICENSE_VALID_FROM',
    new Date('2020-01-01T00:00:00.000Z'),
    errors,
  )!;
  const licenseValidUntil = parseIsoDate(
    env['LICENSE_VALID_UNTIL'],
    'LICENSE_VALID_UNTIL',
    null,
    errors,
  );
  if (licenseValidUntil !== null && licenseValidUntil <= licenseValidFrom) {
    errors.push('LICENSE_VALID_UNTIL must be later than LICENSE_VALID_FROM.');
  }
  const licenseOrganizationLimit = parseLicenseLimit(
    env['LICENSE_ORGANIZATION_LIMIT'],
    'LICENSE_ORGANIZATION_LIMIT',
    errors,
  );
  const licenseUserLimit = parseLicenseLimit(
    env['LICENSE_USER_LIMIT'],
    'LICENSE_USER_LIMIT',
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
    bootstrapSystemAdminPassword,
    licensing: {
      provider: licenseProviderRaw as LicenseProviderName,
      signingPublicKeys: licenseSigningPublicKeys,
      developerLicensesEnabled,
      developerSigningPublicKeys,
      status: licenseStatusRaw as LicensingConfig['status'],
      validFrom: licenseValidFrom,
      validUntil: licenseValidUntil,
      organizationLimit: licenseOrganizationLimit,
      userLimit: licenseUserLimit,
      moduleEntitlements: parseCodes(env['LICENSE_MODULE_ENTITLEMENTS'], [
        'accounting',
        'documents',
        'inventory',
        'organization',
        'rbac',
        'users',
        'workflow',
      ]),
      featureEntitlements: parseCodes(env['LICENSE_FEATURE_ENTITLEMENTS'], []),
    },
  };
}
