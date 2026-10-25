# Official offline Developer License (VDEV1)

This document is the architecture, security/key-management, transfer, troubleshooting, and test reference for Vardena's official Developer License. The decision record is [ADR-0053](../adr/0053-official-offline-developer-license.md). For a nontechnical Windows walkthrough in Persian, see [راهنمای کامل ویندوز](../operations/developer-license-windows-fa.md).

## What it is—and is not

An official Developer License is a finite, bounded Ed25519-signed `VDEV1` artifact with `licenseType=DEVELOPER`. It is issued offline, without Owner Licensing and without a commercial customer. It is imported by the same authenticated backend activation route used for official commercial artifacts.

It is not:

- `NODE_ENV=development`;
- `LICENSE_PROVIDER=local-development` (that remains synthetic `LOCAL_DEVELOPMENT` state);
- a commercial VLIC1/VLIC2 document;
- a default account, permission bypass, frontend flag, or online activation call.

## Protocol and holder model

The JSON envelope is:

```json
{
  "format": "vardena-developer-license",
  "fileVersion": 1,
  "keyId": "sha256-…",
  "document": "VDEV1.<canonical-payload>.<ed25519-signature>"
}
```

The canonical signed payload contains:

- protocol version/kind and fixed type `DEVELOPER`;
- unique `operationId` and retained `licenseId`;
- explicit `developerId` and `developerName` (never customer fields);
- exactly one `installationId` read from the target backend;
- status and finite canonical UTC `validFrom`, `validUntil`, `issuedAt`;
- positive integer organization and user limits;
- known module and well-formed feature entitlements;
- `deviceLimit=0` in VDEV1;
- optional `supersedesOperationId` for an explicit replacement;
- signed `issuerKeyId`, which must equal the trusted key selected by the file.

The `VDEV1` prefix, payload kind and dedicated trust list cryptographically/domain-semantically separate it from commercial VLIC2. VLIC2 canonical bytes were not changed.

## Runtime trust and policy

Developer acceptance is disabled by default in all environments. On an approved target installation, configure the API **and worker** identically:

```dotenv
LICENSE_PROVIDER=persistent
DEVELOPER_LICENSES_ENABLED=true
DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS=sha256-0123456789abcdef<colon>BASE64_SPKI_PUBLIC_KEY
```

Replace the sample with the exact `trustEntry` from `developer-license-key-info.json`; the literal `<colon>` above means a single `:` character. Do not add the private key. Do not put the developer key in `LICENSE_SIGNING_PUBLIC_KEYS`; developer and commercial key IDs and Ed25519 key material must be disjoint, and startup refuses either kind of overlap.

For a customer deployment that must never accept Developer Licenses:

```dotenv
DEVELOPER_LICENSES_ENABLED=false
DEVELOPER_LICENSE_SIGNING_PUBLIC_KEYS=
```

Changing `NODE_ENV` does not alter this policy. A previously persisted license is still evaluated from the database; removing trust does not retroactively re-verify it. To remove an approved developer installation, follow the controlled database/license lifecycle process rather than deleting records directly.

## Validation and write ordering

The activation service performs, before any license write:

1. existing RBAC `Licensing.License.Activate` authorization;
2. transport/envelope recognition;
3. explicit deployment-policy gate;
4. dedicated trusted-key lookup and Ed25519 verification;
5. signed `issuerKeyId` equality;
6. canonical payload, type, holder, status, date, limit and entitlement validation;
7. backend-owned installation identity equality;
8. issue/expiry lifecycle checks;
9. license-level revocation state and operation/document replay checks;
10. prohibition on mixed commercial/developer installation history;
11. supersession/overlap/reduction and usage checks.

The existing per-installation lock and transaction repeat the retained-state decision, then atomically insert holder, version, entitlements, supersession and audit facts. A failure writes no license/customer/version state. Raw documents, signatures, and keys are not persisted; only hashes and public metadata are retained.

## Issuer build and commands

Run from `backend` after `npm ci`:

```powershell
npm run build:tools
```

### Generate an authority key

First create a directory restricted to the current operator. On Windows, the Workbench does this with `icacls`. The command-line issuer refuses a broad DACL. Then:

```powershell
npm run developer-license:keygen -- --out-dir "C:\Vardena-Developer-Authority"
```

Files are created exclusively and never overwritten:

- `developer-license-key.pkcs8` — private; never copy to the target server;
- `developer-license-public-key.txt` — public SPKI base64;
- `developer-license-key-info.json` — public `keyId` and `trustEntry`.

### Issue one installation-bound license

All dates are canonical UTC instants. `--operation-id` and `--license-id` are optional generated ULIDs; provide them explicitly for byte-for-byte deterministic/reproducible test issuance.

```powershell
npm run developer-license:issue -- `
  --private-key-file "C:\Vardena-Developer-Authority\developer-license-key.pkcs8" `
  --out "C:\Vardena-Transfer\vardena-developer-license.vdev.json" `
  --installation "01JDEVINSTALLATION000000000" `
  --developer-id "developer-alice" `
  --developer-name "Alice Example" `
  --operation-id "dev-operation-2026-001" `
  --license-id "dev-license-2026-001" `
  --issued-at "2026-10-25T10:00:00.000Z" `
  --valid-from "2026-10-25T10:00:00.000Z" `
  --valid-until "2027-01-25T10:00:00.000Z" `
  --organizations 2 `
  --users 10 `
  --modules "organization,users,rbac" `
  --features "developer-tools"
```

The tool prints only a metadata receipt. It self-verifies the artifact before an exclusive output write and refuses an existing output path. For replacement, add `--supersedes "<previous-operationId>"`, keep the same `developerId`, use a new operation ID, and choose a `validFrom` far enough in the future for transfer/import—the retained-version rules refuse a supersession whose hand-over is already in the past.

## Transfer and activation

1. Read the backend-owned `installationId` from the target's current-license screen/API.
2. Transfer only the public trust entry through approved configuration management.
3. Restart API and worker and confirm healthy startup.
4. On the offline authority station, issue for that exact installation.
5. Transfer the `.vdev.json` file through the approved removable-media/file channel. Treat it as operationally sensitive even though it contains no private key.
6. Sign in as an administrator holding `Licensing.License.Activate` and use the existing license activation/import UI or `POST /api/v1/license/activate` contract.
7. Confirm current state reports `licenseType=DEVELOPER`, expected developer holder, dates, limits and entitlements. Confirm customer ID/code are null.

Never send the private-key file, place it in the target configuration, or import it through an API. A license for another installation must be reissued—not edited and not made multi-installation. Replacements must keep the same `developerId`; VDEV1 has no silent holder-transfer operation, so changing the non-commercial holder requires a future explicit product workflow rather than deleting history or reusing commercial transfer.

## Key management

- Keep the authority station offline during issuance where operationally possible.
- Store the private key outside the repository, database, frontend, logs, APIs, `.env`, tickets and chat.
- Back it up encrypted under the organization's custody policy. Record who can access it.
- Do not loosen POSIX mode 600/file + 700/directory or the Windows DACL. The issuer fails closed if it cannot prove privacy.
- Public trust rollout must precede issuance with a rotated key. Keep old public keys only while artifacts requiring them may still be imported.
- A suspected private-key compromise requires disabling the developer policy or removing the compromised public trust through controlled deployment, preserving evidence, rotating to a new protected key, and independently reissuing affected installations. Offline trust means there is no instant central kill switch.
- Never “fix” an import by adding an unknown key, sharing commercial and developer key IDs, changing the signed file, deleting replay state, or making limits unlimited/perpetual.

### Current protocol limits

VDEV1 cannot enroll client devices; its device limit is fixed to zero. The
existing VREV1 revocation artifact is also commercial-customer-bound, so VDEV1
has no separate signed revocation artifact in version 1. For a compromised or
no-longer-approved developer authority, use controlled policy/trust rollout and
explicit replacement where applicable—never fabricate a customer or edit
history. There is no central online kill switch.

## Troubleshooting

| Symptom/reason | Meaning and safe response |
|---|---|
| `developer-license-disabled` (403) | This deployment is not approved. Do not change `NODE_ENV`; obtain approval and explicitly deploy policy/trust, or use a commercial license. |
| `unknown-key` / signature refusal | File key ID is absent/wrong or bytes changed. Compare public `trustEntry`; never copy the private key to the server. |
| `installation-mismatch` | Artifact targets another installation. Read the target ID and issue an independent license. |
| `expired-document`, `not-active`, `not-yet-valid` | Correct status/times and reissue with a new operation ID. Check UTC clocks. |
| `duplicate-operation` | The operation was already retained; do not delete history. Read current state. |
| `license-type-conflict` | Installation is commercially bound/has other type history, or a commercial-only special route was used. Do not fabricate/move a customer; use an approved clean developer installation or commercial flow. |
| overlap/supersession conflict | For replacement, issue with the eligible prior `operationId` in `--supersedes`, correct non-backdated dates, and preserve/reconcile limits. |
| issuer refuses key permissions | Restrict directory/file ACL or POSIX mode; do not bypass the check. |
| issuer refuses overwrite | Select a new output path. Existing artifacts and keys are evidence and are never overwritten. |
| device enrollment refused | Expected in VDEV1: device enrollment is commercial-customer-bound and developer quota is fixed to zero. |

## Tests and evidence

Deterministic synthetic-key tests cover VDEV1 canonicalization/signature/domain separation, file transport, key identity, malformed payloads, policy defaults, dedicated trust, activation, no-customer persistence, installation mismatch, replay and mixed-type refusal. CLI tests cover protected files, no secret output, deterministic explicit-input issuance, self-verification and no-overwrite. Existing commercial document/version/import suites are regression gates.

Relevant commands:

```bash
cd backend
npm run typecheck
npm test -- --run src/modules/licensing/domain/developer-license-document.spec.ts src/modules/licensing/application/license-import.service.spec.ts src/tools/developer-license-key-files.spec.ts src/issue-development-license.spec.ts
npm run build
npm run build:tools
cd ..
python3 scripts/check-production-artifacts.py --repo-root . --backend-dir backend
python3 scripts/check-docs-links.py
```

Live PostgreSQL migration/import and Docker production-artifact checks remain GitHub Actions responsibilities. Never skip or weaken them to make a Developer License pass.
