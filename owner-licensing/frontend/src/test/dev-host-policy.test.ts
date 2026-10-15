// Deterministic config/middleware checks: no server, port or build is started.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  devHostPolicy,
  isApprovedHost,
  strictHostGuard,
} from '../../dev-host-policy';

describe('Owner development and preview host allowlisting', () => {
  it('binds only loopback by default and accepts local development', () => {
    const policy = devHostPolicy({});
    expect(policy.host).toBe('127.0.0.1');
    for (const host of ['localhost:5174', '127.0.0.1:4174', '[::1]:5174'])
      expect(isApprovedHost(host, policy.allowedHosts)).toBe(true);
    for (const host of [
      'evil.example',
      '192.0.2.1',
      'arbitrary.localhost',
      'localhost.evil.example',
      undefined,
    ])
      expect(isApprovedHost(host, policy.allowedHosts)).toBe(false);
  });
  it('permits only an explicitly configured remote hostname, never its suffix/prefix lookalikes', () => {
    const policy = devHostPolicy({
      OWNER_VITE_BIND_HOST: '0.0.0.0',
      OWNER_VITE_ALLOWED_HOSTS: '5174-demo.e2b.app, owner-dev.example',
    });
    expect(policy.host).toBe('0.0.0.0');
    expect(isApprovedHost('5174-demo.e2b.app:5174', policy.allowedHosts)).toBe(
      true,
    );
    expect(isApprovedHost('OWNER-DEV.EXAMPLE:4174', policy.allowedHosts)).toBe(
      true,
    );
    for (const host of [
      'other.e2b.app',
      'evil.owner-dev.example',
      'owner-dev.example.evil',
      'owner-dev.example/evil',
      'owner-dev.example:99999',
    ])
      expect(isApprovedHost(host, policy.allowedHosts)).toBe(false);
  });
  it('fails closed on broad/invalid allowlists and accidental network exposure', () => {
    for (const value of [
      'true',
      '*',
      '.example.com',
      'https://dev.example',
      'dev.example:5174',
      'dev.example/path',
      'dev.example,*.example.com',
    ])
      expect(() => devHostPolicy({ OWNER_VITE_ALLOWED_HOSTS: value })).toThrow(
        /OWNER_VITE_/,
      );
    expect(() => devHostPolicy({ OWNER_VITE_BIND_HOST: '0.0.0.0' })).toThrow(
      /OWNER_VITE_/,
    );
    expect(() => devHostPolicy({ OWNER_VITE_BIND_HOST: 'true' })).toThrow(
      /OWNER_VITE_/,
    );
  });
  it.each(['configureServer', 'configurePreviewServer'] as const)(
    'enforces actual %s middleware for approved/rejected Host headers',
    (hook) => {
      const policy = devHostPolicy({
        OWNER_VITE_ALLOWED_HOSTS: 'owner-dev.example',
      });
      const plugin = strictHostGuard(policy.allowedHosts);
      type Guard = (
        req: { headers: { host?: string } },
        res: { statusCode: number; end: (s: string) => void },
        next: () => void,
      ) => void;
      let middleware: Guard | undefined;
      const register = plugin[hook] as (server: unknown) => void;
      register({
        middlewares: {
          use: (guard: Guard) => {
            middleware = guard;
          },
        },
      });
      for (const [host, expected] of [
        ['evil.example', 403],
        ['owner-dev.example:5174', 200],
      ] as const) {
        const res = { statusCode: 200, end: () => {} };
        let passed = false;
        middleware!({ headers: { host } }, res, () => {
          passed = true;
        });
        expect(res.statusCode).toBe(expected);
        expect(passed).toBe(expected === 200);
      }
    },
  );
  it('wires both server configurations to the validated policy and preserves the API proxy', () => {
    const config = readFileSync('vite.config.ts', 'utf8');
    expect(config.match(/\.\.\.hosts/g)).toHaveLength(2);
    expect(config).not.toMatch(/allowedHosts:\s*true|host:\s*true/);
    expect(config).toContain('strictHostGuard(hosts.allowedHosts)');
    expect(config).toContain("'/api'");
    expect(config).toContain('target: apiProxyTarget');
  });
});
