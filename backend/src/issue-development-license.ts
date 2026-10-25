import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { lstat, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateId } from './kernel/ids/ulid.js';
import { parsePrivateKey } from './modules/licensing/domain/license-code.js';
import { licenseKeyId } from './modules/licensing/domain/license-document.js';
import {
  parseDeveloperLicenseDocument,
  serializeDeveloperLicenseFile,
  signDeveloperLicenseDocument,
  type DeveloperLicensePayload,
} from './modules/licensing/domain/developer-license-document.js';
import {
  assertDeveloperKeyPathPrivate,
  DeveloperKeyFileError,
  writeExclusive,
} from './tools/developer-license-key-files.js';

/**
 * Official offline Developer License authority (ADR-0053).
 *
 * This tool is compiled only into `dist-tools`; the production backend image
 * contains only `dist`. It never reads a private key from an environment
 * variable, never prints private material or a license artifact, refuses to
 * overwrite output, verifies filesystem privacy before reading a key, and
 * verifies its own output before writing it.
 */
export async function runDeveloperLicenseCli(
  argv: readonly string[],
): Promise<void> {
  const args = parseArgs(argv);
  if (args.has('keygen')) {
    await generateKeyFiles(required(args, 'out-dir'));
    return;
  }
  await issueDeveloperLicense(args);
}

async function generateKeyFiles(outDirArgument: string): Promise<void> {
  const outDir = path.resolve(outDirArgument);
  const info = await stat(outDir).catch(() => null);
  if (info === null || !info.isDirectory()) {
    throw new DeveloperKeyFileError(
      '--out-dir must name an existing private directory.',
    );
  }
  await assertDeveloperKeyPathPrivate(outDir);

  const destinations = {
    privateKey: path.join(outDir, 'developer-license-key.pkcs8'),
    publicKey: path.join(outDir, 'developer-license-public-key.txt'),
    info: path.join(outDir, 'developer-license-key-info.json'),
  };
  for (const destination of Object.values(destinations)) {
    if ((await lstat(destination).catch(() => null)) !== null) {
      throw new DeveloperKeyFileError(
        `Refusing to overwrite existing key artifact: ${destination}`,
      );
    }
  }

  const pair = generateKeyPairSync('ed25519');
  const privateMaterial = pair.privateKey
    .export({ format: 'der', type: 'pkcs8' })
    .toString('base64');
  const publicMaterial = pair.publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  const keyId = licenseKeyId(pair.publicKey);
  const created: string[] = [];
  try {
    await writeExclusive(destinations.privateKey, `${privateMaterial}\n`);
    created.push(destinations.privateKey);
    await assertDeveloperKeyPathPrivate(destinations.privateKey);
    await writeExclusive(destinations.publicKey, `${publicMaterial}\n`);
    created.push(destinations.publicKey);
    await writeExclusive(
      destinations.info,
      `${JSON.stringify(
        {
          algorithm: 'Ed25519',
          keyId,
          publicKeySpkiBase64: publicMaterial,
          trustEntry: `${keyId}:${publicMaterial}`,
        },
        null,
        2,
      )}\n`,
    );
    created.push(destinations.info);
  } catch (error) {
    await Promise.all(
      created.map((createdPath) => unlink(createdPath).catch(() => undefined)),
    );
    throw error;
  }

  printJson({
    ok: true,
    keyId,
    privateKeyPath: destinations.privateKey,
    publicKeyPath: destinations.publicKey,
    keyInfoPath: destinations.info,
    trustConfiguration:
      'Copy trustEntry from developer-license-key-info.json to DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS on approved installations only.',
  });
}

async function issueDeveloperLicense(args: Map<string, string>): Promise<void> {
  const privateKeyPath = path.resolve(required(args, 'private-key-file'));
  const outputPath = path.resolve(required(args, 'out'));
  // Both the file and its containing directory must be private. The directory
  // check closes the replace-between-check-and-read path for other OS users;
  // the helper also rejects links and special files.
  await assertDeveloperKeyPathPrivate(path.dirname(privateKeyPath));
  await assertDeveloperKeyPathPrivate(privateKeyPath);
  const privateMaterial = (await readFile(privateKeyPath, 'utf8')).trim();
  if (privateMaterial === '') {
    throw new Error('The private key file is empty.');
  }
  const privateKey = parsePrivateKey(privateMaterial);
  const publicKey = createPublicKey(privateKey);
  const keyId = licenseKeyId(publicKey);
  const issuedAt = canonicalDate(required(args, 'issued-at'), 'issued-at');
  const payload: DeveloperLicensePayload = {
    version: 1,
    kind: 'DEVELOPER_LICENSE_VERSION',
    licenseType: 'DEVELOPER',
    operationId: valueOrGenerated(args, 'operation-id'),
    licenseId: valueOrGenerated(args, 'license-id'),
    developerId: required(args, 'developer-id'),
    developerName: required(args, 'developer-name'),
    installationId: required(args, 'installation'),
    status: readStatus(args.get('status') ?? 'ACTIVE'),
    validFrom: canonicalDate(required(args, 'valid-from'), 'valid-from'),
    validUntil: canonicalDate(required(args, 'valid-until'), 'valid-until'),
    organizationLimit: positiveInteger(
      required(args, 'organizations'),
      'organizations',
    ),
    userLimit: positiveInteger(required(args, 'users'), 'users'),
    // VDEV1 deliberately cannot invent the commercial identity needed by the
    // VDEA1 device protocol. It fails closed for device enrollment.
    deviceLimit: 0,
    moduleEntitlements: list(required(args, 'modules'), 'modules'),
    featureEntitlements: list(args.get('features') ?? '', 'features'),
    supersedesOperationId: optionalValue(args, 'supersedes'),
    issuerKeyId: keyId,
    issuedAt,
  };

  const document = signDeveloperLicenseDocument(payload, privateKey);
  const verified = parseDeveloperLicenseDocument(
    document,
    [{ id: keyId, key: publicKey }],
    { keyId },
  );
  if (verified.payload.operationId !== payload.operationId) {
    throw new Error('Self-verification did not return the issued operation.');
  }
  const file = serializeDeveloperLicenseFile(document, keyId);
  await writeExclusive(outputPath, file);

  printJson({
    ok: true,
    format: 'vardena-developer-license',
    licenseType: 'DEVELOPER',
    outputPath,
    keyId,
    installationId: payload.installationId,
    operationId: payload.operationId,
    licenseId: payload.licenseId,
    developerId: payload.developerId,
    validFrom: payload.validFrom.toISOString(),
    validUntil: payload.validUntil.toISOString(),
    organizationLimit: payload.organizationLimit,
    userLimit: payload.userLimit,
    modules: [...payload.moduleEntitlements],
    features: [...payload.featureEntitlements],
    verified: true,
  });
}

function parseArgs(argv: readonly string[]): Map<string, string> {
  const supported = new Set([
    'keygen',
    'out-dir',
    'private-key-file',
    'out',
    'installation',
    'developer-id',
    'developer-name',
    'operation-id',
    'license-id',
    'issued-at',
    'valid-from',
    'valid-until',
    'organizations',
    'users',
    'modules',
    'features',
    'supersedes',
    'status',
  ]);
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token ?? ''}`);
    }
    const name = token.slice(2);
    if (!supported.has(name)) throw new Error(`Unknown option: --${name}`);
    if (result.has(name)) throw new Error(`Duplicate option: --${name}`);
    if (name === 'keygen') {
      result.set(name, 'true');
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} requires a value.`);
    }
    result.set(name, value);
    index += 1;
  }
  if (result.has('keygen') && result.size !== 2) {
    throw new Error('Key generation accepts only --keygen --out-dir <path>.');
  }
  return result;
}

function required(args: Map<string, string>, name: string): string {
  const value = args.get(name)?.trim();
  if (value === undefined || value === '') {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

function optionalValue(args: Map<string, string>, name: string): string | null {
  const value = args.get(name)?.trim();
  return value === undefined || value === '' ? null : value;
}

function valueOrGenerated(args: Map<string, string>, name: string): string {
  return optionalValue(args, name) ?? generateId();
}

function canonicalDate(raw: string, name: string): Date {
  const value = new Date(raw);
  if (Number.isNaN(value.getTime()) || value.toISOString() !== raw) {
    throw new Error(
      `--${name} must be a canonical ISO-8601 UTC instant such as 2026-10-25T10:00:00.000Z.`,
    );
  }
  return value;
}

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error(`--${name} must be a positive 32-bit integer.`);
  }
  return value;
}

function list(raw: string, name: string): string[] {
  const values = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== '');
  if (name === 'modules' && values.length === 0) {
    throw new Error('--modules must contain at least one module code.');
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`--${name} contains duplicate codes.`);
  }
  return values;
}

function readStatus(raw: string): DeveloperLicensePayload['status'] {
  if (raw !== 'ACTIVE' && raw !== 'EXPIRED' && raw !== 'SUSPENDED') {
    throw new Error('--status must be ACTIVE, EXPIRED, or SUSPENDED.');
  }
  return raw;
}

function printJson(value: object): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entrypoint)).href
) {
  runDeveloperLicenseCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown failure.';
    process.stderr.write(`refused\t${message}\n`);
    process.exitCode = 2;
  });
}
