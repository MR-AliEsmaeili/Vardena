import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/** Server-only configuration: none of these variables are VITE_* client data. */
export function devHostPolicy(env: Record<string, string | undefined>) {
  const extras = (env['OWNER_VITE_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .filter((host) => host.trim() !== '')
    .map((host) => {
      const value = host.trim().toLowerCase();
      if (
        ['true', 'false'].includes(value) ||
        value.length > 253 ||
        (!isIP(value) &&
          !value
            .split('.')
            .every((label) =>
              /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
            ))
      )
        throw new Error(
          'OWNER_VITE_ALLOWED_HOSTS must contain exact hostnames/IPs, not URLs, wildcards or suffixes.',
        );
      return value;
    });
  const host = env['OWNER_VITE_BIND_HOST'] ?? '127.0.0.1';
  if (!isIP(host))
    throw new Error(
      'OWNER_VITE_BIND_HOST must be an explicit interface IP address.',
    );
  if (!['127.0.0.1', '::1'].includes(host) && extras.length === 0)
    throw new Error(
      'Non-loopback binding requires explicit OWNER_VITE_ALLOWED_HOSTS.',
    );
  const allowedHosts = [
    ...new Set(['localhost', '127.0.0.1', '::1', ...extras]),
  ];
  return { host, allowedHosts };
}

export function isApprovedHost(
  header: string | undefined,
  allowedHosts: readonly string[],
): boolean {
  if (!header) return false;
  const match =
    /^(?:\[([a-fA-F0-9:]+)\]|([a-zA-Z0-9.-]+))(?::([0-9]{1,5}))?$/.exec(header);
  if (
    !match ||
    (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535))
  )
    return false;
  const hostname = (match[1] ?? match[2])!.toLowerCase();
  return allowedHosts.includes(hostname);
}

/** Also covers Vite's implicit IP allowances and HTTPS host-check bypass. */
export function strictHostGuard(allowedHosts: readonly string[]): Plugin {
  const guard = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    if (isApprovedHost(req.headers.host, allowedHosts)) {
      next();
      return;
    }
    res.statusCode = 403;
    res.end('Unapproved Owner development/preview host.');
  };
  return {
    name: 'owner-exact-host-allowlist',
    configureServer(server) {
      server.middlewares.use(guard);
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard);
    },
  };
}
