import 'dotenv/config';
import { loadAppConfig } from './kernel/config/app-config.js';
import { runEntrypoint } from './kernel/bootstrap.js';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
} from './tools/development-license-authority.js';

/**
 * Development/test license issuing CLI (L-02).
 *
 *   npm run license:keygen
 *     → prints a fresh Ed25519 authority key pair. Put the PUBLIC key in
 *       `LICENSE_SIGNING_PUBLIC_KEYS`; keep the private key outside the
 *       application (a password manager, the CI secret store, …).
 *
 *   LICENSE_SIGNING_PRIVATE_KEY=<base64> npm run license:issue -- \
 *     --installation 01J... [--customer-name "Acme"] [--valid-until 2027-01-01] \
 *     [--organizations 3] [--users 25] [--modules organization,users,rbac] \
 *     [--status ACTIVE]
 *     → prints the signed license code to paste into
 *       `POST /api/v1/license/activate`.
 *
 * It refuses to run with `NODE_ENV=production`: a production license must be
 * issued by the commercial authority, not by a copy of the application.
 * The installation id is NOT invented here — it is the id the target
 * installation reports in `GET /api/v1/license/current`.
 */
async function issueDevelopmentLicense(): Promise<void> {
  const config = loadAppConfig();
  if (config.nodeEnv === 'production') {
    throw new Error(
      'The development license authority is disabled in production. Obtain a license from the commercial authority instead.',
    );
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.has('keygen')) {
    const pair = generateAuthorityKeyPair();
    process.stdout.write(
      [
        'Ed25519 licensing authority key pair (development/test only)',
        '',
        `LICENSE_SIGNING_PUBLIC_KEYS=${pair.publicKey}`,
        '',
        'Private key (NEVER give this to the application or the frontend):',
        pair.privateKey,
        '',
      ].join('\n'),
    );
    return;
  }

  const privateKey = process.env['LICENSE_SIGNING_PRIVATE_KEY']?.trim();
  if (privateKey === undefined || privateKey === '') {
    throw new Error(
      'LICENSE_SIGNING_PRIVATE_KEY is required (run "npm run license:keygen" first).',
    );
  }
  const installationId = args.get('installation');
  if (installationId === undefined) {
    throw new Error(
      '--installation <installationId> is required; read it from GET /api/v1/license/current on the target installation.',
    );
  }

  const { code, payload } = issueLicenseCode(
    {
      installationId,
      ...optional('customerId', args.get('customer')),
      ...optional('customerName', args.get('customer-name')),
      ...optional('status', args.get('status') as 'ACTIVE' | undefined),
      ...optional('validFrom', dateArg(args.get('valid-from'))),
      ...optional('validUntil', dateArg(args.get('valid-until'))),
      ...optional('organizationLimit', intArg(args.get('organizations'))),
      ...optional('userLimit', intArg(args.get('users'))),
      ...optional('moduleEntitlements', listArg(args.get('modules'))),
      ...optional('featureEntitlements', listArg(args.get('features'))),
    },
    privateKey,
  );

  process.stdout.write(
    [
      `Installation : ${payload.installationId}`,
      `License      : ${payload.licenseId}`,
      `Customer     : ${payload.customerId} (${payload.customerName})`,
      `Status       : ${payload.status}`,
      `Valid        : ${payload.validFrom.toISOString()} → ${payload.validUntil?.toISOString() ?? 'perpetual'}`,
      `Limits       : organizations=${payload.organizationLimit ?? 'unlimited'} users=${payload.userLimit ?? 'unlimited'}`,
      `Modules      : ${payload.moduleEntitlements.join(', ')}`,
      '',
      code,
      '',
    ].join('\n'),
  );
}

function parseArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args.set(name, 'true');
    } else {
      args.set(name, next);
      index += 1;
    }
  }
  return args;
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function dateArg(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`"${raw}" is not an ISO-8601 date.`);
  }
  return parsed;
}

function intArg(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`"${raw}" is not a positive integer.`);
  }
  return value;
}

function listArg(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code !== '');
}

await runEntrypoint('issue-development-license', issueDevelopmentLicense);
