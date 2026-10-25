import { describe, expect, it } from 'vitest';
import { loadAppConfig } from './app-config.js';

const VALID_DB = 'postgresql://vardena:secret@localhost:5432/vardena';

describe('loadAppConfig', () => {
  it('loads a full valid configuration', () => {
    const config = loadAppConfig({
      NODE_ENV: 'production',
      PORT: '4000',
      DATABASE_URL: VALID_DB,
      APP_VERSION: '1.2.3',
      LOG_LEVEL: 'warn',
      SWAGGER_ENABLED: 'false',
      CORS_ORIGINS: 'https://erp.example.com, http://localhost:5173/',
      TRUST_PROXY: 'true',
      RATE_LIMIT_WINDOW_MS: '1000',
      RATE_LIMIT_MAX: '10',
    });

    expect(config).toEqual({
      nodeEnv: 'production',
      port: 4000,
      databaseUrl: VALID_DB,
      appVersion: '1.2.3',
      logLevel: 'warn',
      swaggerEnabled: false,
      corsOrigins: ['https://erp.example.com', 'http://localhost:5173'],
      trustProxy: true,
      rateLimit: { windowMs: 1000, max: 10 },
      auth: {
        cookieName: 'vardena_session',
        cookiePath: '/',
        cookieSameSite: 'lax',
        cookieSecure: true,
        sessionIdleTimeoutMs: 30 * 60 * 1000,
        sessionAbsoluteTimeoutMs: 12 * 60 * 60 * 1000,
        loginRateLimit: { windowMs: 15 * 60 * 1000, max: 10 },
      },
      deploymentOrganizationId: null,
      bootstrapSystemAdminPassword: null,
      licensing: {
        provider: 'persistent',
        signingPublicKeys: [],
        developerLicensesEnabled: false,
        developerSigningPublicKeys: [],
        status: 'ACTIVE',
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: null,
        organizationLimit: null,
        userLimit: null,
        moduleEntitlements: [
          'accounting',
          'documents',
          'inventory',
          'organization',
          'rbac',
          'users',
          'workflow',
        ],
        featureEntitlements: [],
      },
    });
  });

  it('keeps official Developer Licenses disabled in every environment unless explicitly allowed', () => {
    for (const nodeEnv of ['development', 'test', 'production'] as const) {
      const config = loadAppConfig({
        DATABASE_URL: VALID_DB,
        NODE_ENV: nodeEnv,
      });
      expect(config.licensing.developerLicensesEnabled).toBe(false);
      expect(config.licensing.developerSigningPublicKeys).toEqual([]);
    }
  });

  it('requires a dedicated public trust list when Developer Licenses are enabled', () => {
    expect(() =>
      loadAppConfig({
        DATABASE_URL: VALID_DB,
        DEVELOPER_LICENSES_ENABLED: 'true',
      }),
    ).toThrow(/DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS/);

    const config = loadAppConfig({
      DATABASE_URL: VALID_DB,
      DEVELOPER_LICENSES_ENABLED: 'true',
      DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS: 'dev-key:synthetic-key-material',
    });
    expect(config.licensing.developerLicensesEnabled).toBe(true);
    expect(config.licensing.developerSigningPublicKeys).toEqual([
      'dev-key:synthetic-key-material',
    ]);
  });

  it('defaults the deployment organization pin to unset', () => {
    const config = loadAppConfig({ DATABASE_URL: VALID_DB });
    expect(config.deploymentOrganizationId).toBeNull();
  });

  it('accepts a well-formed deployment organization pin (ULID)', () => {
    const pin = '01M2D8QVMY3ZQ1J5APCH7S5J00';
    const config = loadAppConfig({
      DATABASE_URL: VALID_DB,
      DEPLOYMENT_ORGANIZATION_ID: pin,
    });
    expect(config.deploymentOrganizationId).toBe(pin);
  });

  it('rejects a deployment organization pin that is not a ULID', () => {
    expect(() =>
      loadAppConfig({
        DATABASE_URL: VALID_DB,
        DEPLOYMENT_ORGANIZATION_ID: 'not-a-ulid',
      }),
    ).toThrow(/DEPLOYMENT_ORGANIZATION_ID must be a valid ULID/);
  });

  it('defaults the bootstrap system administrator password to unset', () => {
    const config = loadAppConfig({ DATABASE_URL: VALID_DB });
    expect(config.bootstrapSystemAdminPassword).toBeNull();
  });

  it('accepts a valid bootstrap system administrator password', () => {
    const config = loadAppConfig({
      DATABASE_URL: VALID_DB,
      BOOTSTRAP_SYSTEM_ADMIN_PASSWORD: 'initial-admin-secret-9',
    });
    expect(config.bootstrapSystemAdminPassword).toBe('initial-admin-secret-9');
  });

  it('rejects weak, blank, or placeholder bootstrap system administrator passwords without echoing the secret', () => {
    expect(() =>
      loadAppConfig({
        DATABASE_URL: VALID_DB,
        BOOTSTRAP_SYSTEM_ADMIN_PASSWORD: '1',
      }),
    ).toThrow(/BOOTSTRAP_SYSTEM_ADMIN_PASSWORD must be at least 8 characters/);

    expect(() =>
      loadAppConfig({
        DATABASE_URL: VALID_DB,
        BOOTSTRAP_SYSTEM_ADMIN_PASSWORD: '        ',
      }),
    ).toThrow(/BOOTSTRAP_SYSTEM_ADMIN_PASSWORD cannot be blank/);

    expect(() =>
      loadAppConfig({
        DATABASE_URL: VALID_DB,
        BOOTSTRAP_SYSTEM_ADMIN_PASSWORD: 'CHANGE_ME',
      }),
    ).toThrow(/BOOTSTRAP_SYSTEM_ADMIN_PASSWORD must not use the placeholder/);

    let message = '';
    try {
      loadAppConfig({
        DATABASE_URL: VALID_DB,
        BOOTSTRAP_SYSTEM_ADMIN_PASSWORD: 'short',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('BOOTSTRAP_SYSTEM_ADMIN_PASSWORD');
    expect(message).not.toContain('short');
  });

  it('applies development defaults', () => {
    const config = loadAppConfig({ DATABASE_URL: VALID_DB });

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.appVersion).toBe('0.0.0-dev');
    expect(config.logLevel).toBe('debug');
    expect(config.swaggerEnabled).toBe(true);
    expect(config.corsOrigins).toEqual([]);
    expect(config.trustProxy).toBe(false);
    expect(config.rateLimit).toEqual({ windowMs: 60_000, max: 300 });
    // In development, cookieSecure defaults to false to allow HTTP local dev.
    expect(config.auth.cookieSecure).toBe(false);
    expect(config.auth.cookieName).toBe('vardena_session');
    expect(config.auth.cookieSameSite).toBe('lax');
    expect(config.auth.sessionIdleTimeoutMs).toBe(30 * 60 * 1000);
    expect(config.auth.sessionAbsoluteTimeoutMs).toBe(12 * 60 * 60 * 1000);
    expect(config.auth.loginRateLimit).toEqual({
      windowMs: 15 * 60 * 1000,
      max: 10,
    });
  });

  it('disables swagger and info-logging by default outside development', () => {
    const config = loadAppConfig({
      NODE_ENV: 'production',
      DATABASE_URL: VALID_DB,
    });
    expect(config.swaggerEnabled).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadAppConfig({})).toThrow(/DATABASE_URL is required/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadAppConfig({ DATABASE_URL: 'mysql://x' })).toThrow(
      /must be a postgresql:\/\//,
    );
  });

  it('rejects invalid NODE_ENV, PORT, LOG_LEVEL and rate limit values together', () => {
    let message = '';
    try {
      loadAppConfig({
        NODE_ENV: 'staging',
        PORT: 'abc',
        DATABASE_URL: VALID_DB,
        LOG_LEVEL: 'verbose',
        RATE_LIMIT_MAX: '0',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('NODE_ENV');
    expect(message).toContain('PORT');
    expect(message).toContain('LOG_LEVEL');
    expect(message).toContain('RATE_LIMIT_MAX');
  });

  it('rejects invalid CORS origins', () => {
    expect(() =>
      loadAppConfig({ DATABASE_URL: VALID_DB, CORS_ORIGINS: 'not-a-url' }),
    ).toThrow(/CORS_ORIGINS/);
    expect(() =>
      loadAppConfig({
        DATABASE_URL: VALID_DB,
        CORS_ORIGINS: 'ftp://x.example',
      }),
    ).toThrow(/http\(s\)/);
  });

  it('rejects invalid booleans', () => {
    expect(() =>
      loadAppConfig({ DATABASE_URL: VALID_DB, SWAGGER_ENABLED: 'yes' }),
    ).toThrow(/SWAGGER_ENABLED/);
  });
});
