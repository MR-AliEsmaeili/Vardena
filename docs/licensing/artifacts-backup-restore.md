# Owner signed-artifact archive — backup, restore and verification (OD-LIC-19)

**Scope.** This procedure covers the **signed license and revocation artifacts**
stored under `OWNER_LICENSE_ARTIFACT_DIR` and the PostgreSQL rows in
`owner.license_artifacts` that describe them. It does not cover the audit archive
(`OWNER_AUDIT_ARCHIVE_DIR`, which has its own retention and archive-bundle
handling) and it does not cover customer installations.

**Policy (OD-LIC-19, PDR-19 §4).** Retention is **indefinite**. There is **no
WORM claim**, **no automatic deletion**, **no remote callback** and **no new signed
format**. A backup contains the **exact original bytes**; recovery restores those
bytes or reports the artifact as unavailable. An artifact is **never regenerated**
and presented as the original.

## 1. What is in a backup — and what is not

| Included | Why |
|---|---|
| Every file under the artifact root, byte-for-byte (`licenses/…`, `revocations/…`) | These are the only copies of signed artifacts; they cannot be re-derived. |
| `artifact-manifest.json` written by `npm run artifacts:backup` | Artifact metadata: id, kind, target id, byte size, SHA-256, store key, original file name, settlement status. |
| A PostgreSQL dump of the Owner database (`pg_dump -Fc`) | The authoritative metadata and every other Owner fact, including the append-only audit trail. |

| Never included | Why |
|---|---|
| Private signing keys or signer state (`*.pkcs8`, signer replay log) | Custody is offline and separate; the Owner never holds them. |
| Credentials, session tokens, connection strings, `*.env` files | Not part of either store, and secrets must not be copied into a backup bundle. |
| Customer business data outside the Owner database | Out of scope for this archive. |
| A second copy of the audit archive | Different store, different retention, separate runbook. |

The manifest deliberately contains **no** connection string, customer name,
customer code, contact data or key material. It is metadata for verification, not
a second database.

**About the database dump.** The artifact bundle (bytes + manifest) adds none of
the excluded material. The PostgreSQL part is a full backup of the Owner database
and therefore contains that database's own rows — including hashed user
credentials and customer records — because restoring the database is the point of
it. It must be stored and transported under the same confidentiality controls as
the live Owner database. It contains **no private signing key** (the Owner never
holds one) and no signer state; those live only on the offline signing station and
are never part of this procedure.

## 2. The honest consistency boundary

PostgreSQL and the filesystem archive are **two stores, not one transaction**.
Registration is deliberately staged (`archiveArtifact`):

1. insert `owner.license_artifacts` as `PENDING`,
2. write the exact bytes once and fsync the regular file, publish them with an
   atomic write-once hard link, synchronize the directory where supported, and
   read the final bytes back,
3. settle the row `DURABLE` (or `QUARANTINED` on a later integrity failure),
4. commit the issuance state and the audit event in the same transaction as step 3.

Directory synchronization remains part of the POSIX write path. On Windows,
Node.js can report `EPERM` specifically for directory-handle `fsync`; only that
case is tolerated, while regular-file `fsync`, hard-link publication, cleanup
and read-back remain mandatory. Windows therefore has no claim of
POSIX-equivalent directory-entry crash durability. Other directory errors and
all regular-file synchronization errors still fail registration. This platform
limitation does not relax the backup requirement or allow a restore to skip
byte-size and SHA-256 verification.

Therefore:

- A crash can leave a `PENDING` row whose file exists, a `PENDING` row whose file
  does not exist, or an orphan file with no row. **A database dump and a file copy
  taken at different instants can disagree**, and no ordering of the two makes
  them atomic.
- A backup is only trustworthy when **verified against the authoritative
  metadata**, and a restore is only accepted when that verification passes.
- A `PENDING` row is **staged, not restored**. Reconciliation
  (`POST /api/v1/license-artifacts/reconcile`, Owner Admin) settles it `DURABLE`
  when its bytes verify and quarantines it otherwise. Verification reports it as
  unsettled in the meantime.

## 3. Backup procedure

Take the two parts close together, database first, and record both timestamps.

```bash
# 0) Environment
export OWNER_DATABASE_URL='postgresql://<owner-user>@<host>:5432/<owner-db>'
export OWNER_LICENSE_ARTIFACT_DIR='/var/lib/vardena-owner/license-artifacts'   # absolute
BACKUP_ROOT=/srv/backups/owner-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_ROOT"

# 1) PostgreSQL (authoritative metadata + audit, standard tooling)
pg_dump -Fc --no-owner --no-privileges \
  --dbname="$OWNER_DATABASE_URL" \
  --file="$BACKUP_ROOT/owner.dump"

# 2) Signed artifacts + metadata manifest (verifies before copying)
cd owner-licensing/backend
npm run artifacts:backup -- --destination "$BACKUP_ROOT/artifacts"

# 3) Gate: the bundle must verify from its manifest alone
npm run artifacts:verify -- --backup "$BACKUP_ROOT/artifacts"
```

(`--no-owner --no-privileges` are the recommended restore-portability flags; the
drill in §7 used the plain form shown there.)

`artifacts:backup` **refuses** (non-zero exit, no manifest) when any `DURABLE`
row's file is missing or its byte size/SHA-256 does not match the database. Run
reconciliation or restore the affected file first; never "fix" a backup by editing
the manifest. `QUARANTINED` rows are skipped and listed under
`excludedFromBackup`: their bytes are already the recorded failure, are not a
restorable original, and must not be claimed as one.

The backup root must not be inside the PostgreSQL data directory or inside the
artifact root. Physical independence of the backup medium is a deployment-owner
requirement, exactly as the README records for the audit archive; a different path
alone proves nothing about the hardware.

## 4. Restore procedure

Restore into a **new, empty** database and a **new, empty** artifact directory,
then verify before switching anything over.

```bash
# 0) Targets
export RESTORED_DATABASE_URL='postgresql://<owner-user>@<host>:5432/<owner-db-restored>'
RESTORED_ARTIFACT_DIR=/srv/restore/license-artifacts
mkdir -p "$RESTORED_ARTIFACT_DIR"

# 1) Database
createdb --dbname="$RESTORED_DATABASE_URL"        # or: createdb -h … -U … <name>
pg_restore --no-owner --no-privileges \
  --dbname="$RESTORED_DATABASE_URL" "$BACKUP_ROOT/owner.dump"

# 2) Exact artifact bytes (preserve the tree: licenses/…, revocations/…)
cp -a "$BACKUP_ROOT/artifacts/licenses"    "$RESTORED_ARTIFACT_DIR/"
cp -a "$BACKUP_ROOT/artifacts/revocations" "$RESTORED_ARTIFACT_DIR/"
#    (nothing else from the bundle belongs in the artifact root)

# 3) Verify the restored pair: size and SHA-256 of every row against its metadata
cd owner-licensing/backend
OWNER_DATABASE_URL="$RESTORED_DATABASE_URL" \
OWNER_LICENSE_ARTIFACT_DIR="$RESTORED_ARTIFACT_DIR" \
npm run artifacts:verify

# 4) Settle anything the snapshot left staged, then verify again
curl -sS -X POST https://<owner-host>/api/v1/license-artifacts/reconcile \
  -H 'x-owner-request: 1' -H 'Content-Type: application/json' \
  --cookie <owner-admin-session> -d '{}'
OWNER_DATABASE_URL="$RESTORED_DATABASE_URL" \
OWNER_LICENSE_ARTIFACT_DIR="$RESTORED_ARTIFACT_DIR" \
npm run artifacts:verify
```

`artifacts:verify` is **read-only**: it never writes, repairs, quarantines or
adopts. Exit `0` means every row is `DURABLE`, every file matches its **byte size
and SHA-256**, and no unaccounted file exists. Any other result must block the
switchover.

## 5. Recovery matrix

| Condition | Detected as | Required action |
|---|---|---|
| Artifact file missing | `MISSING` (row with no file) | Restore that file from the backup bundle. If the bundle lacks it too, the artifact is **unrecoverable**: do **not** regenerate it. Report it; the customer copy and the (non-revocable) history are the remaining records. |
| File truncated or replaced with a different length | `SIZE_MISMATCH` (`actualByteSize` vs `expectedByteSize`) | Restore the original from the backup; compare SHA-256 before switching over. |
| Same-size corruption | `DIGEST_MISMATCH` (`actualSha256` vs `expectedSha256`) | Same as above. Never accept "it looks fine"; the digest is the authority. |
| File with no consistent database row | `orphanFiles` | Reported, never adopted. It is either a crash remnant of an uncommitted registration or foreign data; investigate, and remove it only with evidence that no row was ever committed. |
| Row left `PENDING` (interrupted registration) | `unsettled` (+ `INTACT` when the bytes verify) | Run reconciliation: bytes verifying → `DURABLE`; otherwise → `QUARANTINED` with a reason. Re-run verification. |
| Row `QUARANTINED` | `verified` mismatch and status `QUARANTINED` | The archive already recorded that these bytes are unusable. They are excluded from backups and never offered as the original. Recovery is a new issuance with new identities, never a rewritten history. |
| Download of a damaged artifact | `503 ArtifactIntegrityFailed` + security-incident audit | Restore from backup; the download path never serves unverified bytes. |
| Audit or state transition cannot commit | HTTP 5xx, transaction rolled back | Nothing is durable; retry after the cause is fixed. Never report success from a rolled-back transaction. |

## 6. What the restore does **not** prove

- It does not prove that the database and the filesystem were captured at the
  same instant. It proves the restored pair is **internally consistent** with the
  authoritative metadata after verification.
- It does not re-verify Ed25519 signatures against a trust list. The bytes are the
  original bytes; signature verification happens when a customer or the Owner
  imports a document, under that party's current trust list.
- It does not prove hardware immutability (no WORM), protection from a
  compromised OS `root`, or that the backup medium is independent. Those are
  deployment controls.
- It does not revive or rewrite a historical issuance. Metadata and bytes are
  restored together; a `QUARANTINED` or missing artifact stays a recorded fact.

## 7. Executed drill (2026-10-20)

**Environment (disposable, no production data, no production key).**

| Item | Value |
|---|---|
| PostgreSQL server and client | 16.2 (`pgserver 0.1.4` bundled binaries; `pg_dump`/`pg_restore` 16.2) |
| Node.js | v22.22.3 |
| Owner backend | this branch (`0.1.0`), migrations `001`–`007` applied by `npm run migrate` |
| API | `tsx src/main.ts` on `127.0.0.1:3101`, origin `http://127.0.0.1:3101`, artifact root `/tmp/drill/artifacts` |
| Signer | `dist-signer/signer/cli.js sign-license`, Ed25519 key generated **inside the drill** in `/tmp`, mode `0600`, never committed |
| Databases | `owner_drill` (source), `owner_restored` (restore target) |
| Snapshot | 1 issuance, 1 `DURABLE` license artifact (927 bytes, SHA-256 `a409927a…3e440`) |

**Commands, in order, with observed results.**

```text
# seed one real artifact through the product paths
POST /api/v1/customers, /installation-identities, /signing-keys            → 201 / 201 / 201
POST /api/v1/license-issuances                                             → 201 (REQUEST_PREPARED)
GET  /api/v1/license-issuances/<id>/request                                → 200
node dist-signer/signer/cli.js sign-license …                              → ok (exit 0)
POST /api/v1/license-issuances/<id>/import                                 → 200 SIGNED_RECORDED
  artifactSha256 = a409927a603a5df7c811b391e86c9433ea6b26762822dad2f44ef6050633e440

# 1) backup
npm run artifacts:backup -- --destination /tmp/drill/backup/artifacts
  {"ok":true,"artifacts":1,"intact":1,"unsettled":[],"orphanFiles":[]}    exit 0
pg_dump -Fc -h 127.0.0.1 -p 55433 -U vardena -d owner_drill \
  -f /tmp/drill/backup/owner_drill.dump                                    exit 0 (132,505 bytes)

# 2) restore into a fresh database and a new artifact root
createdb owner_restored; pg_restore -d owner_restored owner_drill.dump     exit 0
cp -a /tmp/drill/backup/artifacts /tmp/drill/restored/artifacts
  restored row: DURABLE / 927 / licenses/01M5/01M5CR0M1JSYTG0RTVC6N4PFJK.json
  restored sha256 == source sha256 == manifest sha256

# 3) verification
npm run artifacts:verify -- --backup /tmp/drill/backup/artifacts
  {"ok":true,"artifacts":1,"intact":1}                                     exit 0
OWNER_DATABASE_URL=…owner_restored OWNER_LICENSE_ARTIFACT_DIR=…/restored/artifacts \
  npm run artifacts:verify
  {"ok":true,"artifacts":1,"intact":1,"unsettled":[],"orphanFiles":[]}     exit 0
sha256sum of restored and backup files identical (a409927a…3e440)

# 4) damage and recover, restored pair
truncate -s 100 <artifact>              → verify: SIZE_MISMATCH (actual 100)  exit 1
cp backup copy over it                  → verify: ok                          exit 0
rm <artifact>                           → verify: MISSING                     exit 1
cp backup copy over it                  → verify: ok                          exit 0
add unregistered file                   → verify: orphanFiles=[licenses/01M5/…KX.json] exit 1
remove it                               → verify: ok                          exit 0
same-size byte at offset 10             → verify: DIGEST_MISMATCH (actual ff8ebf26…61e7) exit 1
cp backup copy over it                  → verify: ok                          exit 0

# 5) staged registration, then reconciliation
prepare a second request (no artifact)                                     → 201
insert license_artifacts row PENDING + write its exact file
  verify → {"ok":false,"unsettled":["licenses/01M5/01M5CR2EG…X6VJQ.json"]}  exit 1
reconcileArtifacts (Owner Admin)  → outcome REPAIRED (other row INTACT), orphanFiles []
  verify → {"ok":true,"artifacts":2}                                       exit 0
cleanup of the staged fixture row/file                                      ok
```

The reconciliation step ran the production `reconcileArtifacts` function through
`db.transaction` against the same database (the endpoint documented in §4 is the
HTTP form of the same code); the drill did not go through the discretionary
download route because no browser session was needed.

The staged/reconciliation case ran against the live drill pair rather than
`owner_restored`, because the restored snapshot contains one issuance that is
already paired with its artifact and migration `007` allows one artifact per
issuance (`license_artifacts_one_per_issuance`). The same scenario is also
executed automatically on a real prepared request in
`owner-licensing/backend/test/licensing-lifecycle.test.ts`
(“archive backup and restore verification (OD-LIC-19)”).

**Honest limitations of this drill.**

- Version: PostgreSQL 16.2, not the 18.4 server used by the local CI substitute;
  the procedure uses only standard `pg_dump`/`pg_restore` behaviour and no
  server-specific feature.
- The dump and the file copy were taken seconds apart against a quiescent
  disposable archive. The procedure states the boundary; the drill does not prove
  anything about concurrent writers.
- No production key, no customer installation and no real customer data were
  involved. Signature re-verification at a customer is out of this drill.
