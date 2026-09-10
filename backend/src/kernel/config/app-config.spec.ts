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
    });
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
