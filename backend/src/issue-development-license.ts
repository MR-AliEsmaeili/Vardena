import 'dotenv/config';
import { loadAppConfig } from './kernel/config/app-config.js';
import { runEntrypoint } from './kernel/bootstrap.js';
import {
  generateAuthorityKeyPair,
  issueLicenseCode,
  issueLicenseFile,
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
 *     --installation 01J... --customer 01J... --customer-code CUST-... \
 *     [--customer-name "Acme"] [--valid-until 2027-01-01] \
 *     [--organizations 3] [--users 25] [--devices 20] [--modules organization,users,rbac] \
 *     [--status ACTIVE] [--valid-from 2027-01-01] [--operation-id 01J...] \
 *     [--supersedes 01J...] [--key-id 2026-a] [--artifact] [--out license.json]
 *     → prints the signed license FILE (the `vardena-license` envelope around
 *       the `VLIC2` artifact) to paste into `POST /api/v1/license/import`, or
 *       to hand to the customer as a file. `--artifact` prints the bare
 *       artifact instead (the text transport, for the same endpoint); `--out`
 *       writes the chosen payload to a file without printing it.
 *
 *   ... --format v1
 *     → prints the legacy `VLIC1` license code accepted by
 *       `POST /api/v1/license/activate` (compatibility path).
 *
 * It refuses to run with `NODE_ENV=production`: a production license must be
 * issued by the commercial authority, not by a copy of the application.
 * The installation id, customer id, and business customer code are NOT
 * invented here — the installation id is reported in
 * `GET /api/v1/license/current`, and `--customer` / `--customer-code` must
 * identify the target customer explicitly (PDR-14 / L-06).
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
  if (installationId === undefined || installationId === 'true') {
    throw new Error(
      '--installation <installationId> is required; read it from GET /api/v1/license/current on the target installation.',
    );
  }
  const customerId = args.get('customer');
  if (customerId === undefined || customerId === 'true') {
    throw new Error(
      '--customer <customerId> is required; specify the target customer id explicitly.',
    );
  }
  const customerCode = args.get('customer-code');
  if (customerCode === undefined || customerCode === 'true') {
    throw new Error(
      '--customer-code <customerCode> is required; specify the target customer business code explicitly.',
    );
  }

  const format = (args.get('format') ?? 'v2').toLowerCase();
  if (format !== 'v2' && format !== 'v1') {
    throw new Error(`--format must be v2 or v1 (got "${format}").`);
  }
  const common = {
    installationId,
    customerId,
    customerCode,
    ...optional('customerName', args.get('customer-name')),
    ...optional('status', args.get('status') as 'ACTIVE' | undefined),
    ...optional('validFrom', dateArg(args.get('valid-from'))),
    ...optional('validUntil', dateArg(args.get('valid-until'))),
    ...optional('organizationLimit', intArg(args.get('organizations'))),
    ...optional('userLimit', intArg(args.get('users'))),
    ...optional('deviceLimit', deviceLimitArg(args.get('devices'))),
    ...optional('moduleEntitlements', listArg(args.get('modules'))),
    ...optional('featureEntitlements', listArg(args.get('features'))),
  };

  if (format === 'v1') {
    const { code, payload } = issueLicenseCode(common, privateKey);
    process.stdout.write(
      [...summaryLines(payload, 'VLIC1 (legacy text code)'), '', code, ''].join(
        '\n',
      ),
    );
    return;
  }

  const versionOptions = {
    ...common,
    ...optional('operationId', args.get('operation-id')),
    ...optional(
      'supersedesOperationId',
      args.has('supersedes') ? args.get('supersedes') : undefined,
    ),
  };
  const keyId = args.get('key-id');
  const artifact = args.has('artifact');
  const { file, document, payload } = issueLicenseFile(
    versionOptions,
    privateKey,
    keyId === undefined || keyId === 'true' ? {} : { keyId },
  );
  const output = artifact ? document : file;

  const out = args.get('out');
  if (out !== undefined && out !== 'true') {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, output.endsWith('\n') ? output : `${output}\n`, 'utf8');
    process.stdout.write(
      [
        ...summaryLines(
          payload,
          artifact ? 'VLIC2 artifact' : 'vardena-license file',
        ),
        '',
        `Written to   : ${out}`,
        '',
      ].join('\n'),
    );
    return;
  }

  process.stdout.write(
    [
      ...summaryLines(
        payload,
        artifact ? 'VLIC2 artifact' : 'vardena-license file',
      ),
      '',
      output,
      '',
    ].join('\n'),
  );
}

function summaryLines(
  payload: {
    installationId: string;
    licenseId: string;
    customerId: string;
    customerCode: string;
    customerName: string;
    status: string;
    validFrom: Date;
    validUntil: Date | null;
    organizationLimit: number | null;
    userLimit: number | null;
    deviceLimit: number | null;
    deviceLimitSpecified: boolean;
    moduleEntitlements: readonly string[];
  },
  transport: string,
): string[] {
  return [
    `Transport    : ${transport}`,
    `Installation : ${payload.installationId}`,
    `License      : ${payload.licenseId}`,
    `Customer     : ${payload.customerId} [${payload.customerCode}] (${payload.customerName})`,
    `Status       : ${payload.status}`,
    `Valid        : ${payload.validFrom.toISOString()} → ${payload.validUntil?.toISOString() ?? 'perpetual'}`,
    `Limits       : organizations=${payload.organizationLimit ?? 'unlimited'} users=${payload.userLimit ?? 'unlimited'} devices=${payload.deviceLimitSpecified ? (payload.deviceLimit ?? 'unlimited') : 'unspecified'}`,
    `Modules      : ${payload.moduleEntitlements.join(', ')}`,
  ];
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

function deviceLimitArg(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim().toLowerCase() === 'unlimited') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `"${raw}" is not a non-negative device limit or unlimited.`,
    );
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
